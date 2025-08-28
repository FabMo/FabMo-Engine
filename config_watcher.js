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

// Track the last backup time
let lastBackupTime = 0;

// Function to check tool state
function isToolBusy(callback) {
    const isBusy = machine.machine.status.state === "running" || machine.machine.status.state === "manual";
    callback(isBusy);
}

// Enhanced backup creation with JSON validation
const createBackup = debounce((filePath) => {
    const currentTime = Date.now();
    if (currentTime - lastBackupTime < 10000) {
        log.debug("Backup request ignored due to 10-second delay constraint.");
        return;
    }

    isToolBusy((busy) => {
        if (busy) {
            log.debug("Tool is busy. Delaying backup request.");
            setTimeout(() => createBackup(filePath), 10000);
        } else {
            // NEW: Validate JSON before backing up
            if (path.extname(filePath) === '.json') {
                fs.readFile(filePath, 'utf8', (readErr, data) => {
                    if (readErr) {
                        log.warn(`Cannot read file for backup validation: ${filePath} - ${readErr.message}`);
                        return; // Don't backup invalid files
                    }
                    
                    try {
                        JSON.parse(data); // Validate JSON
                        performBackup(filePath, currentTime);
                    } catch (parseErr) {
                        log.warn(`Skipping backup of invalid JSON file: ${filePath} - ${parseErr.message}`);
                        return; // Don't backup invalid JSON
                    }
                });
            } else {
                // Non-JSON files, backup normally
                performBackup(filePath, currentTime);
            }
        }
    });
}, 10);

// Helper function to perform the actual backup
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
        }
    });
}

// Function to copy existing files to the backup directory if they do not already exist
function copyExistingFiles() {
    watchDirs.forEach((watchDir) => {
        const backupDir = path.join(backupBaseDir, path.basename(watchDir));
        fs.ensureDirSync(backupDir);
        fs.readdir(watchDir, (err, files) => {
            if (err) {
                log.error(`Error reading directory ${watchDir}:`, err);
                return;
            }
            files.forEach((file) => {
                const srcPath = path.join(watchDir, file);
                const destPath = path.join(backupDir, file);
                fs.pathExists(destPath, (exists) => {
                    if (exists) {
                        log.debug(`File already exists at ${destPath}, skipping copy.`);
                    } else {
                        fs.copy(srcPath, destPath, (err) => {
                            if (err) {
                                log.error(`Error copying file from ${srcPath} to ${destPath}:`, err);
                            } else {
                                log.debug(`Copied file from ${srcPath} to ${destPath}`);
                            }
                        });
                    }
                });
            });
        });
    });
}

// Function to copy backup at the start of the session
function copyBackupAtStart(callback) {
    const atStartDir = "/opt/fabmo_backup_atStart/";
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
        log.info(`Ensuring directory exists: ${atStartDir}`);
        fs.ensureDirSync(atStartDir);
        log.info(`Copying backup from ${backupBaseDir} to ${atStartDir}`);
        fs.copy(backupBaseDir, atStartDir, (err) => {
            if (err) {
                log.error(`Error copying backup to ${atStartDir}:`, err);
                callback(err);
            } else {
                log.info(`Backup copied to ${atStartDir}`);
                callback();
            }
        });
    });
}

// NEW: Function to create a pre-auto-profile backup
function createPreAutoProfileBackup(callback) {
    const preAutoProfileBackupDir = "/opt/fabmo_backup/pre_auto_profile/";
    const configDir = "/opt/fabmo/config/";
    const macrosDir = "/opt/fabmo/macros/";
    
    log.info("Creating pre-auto-profile backup at: " + preAutoProfileBackupDir);
    
    try {
        // Ensure backup directory exists
        fs.ensureDirSync(preAutoProfileBackupDir + "config/");
        fs.ensureDirSync(preAutoProfileBackupDir + "macros/");
        
        // NEW: Validate config files before backing up
        const validateAndCopyConfig = (source, dest, callback) => {
            fs.readdir(source, (err, files) => {
                if (err) {
                    log.warn(`Cannot read config directory: ${err.message}`);
                    return fs.copy(source, dest, callback); // Fallback to regular copy
                }
                
                let validConfigs = 0;
                let totalConfigs = files.filter(f => f.endsWith('.json')).length;
                
                if (totalConfigs === 0) {
                    return fs.copy(source, dest, callback); // No JSON files to validate
                }
                
                files.forEach(file => {
                    if (file.endsWith('.json')) {
                        const filePath = path.join(source, file);
                        fs.readFile(filePath, 'utf8', (readErr, data) => {
                            if (!readErr) {
                                try {
                                    JSON.parse(data);
                                    validConfigs++;
                                    log.debug(`Valid config file: ${file}`);
                                } catch (parseErr) {
                                    log.warn(`Invalid JSON config file detected: ${file} - ${parseErr.message}`);
                                }
                            }
                            
                            // Check if we've processed all files
                            if (validConfigs + (totalConfigs - validConfigs) >= totalConfigs) {
                                if (validConfigs > 0) {
                                    log.info(`Validated ${validConfigs}/${totalConfigs} config files - proceeding with backup`);
                                    fs.copy(source, dest, callback);
                                } else {
                                    log.warn("No valid config files found - backup may be incomplete");
                                    fs.copy(source, dest, callback); // Backup anyway for macros
                                }
                            }
                        });
                    }
                });
            });
        };
        
        // Copy and validate config directory
        validateAndCopyConfig(configDir, preAutoProfileBackupDir + "config/", function(configErr) {
            if (configErr) {
                log.error("Failed to backup config directory: " + configErr.message);
                return callback(configErr);
            }
            
            // Copy macros directory (no validation needed)
            fs.copy(macrosDir, preAutoProfileBackupDir + "macros/", function(macrosErr) {
                if (macrosErr) {
                    log.error("Failed to backup macros directory: " + macrosErr.message);
                    return callback(macrosErr);
                }
                
                // Create a marker file with timestamp
                var marker = {
                    created_at: new Date().toISOString(),
                    backup_type: "pre_auto_profile",
                    config_files_backed_up: true,
                    macros_backed_up: true,
                    validation_performed: true
                };
                
                fs.writeFile(
                    preAutoProfileBackupDir + "backup_info.json", 
                    JSON.stringify(marker, null, 2), 
                    function(markerErr) {
                        if (markerErr) {
                            log.warn("Failed to create backup marker file: " + markerErr.message);
                        }
                        log.info("Pre-auto-profile backup created successfully with validation");
                        callback(null);
                    }
                );
            });
        });
    } catch (err) {
        log.error("Error creating pre-auto-profile backup: " + err.message);
        callback(err);
    }
}

// NEW: Function to restore from pre-auto-profile backup
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
function startWatcher() {
    // Copy existing files to the backup directory at the start
    copyExistingFiles();

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

module.exports = {
    startWatcher,
    copyBackupAtStart,
    createPreAutoProfileBackup,           // NEW
    restoreFromPreAutoProfileBackup,      // NEW  
    hasPreAutoProfileBackup,              // NEW
    getPreAutoProfileBackupInfo           // NEW
};
