// This is the implementation for /fabmo/routes/usbFileRoutes.js
const fs = require("fs");
const path = require("path");
const util = require("util");
const exec = util.promisify(require("child_process").exec);
const readdir = util.promisify(fs.readdir);
const stat = util.promisify(fs.stat);

// USB mount points are typically under /media/pi or /mnt in Raspbian/Bookworm
const USB_MOUNT_POINTS = ["/media/pi", "/media/root", "/mnt"];

module.exports = function (router) {
    // Get list of connected USB drives
    router.get("/usb/devices", async function (req, res) {
        try {
            const usbDevices = await getConnectedUSBDevices();
            res.json({
                status: "success",
                data: {
                    devices: usbDevices,
                },
            });
        } catch (err) {
            console.error("Error listing USB devices:", err);
            res.status(500).json({
                status: "fail",
                data: {
                    message: "Failed to list USB devices",
                    error: err.message,
                },
            });
        }
    });

    // List directory contents on USB drive
    router.get("/usb/dir", async function (req, res) {
        const { path: dirPath } = req.query;

        if (!dirPath) {
            return res.status(400).json({
                status: "fail",
                data: {
                    message: "Directory path is required",
                },
            });
        }

        try {
            // Validate path is within USB mount point (security check)
            if (!isValidUSBPath(dirPath)) {
                return res.status(403).json({
                    status: "fail",
                    data: {
                        message: "Invalid USB path",
                    },
                });
            }

            const contents = await listDirectory(dirPath);
            res.json({
                status: "success",
                data: {
                    contents: contents,
                },
            });
        } catch (err) {
            console.error("Error listing directory:", err);
            res.status(500).json({
                status: "fail",
                data: {
                    message: "Failed to list directory",
                    error: err.message,
                },
            });
        }
    });

    // Submit a file from USB drive as a job
    router.post("/usb/submit", async function (req, res) {
        const { path: filePath, options } = req.body;

        if (!filePath) {
            return res.status(400).json({
                status: "fail",
                data: {
                    message: "File path is required",
                },
            });
        }

        try {
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
            try {
                await fs.promises.access(filePath, fs.constants.R_OK);
            } catch (err) {
                return res.status(404).json({
                    status: "fail",
                    data: {
                        message: "File not found or not readable",
                    },
                });
            }

            // Read file contents
            const fileContents = await fs.promises.readFile(filePath);
            const fileName = path.basename(filePath);

            // Submit job using existing job submission logic
            const jobManager = req.app.get("jobManager");
            const job = await jobManager.createJob({
                file_data: fileContents,
                file_name: fileName,
                description: `Loaded from USB: ${fileName}`,
            });

            res.json({
                status: "success",
                data: {
                    job: job,
                },
            });
        } catch (err) {
            console.error("Error submitting job from USB:", err);
            res.status(500).json({
                status: "fail",
                data: {
                    message: "Failed to submit job",
                    error: err.message,
                },
            });
        }
    });

    // Helper function to get connected USB devices
    async function getConnectedUSBDevices() {
        const devices = [];

        // Check common USB mount points
        for (const mountPoint of USB_MOUNT_POINTS) {
            try {
                // Check if mount point exists
                try {
                    await fs.promises.access(mountPoint, fs.constants.F_OK);
                } catch (err) {
                    // Mount point doesn't exist, skip it
                    continue;
                }

                const entries = await readdir(mountPoint);

                for (const entry of entries) {
                    const fullPath = path.join(mountPoint, entry);
                    try {
                        const stats = await stat(fullPath);
                        if (stats.isDirectory()) {
                            // Additional check to ensure it's a USB drive
                            const isUSB = await isUSBDrive(fullPath);
                            if (isUSB) {
                                devices.push({
                                    name: entry,
                                    path: fullPath,
                                });
                            }
                        }
                    } catch (err) {
                        console.error(`Error checking ${fullPath}:`, err);
                    }
                }
            } catch (err) {
                // It's okay if some mount points don't exist
                if (err.code !== "ENOENT") {
                    console.error(`Error reading ${mountPoint}:`, err);
                }
            }
        }

        return devices;
    }

    // Helper function to check if path is within a USB mount point
    function isValidUSBPath(testPath) {
        return USB_MOUNT_POINTS.some((mountPoint) => testPath.startsWith(mountPoint));
    }

    // Helper function to check if a directory is likely a USB drive
    async function isUSBDrive(dirPath) {
        try {
            // First, a simple heuristic - if it's directly under a known mount point
            for (const mountPoint of USB_MOUNT_POINTS) {
                if (
                    dirPath.startsWith(mountPoint) &&
                    dirPath.split(path.sep).length === mountPoint.split(path.sep).length + 1
                ) {
                    return true;
                }
            }

            // For more complex cases, try to use lsblk
            try {
                const { stdout } = await exec(
                    `lsblk -o MOUNTPOINT | grep -q "^${dirPath}$" && echo "true" || echo "false"`
                );
                return stdout.trim() === "true";
            } catch (err) {
                // If lsblk fails, use a fallback approach - check for typical USB drive content
                const entries = await readdir(dirPath);
                const typicalUsbFiles = ["System Volume Information", ".Spotlight-V100", ".fseventsd", ".Trashes"];

                // If any typical USB system files are found, it's likely a USB drive
                return entries.some((entry) => typicalUsbFiles.includes(entry));
            }
        } catch (err) {
            console.error("Error checking if directory is USB drive:", err);
            return false;
        }
    }

    // Helper function to list directory contents
    async function listDirectory(dirPath) {
        const entries = await readdir(dirPath);
        const contents = [];

        for (const entry of entries) {
            // Skip hidden files and directories
            if (entry.startsWith(".")) {
                continue;
            }

            const fullPath = path.join(dirPath, entry);
            try {
                const stats = await stat(fullPath);
                contents.push({
                    name: entry,
                    path: fullPath,
                    size: stats.size,
                    isDirectory: stats.isDirectory(),
                    modifiedTime: stats.mtime,
                });
            } catch (err) {
                console.error(`Error getting stats for ${fullPath}:`, err);
            }
        }

        // Sort directories first, then files alphabetically
        contents.sort((a, b) => {
            if (a.isDirectory && !b.isDirectory) return -1;
            if (!a.isDirectory && b.isDirectory) return 1;
            return a.name.localeCompare(b.name);
        });

        return contents;
    }
};
