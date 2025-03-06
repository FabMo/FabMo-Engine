const chokidar = require("chokidar");
const fs = require("fs-extra");
const path = require("path");
const log = require("./log").logger("watcher");

// Directory to watch
const watchDir = "/opt/fabmo/config/";

// Directory to store backups
const backupDir = "/opt/fabmo_backup/config/";

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
    const relativePath = path.relative(watchDir, filePath);
    const backupPath = path.join(backupDir, relativePath);
    log.info(`Creating backup for ${filePath} at ${backupPath}`);
    fs.copy(filePath, backupPath, (err) => {
        if (err) {
            log.error(`Error creating backup for ${filePath}:`, err);
        } else {
            log.info(`Backup created for ${filePath}`);
        }
    });
}, 10); // Adjust the debounce wait time here

// Function to start the watcher
function startWatcher() {
    // Initialize watcher with awaitWriteFinish
    const watcher = chokidar.watch(watchDir, {
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
            log.info(`File added: ${filePath}`);
            createBackup(filePath);
        })
        .on("change", (filePath) => {
            log.info(`File changed: ${filePath}`);
            createBackup(filePath);
        })
        .on("unlink", (filePath) => {
            log.info(`File removed: ${filePath}`);
            const relativePath = path.relative(watchDir, filePath);
            const backupPath = path.join(backupDir, relativePath);
            fs.remove(backupPath, (err) => {
                if (err) {
                    log.error(`Error removing backup for ${filePath}:`, err);
                } else {
                    log.info(`Backup removed for ${filePath}`);
                }
            });
        });

    log.info(`Watching for changes in ${watchDir}`);

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
};
