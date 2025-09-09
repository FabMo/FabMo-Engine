const chokidar = require("chokidar");
const fs = require("fs-extra");
const path = require("path");
const log = require("./log").logger("watcher");
var machine = require("./machine"); // source for status info

// Directories to watch
const watchDirs = ["/opt/fabmo/config/", "/opt/fabmo/macros/"];

// Directory to store backups
const backupBaseDir = "/opt/fabmo_backup/";

// Debounce function
function debounce(func, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

// Track the last backup time and pending updates
let lastBackupTime = 0;
let pendingUpdates = new Map(); // filepath -> { flagged: true, lastAttempt: timestamp }
let deferredTimer = null;

// Function to check tool state
function isToolBusy(callback) {
    const isBusy = machine.machine.status.state === "running" || machine.machine.status.state === "manual";
    callback(isBusy);
}

// Enhanced backup creation with deferred update handling
const createBackup = debounce((filePath) => {
    const currentTime = Date.now();
    
    // Check if we're within the 10-second window
    if (currentTime - lastBackupTime < 10000) {
        log.debug(`Backup request for ${filePath} deferred due to 10-second constraint`);
        
        // Flag this file for deferred backup
        pendingUpdates.set(filePath, {
            flagged: true,
            lastAttempt: currentTime,
            originalTime: pendingUpdates.get(filePath)?.originalTime || currentTime
        });
        
        // Set up or reset the deferred timer
        setupDeferredBackupTimer();
        return;
    }
    
    // Clear any pending flag for this file since we're processing it now
    pendingUpdates.delete(filePath);
    
    // Proceed with immediate backup
    processBackup(filePath, currentTime);
}, 10);

// Set up timer to handle deferred backups
function setupDeferredBackupTimer() {
    if (deferredTimer) {
        clearTimeout(deferredTimer);
    }
    
    // Wait 12 seconds (10 + 2 buffer) then process all flagged updates
    deferredTimer = setTimeout(() => {
        processDeferredBackups();
    }, 12000);
}

// Process all flagged deferred backups
function processDeferredBackups() {
    const currentTime = Date.now();
    log.info(`Processing ${pendingUpdates.size} deferred backup(s)`);
    
    for (const [filePath, updateInfo] of pendingUpdates.entries()) {
        if (updateInfo.flagged) {
            log.info(`Executing deferred backup for: ${filePath}`);
            processBackup(filePath, currentTime);
        }
    }
    
    // Clear all pending updates
    pendingUpdates.clear();
    deferredTimer = null;
}

// Extracted backup processing logic
function processBackup(filePath, currentTime) {
    isToolBusy((busy) => {
        if (busy) {
            log.debug("Tool is busy. Delaying backup request for " + filePath);
            setTimeout(() => processBackup(filePath, currentTime), 10000);
        } else {
            // NEW: Validate JSON before backing up
            if (path.extname(filePath) === '.json') {
                fs.readFile(filePath, 'utf8', (readErr, data) => {
                    if (readErr) {
                        log.warn(`Cannot read file for backup validation: ${filePath} - ${readErr.message}`);
                        return;
                    }
                    
                    try {
                        JSON.parse(data); // Validate JSON
                        performBackup(filePath, currentTime);
                    } catch (parseErr) {
                        log.warn(`Skipping backup of invalid JSON file: ${filePath} - ${parseErr.message}`);
                        return;
                    }
                });
            } else {
                // Non-JSON files, backup normally
                performBackup(filePath, currentTime);
            }
        }
    });
}

// Enhanced helper function to perform the actual backup
function performBackup(filePath, currentTime) {
    const watchDir = watchDirs.find((dir) => filePath.startsWith(dir));
    const relativePath = path.relative(watchDir, filePath);
    const backupDir = path.join(backupBaseDir, path.basename(watchDir));
    const backupPath = path.join(backupDir, relativePath);
    
    log.debug(`Creating backup for ${filePath} at ${backupPath}`);
    fs.copy(filePath, backupPath, (err) => {
        if (err) {
            log.error(`Error creating backup for ${filePath}:`, err);
        } else {
            log.debug(`Backup created for ${filePath}`);
            lastBackupTime = currentTime;
            
            // Log if this was a deferred backup
            const wasPending = pendingUpdates.has(filePath);
            if (wasPending) {
                const originalTime = pendingUpdates.get(filePath).originalTime;
                const deferDelay = Math.round((currentTime - originalTime) / 1000);
                log.info(`Deferred backup completed for ${filePath} (delayed ${deferDelay}s)`);
            }
        }
    });
}

// Function to copy existing files to the backup directory if they do not already exist
function copyExistingFiles() {
    return new Promise((resolve) => {
        let pendingOps = 0;
        let completedOps = 0;
        const results = [];
        
        watchDirs.forEach((watchDir) => {
            const backupDir = path.join(backupBaseDir, path.basename(watchDir));
            
            log.info(`Processing watch directory: ${watchDir}`);
            fs.ensureDirSync(backupDir);
            
            if (!fs.existsSync(watchDir)) {
                log.warn(`Source directory ${watchDir} does not exist, skipping copy.`);
                return;
            }
            
            const files = fs.readdirSync(watchDir); // Make this synchronous
            log.info(`Found ${files.length} files in ${watchDir}: ${files.join(', ')}`);
            
            if (files.length === 0) {
                return;
            }
            
            files.forEach((file) => {
                const srcPath = path.join(watchDir, file);
                const destPath = path.join(backupDir, file);
                
                try {
                    const srcStats = fs.statSync(srcPath);
                    if (!srcStats.isFile()) {
                        return;
                    }
                    
                    pendingOps++;
                    
                    // Check if backup exists
                    fs.stat(destPath, (backupErr, backupStats) => {
                        if (backupErr) {
                            // No backup exists - create initial backup
                            log.info(`Creating initial backup for new file: ${file}`);
                            fs.copy(srcPath, destPath, (copyErr) => {
                                completedOps++;
                                if (copyErr) {
                                    log.error(`Error creating initial backup for ${srcPath}: ${copyErr.message}`);
                                    results.push({ file, status: 'error', error: copyErr.message });
                                } else {
                                    log.info(`Created initial backup for ${srcPath}`);
                                    results.push({ file, status: 'created' });
                                }
                                
                                if (completedOps >= pendingOps) {
                                    log.info(`Initial backup completed: ${results.length} files processed`);
                                    resolve(results);
                                }
                            });
                        } else {
                            // Backup exists - check if source is newer
                            if (srcStats.mtime > backupStats.mtime) {
                                log.info(`Updating backup for modified file: ${file}`);
                                fs.copy(srcPath, destPath, (copyErr) => {
                                    completedOps++;
                                    if (copyErr) {
                                        log.error(`Error updating backup for ${srcPath}: ${copyErr.message}`);
                                        results.push({ file, status: 'error', error: copyErr.message });
                                    } else {
                                        log.info(`Updated backup for ${srcPath}`);
                                        results.push({ file, status: 'updated' });
                                    }
                                    
                                    if (completedOps >= pendingOps) {
                                        log.info(`Initial backup completed: ${results.length} files processed`);
                                        resolve(results);
                                    }
                                });
                            } else {
                                completedOps++;
                                log.debug(`Backup up-to-date for: ${file} (preserving previous version)`);
                                results.push({ file, status: 'up-to-date' });
                                
                                if (completedOps >= pendingOps) {
                                    log.info(`Initial backup completed: ${results.length} files processed`);
                                    resolve(results);
                                }
                            }
                        }
                    });
                } catch (statErr) {
                    log.debug(`Cannot read source file ${srcPath}: ${statErr.message}`);
                }
            });
        });
        
        // Handle case where no operations were started
        if (pendingOps === 0) {
            log.info("No files to backup - completing immediately");
            resolve([]);
        }
    });
}

// Function to copy backup at the start of the session with rotation
function copyBackupAtStart(callback, engineVersion) { // ← Add engineVersion parameter
    const atStartBaseDir = "/opt/fabmo_backup_atStart/";
    const maxBackups = 5;
    
    fs.pathExists(backupBaseDir, (err, exists) => {
        if (err) {
            log.error(`Error checking existence of ${backupBaseDir}:`, err);
            callback(err);
            return;
        }
        if (!exists) {
            log.info(`Backup base directory ${backupBaseDir} does not exist. Skipping backup.`);
            callback();
            return;
        }
        
        log.info(`Ensuring directory exists: ${atStartBaseDir}`);
        fs.ensureDirSync(atStartBaseDir);
        
        // Create timestamped subdirectory name
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hour = String(now.getHours()).padStart(2, '0');
        const minute = String(now.getMinutes()).padStart(2, '0');
        const second = String(now.getSeconds()).padStart(2, '0');
        
        const timestampedDirName = `atStart_${year}_${month}_${day}_${hour}${minute}${second}`;
        const newBackupDir = path.join(atStartBaseDir, timestampedDirName);
        
        // Get existing backup directories and sort by creation time (oldest first)
        fs.readdir(atStartBaseDir, (readErr, files) => {
            if (readErr) {
                log.warn(`Could not read existing backups directory: ${readErr.message}`);
                files = []; // Continue with empty list
            }
            
            // Filter for directories that match our naming pattern and get their stats
            const existingBackups = [];
            let pendingStats = 0;
            
            const processBackups = () => {
                // Sort by creation time (oldest first)
                existingBackups.sort((a, b) => a.mtime - b.mtime);
                
                // Remove oldest backups if we have >= maxBackups
                if (existingBackups.length >= maxBackups) {
                    const backupsToRemove = existingBackups.slice(0, existingBackups.length - maxBackups + 1);
                    
                    log.info(`Found ${existingBackups.length} existing backups, removing ${backupsToRemove.length} oldest`);
                    
                    // Remove old backups
                    backupsToRemove.forEach(backup => {
                        try {
                            fs.rmSync(backup.fullPath, { recursive: true, force: true });
                            log.info(`Removed old backup: ${backup.name}`);
                        } catch (rmErr) {
                            log.warn(`Could not remove old backup ${backup.name}: ${rmErr.message}`);
                        }
                    });
                }
                
                // Now create the new backup
                log.info(`Creating new timestamped backup: ${timestampedDirName}`);
                log.info(`Copying backup from ${backupBaseDir} to ${newBackupDir}`);
                
                fs.copy(backupBaseDir, newBackupDir, (copyErr) => {
                    if (copyErr) {
                        log.error(`Error copying backup to ${newBackupDir}:`, copyErr);
                        callback(copyErr);
                    } else {
                        log.info(`Timestamped backup created successfully at ${newBackupDir}`);
                        
                        // Create a marker file with metadata
                        const markerInfo = {
                            created_at: now.toISOString(),
                            backup_type: "atStart_rotated",
                            source_dir: backupBaseDir,
                            fabmo_version: engineVersion || "unknown" // ← Now engineVersion is in scope
                        };
                        
                        try {
                            fs.writeFileSync(path.join(newBackupDir, "backup_info.json"), JSON.stringify(markerInfo, null, 2));
                            log.debug("Created backup metadata file");
                        } catch (metaErr) {
                            log.warn("Could not create backup metadata: " + metaErr.message);
                        }
                        
                        callback();
                    }
                });
            };
            
            if (files.length === 0) {
                processBackups();
                return;
            }
            
            // Check each file to see if it's a backup directory
            files.forEach(file => {
                if (file.startsWith('atStart_') && file.match(/atStart_\d{4}_\d{2}_\d{2}_\d{6}/)) {
                    const fullPath = path.join(atStartBaseDir, file);
                    pendingStats++;
                    
                    fs.stat(fullPath, (statErr, stats) => {
                        pendingStats--;
                        
                        if (!statErr && stats.isDirectory()) {
                            existingBackups.push({
                                name: file,
                                fullPath: fullPath,
                                mtime: stats.mtime.getTime()
                            });
                        } else if (statErr) {
                            log.warn(`Could not stat backup directory ${fullPath}: ${statErr.message}`);
                        }
                        
                        if (pendingStats === 0) {
                            processBackups();
                        }
                    });
                } else {
                    log.debug(`Skipping non-backup file/directory: ${file}`);
                }
            });
            
            // Handle case where no valid backup directories were found
            if (pendingStats === 0) {
                processBackups();
            }
        });
    });
}

// Function to create a pre-auto-profile backup
function createPreAutoProfileBackup(callback) {
    const preAutoProfileBackupDir = "/opt/fabmo_backup/pre_auto_profile/";
    const userConfigBackupDir = "/opt/fabmo_backup/config/";
    const userMacrosBackupDir = "/opt/fabmo_backup/macros/";
    const liveMacrosDir = "/opt/fabmo/macros/";
    
    // Check if user backup data exists - if it does, ALWAYS use it
    if (!fs.existsSync(userConfigBackupDir)) {
        log.info("No user backup data exists - skipping pre-auto-profile backup creation");
        return callback(null);
    }
    
    log.info("Creating pre-auto-profile backup from user data at: " + preAutoProfileBackupDir);
    
    try {
        // Ensure backup directory exists (this will overwrite any existing backup)
        fs.ensureDirSync(preAutoProfileBackupDir + "config/");
        fs.ensureDirSync(preAutoProfileBackupDir + "macros/");
        
        // Always create fresh backup from current user data
        log.info("Copying user config data from: " + userConfigBackupDir);
        fs.copy(userConfigBackupDir, preAutoProfileBackupDir + "config/", function(configErr) {
            if (configErr) {
                log.error("Failed to copy user config backup: " + configErr.message);
                return callback(configErr);
            }
            
            log.info("User config data copied successfully");
            
            // Copy macros (with fallback)
            const macrosSource = fs.existsSync(userMacrosBackupDir) ? userMacrosBackupDir : liveMacrosDir;
            fs.copy(macrosSource, preAutoProfileBackupDir + "macros/", function(macrosErr) {
                if (macrosErr) {
                    log.warn("Failed to copy macros: " + macrosErr.message);
                }
                
                // Create backup info with current timestamp
                var marker = {
                    created_at: new Date().toISOString(),
                    backup_type: "pre_auto_profile", 
                    source: "user_backup_data",
                    config_files_backed_up: true,
                    macros_backed_up: !macrosErr,
                    note: "Fresh backup created for this auto-profile session"
                };
                
                fs.writeFileSync(preAutoProfileBackupDir + "backup_info.json", JSON.stringify(marker, null, 2));
                log.info("Fresh pre-auto-profile backup created successfully from current user data");
                callback(null);
            });
        });
    } catch (err) {
        log.error("Error creating pre-auto-profile backup: " + err.message);
        callback(err);
    }
}

// Function to restore from pre-auto-profile backup
function restoreFromPreAutoProfileBackup(callback) {
    const preAutoProfileBackupDir = "/opt/fabmo_backup/pre_auto_profile/";
    const configDir = "/opt/fabmo/config/";
    const macrosDir = "/opt/fabmo/macros/";
    
    log.info("Restoring from pre-auto-profile backup...");
    
    // Check if backup exists
    if (!fs.existsSync(preAutoProfileBackupDir)) {
        return callback(new Error("No pre-auto-profile backup found"));
    }
    
    try {
        // Restore config directory
        fs.copy(preAutoProfileBackupDir + "config/", configDir, function(configErr) {
            if (configErr) {
                log.error("Failed to restore config directory: " + configErr.message);
                return callback(configErr);
            }
            
            // Restore macros directory  
            fs.copy(preAutoProfileBackupDir + "macros/", macrosDir, function(macrosErr) {
                if (macrosErr) {
                    log.error("Failed to restore macros directory: " + macrosErr.message);
                    return callback(macrosErr);
                }
                
                log.info("Pre-auto-profile backup restored successfully");
                callback(null);
            });
        });
    } catch (err) {
        log.error("Error restoring from pre-auto-profile backup: " + err.message);
        callback(err);
    }
}

// NEW: Function to check if pre-auto-profile backup exists
function hasPreAutoProfileBackup() {
    const preAutoProfileBackupDir = "/opt/fabmo_backup/pre_auto_profile/";
    const backupInfoFile = preAutoProfileBackupDir + "backup_info.json";
    return fs.existsSync(preAutoProfileBackupDir) && fs.existsSync(backupInfoFile);
}

// NEW: Function to get pre-auto-profile backup info
function getPreAutoProfileBackupInfo(callback) {
    const preAutoProfileBackupDir = "/opt/fabmo_backup/pre_auto_profile/";
    const backupInfoFile = preAutoProfileBackupDir + "backup_info.json";
    
    if (!fs.existsSync(backupInfoFile)) {
        return callback(new Error("No pre-auto-profile backup info found"));
    }
    
    fs.readFile(backupInfoFile, "utf8", function(err, data) {
        if (err) {
            return callback(err);
        }
        
        try {
            const info = JSON.parse(data);
            callback(null, info);
        } catch (parseErr) {
            callback(parseErr);
        }
    });
}

// Function to start the watcher
async function startWatcher() {
    // Wait for initial file copying to complete
    log.info("Starting initial backup of existing files...");
    try {
        const results = await copyExistingFiles();
        log.info(`Initial backup completed: ${results.length} operations`);
    } catch (err) {
        log.error("Error during initial backup:", err);
    }


    // Initialize watcher with awaitWriteFinish
    const watcher = chokidar.watch(watchDirs, {
        persistent: true,
        ignoreInitial: false,
        awaitWriteFinish: {
            stabilityThreshold: 500, // Adjust this value as needed
            pollInterval: 50,
        },
    });

    // Watch for file changes
    watcher
        .on("add", (filePath) => {
            //log.info(`File added: ${filePath}`);
            createBackup(filePath);
        })
        .on("change", (filePath) => {
            //log.info(`File changed: ${filePath}`);
            createBackup(filePath);
        });

    log.info(`Watching for changes in ${watchDirs.join(", ")}`);

    // Function to gracefully shut down the watcher
    function shutdownWatcher() {
        log.info("Shutting down file watcher...");
        watcher
            .close()
            .then(() => {
                log.info("File watcher shut down successfully.");
                process.exit(0);
            })
            .catch((err) => {
                log.error("Error shutting down file watcher:", err);
                process.exit(1);
            });
    }

    // Handle process events for graceful shutdown
    process.on("exit", shutdownWatcher);
    process.on("SIGINT", shutdownWatcher);
    process.on("SIGTERM", shutdownWatcher);
    process.on("uncaughtException", (err) => {
        log.error("Uncaught exception:", err);
        shutdownWatcher();
    });
}

// Enhanced shutdown handling to process pending backups
function shutdownWatcher() {
    log.info("Shutting down watcher...");
    
    // Process any remaining deferred backups before shutdown
    if (pendingUpdates.size > 0) {
        log.info(`Processing ${pendingUpdates.size} pending backup(s) before shutdown`);
        processDeferredBackups();
    }
    
    if (deferredTimer) {
        clearTimeout(deferredTimer);
    }
    
    log.info("Watcher shutdown complete");
}

// Add status reporting for debugging
function getBackupStatus() {
    return {
        lastBackupTime: new Date(lastBackupTime).toISOString(),
        pendingUpdates: Array.from(pendingUpdates.entries()).map(([path, info]) => ({
            path: path,
            flagged: info.flagged,
            waitingSeconds: Math.round((Date.now() - info.originalTime) / 1000)
        })),
        deferredTimerActive: !!deferredTimer
    };
}

// Clean up pre-auto-profile backup (when user dismisses restore)
function cleanupPreAutoProfileBackup(callback) {
    const backupDir = '/opt/fabmo_backup/pre_auto_profile';
    
    if (!fs.existsSync(backupDir)) {
        return callback(null);
    }
    
    try {
        // Remove the entire directory
        fs.rmSync(backupDir, { recursive: true, force: true });
        log.info("Pre-auto-profile backup directory removed");
        callback(null);
    } catch (err) {
        log.error("Error removing pre-auto-profile backup: " + err.message);
        callback(err);
    }
}


// Export the status function for debugging
module.exports = {
    startWatcher,
    copyBackupAtStart,
    createPreAutoProfileBackup,
    restoreFromPreAutoProfileBackup,
    hasPreAutoProfileBackup,
    getPreAutoProfileBackupInfo,
    getBackupStatus: getBackupStatus,
    cleanupPreAutoProfileBackup: cleanupPreAutoProfileBackup
};

