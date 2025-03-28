// /fabmo/routes/usbFileRoutes.js
const fs = require("fs-extra"); // Using fs-extra for more features
const path = require("path");
const util = require("../util");
const exec = require("child_process").exec;
const crypto = require("crypto");
const db = require("../db");
const logger = require("../log").logger("routes");
const config = require("../config");

// USB mount points are typically under /media/pi or /mnt in Raspbian/Bookworm
const USB_MOUNT_POINTS = ["/media/pi", "/media/root", "/mnt"];

module.exports = function (server) {
    // Get list of connected USB drives
    server.get("/usb/devices", function (req, res, next) {
        getConnectedUSBDevices(function (err, usbDevices) {
            if (err) {
                logger.error("Error listing USB devices:", err);
                return res.json({
                    status: "fail",
                    data: {
                        message: "Failed to list USB devices",
                        error: err.message,
                    },
                });
            }

            res.json({
                status: "success",
                data: {
                    devices: usbDevices,
                },
            });
        });
    });

    // List directory contents on USB drive
    server.get("/usb/dir", function (req, res, next) {
        const { path: dirPath } = req.query;

        if (!dirPath) {
            return res.status(400).json({
                status: "fail",
                data: {
                    message: "Directory path is required",
                },
            });
        }

        // Validate path is within USB mount point (security check)
        if (!isValidUSBPath(dirPath)) {
            return res.status(403).json({
                status: "fail",
                data: {
                    message: "Invalid USB path",
                },
            });
        }

        listDirectory(dirPath, function (err, contents) {
            if (err) {
                logger.error("Error listing directory:", err);
                return res.status(500).json({
                    status: "fail",
                    data: {
                        message: "Failed to list directory",
                        error: err.message,
                    },
                });
            }

            res.json({
                status: "success",
                data: {
                    contents: contents,
                },
            });
        });
    });

    // Submit a file from USB drive as a job
    server.post("/usb/submit", function (req, res, next) {
        const { path: filePath } = req.body;

        if (!filePath) {
            return res.status(400).json({
                status: "fail",
                data: {
                    message: "File path is required",
                },
            });
        }

        // Validate path is within USB mount point (security check)
        if (!isValidUSBPath(filePath)) {
            return res.status(403).json({
                status: "fail",
                data: {
                    message: "Invalid USB path",
                },
            });
        }

        // Check if file exists and is readable
        fs.access(filePath, fs.constants.R_OK, function (err) {
            if (err) {
                return res.status(404).json({
                    status: "fail",
                    data: {
                        message: "File not found or not readable",
                    },
                });
            }

            const fileName = path.basename(filePath);

            // Reject disallowed files
            if (typeof util.allowed_file === "function" && !util.allowed_file(fileName)) {
                logger.error(`File ${fileName} is not allowed.`);
                return res.status(400).json({
                    status: "fail",
                    data: {
                        message: `File ${fileName} is not allowed.`,
                    },
                });
            }

            // Copy file to temporary location
            const tempDir = config.getDataDir("tmp");
            const tempPath = path.join(tempDir, "usb-" + Date.now() + "-" + fileName);

            fs.copy(filePath, tempPath, function (err) {
                if (err) {
                    logger.error("Error copying file from USB:", err);
                    return res.status(500).json({
                        status: "fail",
                        data: {
                            message: "Failed to copy file from USB",
                            error: err.message,
                        },
                    });
                }

                // Create job options
                const jobOptions = {
                    filename: fileName,
                    name: fileName,
                    description: `Loaded from USB: ${fileName}`,
                    index: 0, // Default index for order calculation
                };

                // Create file object
                const fileObject = {
                    name: fileName,
                    path: tempPath,
                };

                // Submit job
                db.createJob(fileObject, jobOptions, function (err, job) {
                    if (err) {
                        logger.error("Error creating job:", err);
                        return res.status(500).json({
                            status: "fail",
                            data: {
                                message: "Failed to create job",
                                error: err.message,
                            },
                        });
                    }

                    logger.info("Created job from USB file: " + fileName);
                    return res.json({
                        status: "success",
                        data: {
                            job: job,
                        },
                    });
                });
            });
        });
    });

    // Helper function to get connected USB devices
    function getConnectedUSBDevices(callback) {
        const devices = [];
        let checkedCount = 0;
        let mountPointCount = USB_MOUNT_POINTS.length;

        // Check if all mount points have been processed
        function checkComplete() {
            checkedCount++;
            if (checkedCount >= mountPointCount) {
                callback(null, devices);
            }
        }

        // Process each mount point
        USB_MOUNT_POINTS.forEach(function (mountPoint) {
            fs.access(mountPoint, fs.constants.F_OK, function (err) {
                if (err) {
                    // Mount point doesn't exist, skip it
                    checkComplete();
                    return;
                }

                fs.readdir(mountPoint, function (err, entries) {
                    if (err) {
                        logger.error(`Error reading ${mountPoint}:`, err);
                        checkComplete();
                        return;
                    }

                    let processedEntries = 0;

                    if (entries.length === 0) {
                        checkComplete();
                        return;
                    }

                    entries.forEach(function (entry) {
                        const fullPath = path.join(mountPoint, entry);

                        fs.stat(fullPath, function (err, stats) {
                            if (err) {
                                logger.error(`Error checking ${fullPath}:`, err);
                                processedEntries++;
                                if (processedEntries >= entries.length) {
                                    checkComplete();
                                }
                                return;
                            }

                            if (stats.isDirectory()) {
                                // Check if the directory has any visible content
                                hasDriveContent(fullPath, function (err, hasContent) {
                                    processedEntries++;

                                    if (err) {
                                        logger.error(`Error checking contents of ${fullPath}:`, err);
                                    } else if (hasContent) {
                                        // Only add drives that have actual content
                                        devices.push({
                                            name: entry,
                                            path: fullPath,
                                        });
                                    } else {
                                        logger.info(`Skipping empty drive: ${entry} at ${fullPath}`);
                                    }

                                    if (processedEntries >= entries.length) {
                                        checkComplete();
                                    }
                                });
                            } else {
                                processedEntries++;
                                if (processedEntries >= entries.length) {
                                    checkComplete();
                                }
                            }
                        });
                    });
                });
            });
        });

        // If no mount points are found at all, return empty array
        if (mountPointCount === 0) {
            callback(null, []);
        }
    }

    // Check if a drive has any visible content (non-hidden files/directories)
    function hasDriveContent(dirPath, callback) {
        fs.readdir(dirPath, function (err, entries) {
            if (err) {
                return callback(err, false);
            }

            // Filter out hidden files/folders (starting with .)
            const visibleEntries = entries.filter((entry) => !entry.startsWith("."));

            // If there are any visible entries, the drive has content
            callback(null, visibleEntries.length > 0);
        });
    }

    // Helper function to check if path is within a USB mount point
    function isValidUSBPath(testPath) {
        return USB_MOUNT_POINTS.some((mountPoint) => testPath.startsWith(mountPoint));
    }

    // Helper function to list directory contents
    function listDirectory(dirPath, callback) {
        fs.readdir(dirPath, function (err, entries) {
            if (err) {
                return callback(err);
            }

            const contents = [];
            let processedCount = 0;

            if (entries.length === 0) {
                return callback(null, contents);
            }

            entries.forEach(function (entry) {
                // Skip hidden files and directories
                if (entry.startsWith(".")) {
                    processedCount++;
                    if (processedCount >= entries.length) {
                        callback(null, sortDirectoryContents(contents));
                    }
                    return;
                }

                const fullPath = path.join(dirPath, entry);

                fs.stat(fullPath, function (err, stats) {
                    processedCount++;

                    if (err) {
                        logger.error(`Error getting stats for ${fullPath}:`, err);
                    } else {
                        contents.push({
                            name: entry,
                            path: fullPath,
                            size: stats.size,
                            isDirectory: stats.isDirectory(),
                            modifiedTime: stats.mtime,
                        });
                    }

                    if (processedCount >= entries.length) {
                        callback(null, sortDirectoryContents(contents));
                    }
                });
            });
        });
    }

    // Helper function to sort directory contents (directories first, then files)
    function sortDirectoryContents(contents) {
        return contents.sort(function (a, b) {
            if (a.isDirectory && !b.isDirectory) return -1;
            if (!a.isDirectory && b.isDirectory) return 1;
            return a.name.localeCompare(b.name);
        });
    }
};
