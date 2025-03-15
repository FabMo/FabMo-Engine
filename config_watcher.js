const chokidar = require("chokidar");
const fs = require("fs-extra");
const path = require("path");
const log = require("./log").logger("watcher");

// Directories to watch
//const watchDirs = ["/opt/fabmo/config/", "/opt/fabmo/macros/", "/opt/fabmo/apps/", "/opt/fabmo/approot/"];
const watchDirs = ["/opt/fabmo/config/", "/opt/fabmo/macros/", "/opt/fabmo/apps/"];

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

// Function to create a backup
const createBackup = debounce((filePath) => {
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
        }
    });
}, 10); // Adjust the debounce wait time here

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
    // .on("unlink", (filePath) => {
    //     log.info(`File removed: ${filePath}`);
    //     const relativePath = path.relative(watchDirs.find(dir => filePath.startsWith(dir)), filePath);
    //     const backupPath = path.join(backupDir, relativePath);
    //     fs.remove(backupPath, (err) => {
    //         if (err) {
    //             log.error(`Error removing backup for ${filePath}:`, err);
    //         } else {
    //             log.info(`Backup removed for ${filePath}`);
    //         }
    //     });
    // });

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
};
