var util = require("../util");
var machine = require("../machine").machine;
var config = require("../config");
var log = require("../log").logger("config-routes");
var engine = require("../engine");
var profiles = require("../profiles");

const fs = require("fs");
const path = require("path");
const archiver = require("archiver");
const extract = require("extract-zip");
const { runtime } = require("webpack");

const macrosDir = "/opt/fabmo/macros/";
const tempDir = "/tmp/";
const backupFile = path.join(tempDir, "fabmo_macros_backup.zip");
const macros = require("../macros");

/**
 * @api {get} /status Engine status
 * @apiGroup Status
 * @apiDescription Get a system status report, which includes tool position, IO states, current job, progress, etc.
 * @apiSuccess {String} status `success`
 * @apiSuccess {Object} data Response data
 * @apiSuccess {Object} data.status Status info
 * @apiSuccess {String} data.status.state `idle` | `running` | `paused` | `stopped`
 * @apiSuccess {Number} data.status.posx X Position
 * @apiSuccess {Number} data.status.posy Y Position
 * @apiSuccess {Number} data.status.posz Z Position
 * @apiSuccess {Number} data.status.posa A Position
 * @apiSuccess {Number} data.status.posb B Position
 * @apiSuccess {Number} data.status.posc C Position
 * @apiSuccess {Object} data.status.job Current Job | `null`
 * @apiSuccess {String} data.status.job.state `pending` | `running` | `finished` | `cancelled`
 * @apiSuccess {String} data.status.job.name Human readable job name
 * @apiSuccess {String} data.status.job.description Job description
 * @apiSuccess {Number} data.status.job.created_at Time job was added to the queue (UNIX timestamp)
 * @apiSuccess {Number} data.status.job.started_at Time job was started (UNIX timestamp)
 * @apiSuccess {Number} data.status.job.finished_at Time job was finished (UNIX timestamp)
 */
// eslint-disable-next-line no-unused-vars
var get_status = function (req, res, next) {
    var answer = {
        status: "success",
        data: { status: machine.status },
    };
    res.json(answer);
};

/**
 * @api {get} /config Get Engine configuration
 * @apiGroup Config
 * @apiDescription Dictionary
 * @apiSuccess {String} status `success`
 * @apiSuccess {Object} data Response data
 * @apiSuccess {Object} data.engine Key-value map of all engine settings
 * @apiSuccess {Object} data.driver Key-value map of all G2 driver settings
 * @apiSuccess {Object} data.opensbp Key-value map of all OpenSBP runtime settings
 */
// eslint-disable-next-line no-unused-vars
var get_config = function (req, res, next) {
    var retval = {};
    retval.engine = config.engine.getData();
    retval.driver = config.driver.getData();
    retval.opensbp = config.opensbp?.getData();
    retval.machine = config.machine.getData();
    retval.profiles = config.profiles.getData();
    var answer = {
        status: "success",
        data: { config: retval },
    };
    res.json(answer);
};

/**
 * @api {post} /config Update engine configuration
 * @apiGroup Config
 * @apiDescription Incorporate the POSTed object into the engine configuration.  Configuration updates take effect immediately.
 * @apiParam {Object} engine Key-value map of updates to engine settings
 * @apiParam {Object} driver Key-value map of updates to G2 driver settings
 * @apiParam {Object} opensbp Key-value map of updates to OpenSBP settings
 * @apiParam {Object} machine Key-value map of updates to Machine settings
 */
// eslint-disable-next-line no-unused-vars
var post_config = function (req, res, next) {
    var answer;
    var final_result = {};
    log.debug("client request for config update" + JSON.stringify(req.params));
    var setMany_remaining = 0;
    ["engine", "driver", "opensbp", "machine"].forEach(function (each) {
        if (each in req.params) {
            setMany_remaining += 1;
        }
    });

    if ("engine" in req.params) {
        config.engine.setMany(
            util.fixJSON(req.params.engine),
            // eslint-disable-next-line no-unused-vars
            function (err, result) {
                if (!setMany_remaining) return;
                config.engine.apply(function (err, result) {
                    if (!setMany_remaining) return;
                    if (err) {
                        answer = {
                            status: "fail",
                            data: {
                                body: "the configuration data you submitted is not valid",
                            },
                        };
                        res.json(answer);
                        setMany_remaining = 0;
                        return;
                    } else {
                        final_result.engine = result;
                        setMany_remaining--;
                        if (!setMany_remaining) {
                            answer = {
                                status: "success",
                                data: final_result,
                            };
                            res.json(answer);
                        }
                    }
                });
            }
        );
    }

    if ("driver" in req.params) {
        config.driver.setMany(util.fixJSON(req.params.driver), function (err, result) {
            if (!setMany_remaining) return;
            if (err) {
                answer = {
                    status: "fail",
                    data: {
                        body: "the configuration data you submitted is not valid",
                    },
                };
                res.json(answer);
                setMany_remaining = 0;
                return;
            } else {
                final_result.driver = result;
                setMany_remaining--;
                if (!setMany_remaining) {
                    answer = {
                        status: "success",
                        data: final_result,
                    };
                    res.json(answer);
                }
            }
        });
    }

    if ("opensbp" in req.params) {
        config.opensbp.setMany(
            util.fixJSON(req.params.opensbp),
            function (err, result) {
                if (!setMany_remaining) return;
                if (err) {
                    answer = {
                        status: "fail",
                        data: {
                            body: "the configuration data you submitted is not valid",
                        },
                    };
                    res.json(answer);
                    setMany_remaining = 0;
                    return;
                } else {
                    final_result.opensbp = result;
                    setMany_remaining--;
                    if (!setMany_remaining) {
                        answer = {
                            status: "success",
                            data: final_result,
                        };
                        res.json(answer);
                    }
                }
            },
            true
        );
    }

    if ("machine" in req.params) {
        if (!setMany_remaining) return;
        config.machine.setMany(
            util.fixJSON(req.params.machine),
            // eslint-disable-next-line no-unused-vars
            function (err, result) {
                if (!setMany_remaining) return;
                config.machine.apply(function (err, result) {
                    if (err) {
                        answer = {
                            status: "fail",
                            data: {
                                body: "the configuration data you submitted is not valid",
                            },
                        };
                        res.json(answer);
                        setMany_remaining = 0;
                        return;
                    } else {
                        final_result.machine = result;
                        setMany_remaining--;
                        if (!setMany_remaining) {
                            answer = {
                                status: "success",
                                data: final_result,
                            };
                            res.json(answer);
                        }
                    }
                });
            }
        );
    }
};

// eslint-disable-next-line no-unused-vars
var get_version = function (req, res, next) {
    var answer = {
        status: "success",
        data: { version: engine.version },
    };
    res.json(answer);
};

// eslint-disable-next-line no-unused-vars
var get_info = function (req, res, next) {
    engine.getInfo(function (err, info) {
        res.json({
            status: "success",
            data: { info: info },
        });
    });
};

// eslint-disable-next-line no-unused-vars
var getProfiles = function (req, res, next) {
    res.json({
        status: "success",
        data: { profiles: profiles.getProfiles() },
    });
};

// Backup Macros
const backup_macros = function (req, res, next) {
    const output = fs.createWriteStream(backupFile);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", function () {
        // Set headers for file download
        res.setHeader("Content-Disposition", 'attachment; filename="fabmo_macros_backup.zip"');
        res.setHeader("Content-Type", "application/zip");

        // Stream the file to the client
        const fileStream = fs.createReadStream(backupFile);
        fileStream.pipe(res);

        fileStream.on("end", function () {
            log.info("Macros backup sent successfully.");
            next(); // Call next to complete the Restify request lifecycle
        });

        fileStream.on("error", function (err) {
            log.error("Failed to send backup file:", err);
            res.status(500);
            res.json({ status: "error", message: "Failed to send backup file." });
            next();
        });
    });

    archive.on("error", function (err) {
        log.error("Failed to create backup:", err);
        res.status(500);
        res.json({ status: "error", message: "Failed to create backup." });
        next();
    });

    archive.pipe(output);
    archive.directory(macrosDir, false);
    archive.finalize();
};

// Function to check if a file is a ZIP file
function isZipFile(filePath) {
    try {
        // Read the first 4 bytes to check for ZIP signature
        const fd = fs.openSync(filePath, "r");
        const buffer = Buffer.alloc(4);
        fs.readSync(fd, buffer, 0, 4, 0);
        fs.closeSync(fd);

        // Check for ZIP signature (PK\x03\x04)
        return buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
    } catch (err) {
        log.error(`Error checking if ${filePath} is a ZIP file:`, err);
        return false;
    }
}

// Function to find recently modified files in a directory
function findRecentlyModifiedFiles(directory, secondsAgo = 10) {
    const files = fs.readdirSync(directory);
    const now = Date.now();
    const recentFiles = [];

    for (const file of files) {
        const filePath = path.join(directory, file);
        try {
            const stats = fs.statSync(filePath);
            // Check if file was created/modified within the last few seconds
            if ((now - stats.mtime.getTime()) / 1000 < secondsAgo) {
                recentFiles.push({
                    path: filePath,
                    name: file,
                    size: stats.size,
                    mtime: stats.mtime,
                });
            }
        } catch (err) {
            // Skip files we can't access
            log.warn(`Could not stat file ${filePath}:`, err);
        }
    }

    // Sort by modification time (newest first)
    return recentFiles.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
}

// Handler function for the macros restore endpoint
function handleMacrosRestore(req, res, next) {
    log.info("Macro restore endpoint hit");
    log.info("Content-Type:", req.headers["content-type"]);

    // Look for recently modified files in the temp directory
    const recentFiles = findRecentlyModifiedFiles(tempDir);
    log.info(`Found ${recentFiles.length} recently modified files in temp directory`);

    // Filter for ZIP files with non-zero size
    const zipCandidates = recentFiles.filter(
        (file) => file.size > 0 && isZipFile(file.path) && file.name.startsWith("upload_")
    );

    log.info(`Found ${zipCandidates.length} potential ZIP files`);

    if (zipCandidates.length === 0) {
        log.error("No valid ZIP files found in recent uploads");
        res.send(400, { status: "error", message: "No valid ZIP files found in upload" });
        return next();
    }

    // Use the most recently modified ZIP file
    const zipFile = zipCandidates[0];
    log.info(`Using ZIP file: ${zipFile.path} (${zipFile.size} bytes)`);

    // Try to get the original filename from form data if available
    let originalFilename = "macros_backup.zip"; // Default name

    // If req.files is available (indicates a bodyParser has processed the upload)
    if (req.files && Object.keys(req.files).length > 0) {
        const fileField = Object.keys(req.files)[0];
        const fileInfo = req.files[fileField];

        if (fileInfo && fileInfo.name) {
            originalFilename = fileInfo.name;
            log.info(`Got original filename from request: ${originalFilename}`);
        }
    }
    // If the body has a file field with a name property
    else if (req.body && req.body.file && req.body.file.name) {
        originalFilename = req.body.file.name;
        log.info(`Got original filename from request body: ${originalFilename}`);
    }

    // Extract the ZIP file directly
    extractAndProcess(zipFile.path, originalFilename, res, next);
}

// Function to extract and process the ZIP file
async function extractAndProcess(zipFilePath, originalFilename, res, next) {
    try {
        log.info(`Starting extraction of ${zipFilePath}`);
        log.info(`Original filename: ${originalFilename}`);

        // Ensure macros directory exists
        if (!fs.existsSync(macrosDir)) {
            fs.mkdirSync(macrosDir, { recursive: true });
            log.info(`Created macros directory: ${macrosDir}`);
        }

        try {
            // Extract the ZIP file
            await extract(zipFilePath, { dir: macrosDir });
            log.info("Extraction completed successfully");

            // List extracted files
            try {
                const files = fs.readdirSync(macrosDir);
                log.info(`Files in macros directory after extraction: ${files.join(", ")}`);
                macros.load(function (err) {
                    if (err) {
                        log.error(`Error loading macros: ${err.message}`);
                        //return res.status(500).json({status: "error", message: err.message});
                    }
                    log.info("Macros loaded successfully");
                    //res.json({status: "success"});
                });
            } catch (e) {
                log.warn(`Could not list files in macros directory: ${e.message}`);
            }

            // Send success response
            res.send(200, {
                status: "success",
                message: "Macros restored successfully",
                filename: originalFilename,
            });
            return next();
        } catch (extractErr) {
            log.error(`Error extracting ZIP file: ${extractErr.message}`);
            res.send(500, { status: "error", message: "Error extracting ZIP file: " + extractErr.message });
            return next();
        }
    } catch (err) {
        log.error(`Error in extractAndProcess: ${err.message}`);
        res.send(500, { status: "error", message: "Error processing ZIP file: " + err.message });
        return next();
    }
}

// Auto-profile status endpoint
// eslint-disable-next-line no-unused-vars
var get_auto_profile_status = function (req, res, next) {
    try {
        if (fs.existsSync("/opt/fabmo/config/.auto_profile_applied")) {
            var marker = JSON.parse(fs.readFileSync("/opt/fabmo/config/.auto_profile_applied", "utf8"));
            res.json({
                status: "success",
                data: {
                    auto_applied: true,
                    profile_name: marker.profile_applied,
                    applied_at: marker.applied_at,
                },
            });
        } else {
            res.json({
                status: "success",
                data: { auto_applied: false },
            });
        }
    } catch (err) {
        log.error("Error reading auto-profile status: " + err.message);
        res.json({
            status: "success",
            data: { auto_applied: false, error: err.message },
        });
    }
    next();
};

// Manual profile change endpoint
// eslint-disable-next-line no-unused-vars
var post_manual_profile_change = function (req, res, next) {
    var targetProfile = req.params.profile;

    if (!targetProfile) {
        return res.json({
            status: "error",
            message: "No profile specified",
        });
    }

    log.info("Manual profile change requested: " + targetProfile);

    var profileDef = require("../config/profile_definition");

    // If auto-profile is active, disable it permanently
    if (profileDef.hasAutoProfileDefinition()) {
        log.info("Disabling auto-profile system due to manual profile change");

        var currentDefinition = profileDef.read();
        if (currentDefinition && currentDefinition.auto_profile.profile_name) {
            profileDef.markAsApplied(currentDefinition.auto_profile.profile_name, function (err) {
                if (err) {
                    log.warn("Could not disable auto-profile: " + err.message);
                }

                log.info("Auto-profile disabled - proceeding with manual profile change");
                applyManualProfileChange(targetProfile, res, next);
            });
        } else {
            applyManualProfileChange(targetProfile, res, next);
        }
    } else {
        // No auto-profile active, proceed normally
        applyManualProfileChange(targetProfile, res, next);
    }
};

// Helper function for manual profile changes
function applyManualProfileChange(profileName, res, next) {
    // Set the engine config to the user's choice
    config.engine.set("profile", profileName, function (err) {
        if (err) {
            log.error("Failed to set manual profile: " + err.message);
            return res.json({
                status: "error",
                message: "Failed to set profile: " + err.message,
            });
        }

        log.info("Manual profile change completed: " + profileName);

        res.json({
            status: "success",
            message: "Profile change initiated",
        });

        // Restart after a short delay
        setTimeout(function () {
            log.info("Restarting for manual profile change...");
            process.exit(0);
        }, 1000);
    });

    next();
}

// Get backup restore status
var get_backup_restore_status = function (req, res, next) {
    var configWatcher = require("../config_watcher");
    
    try {
        if (configWatcher.hasPreAutoProfileBackup()) {
            configWatcher.getPreAutoProfileBackupInfo(function(err, info) {
                if (err) {
                    res.json({
                        status: "error", 
                        message: err.message
                    });
                    return next();
                }
                
                // Only prompt if this backup is from a recent auto-profile process
                var shouldPrompt = false;
                
                // Check if auto-profile was recently applied
                try {
                    if (fs.existsSync("/opt/fabmo/config/.auto_profile_applied")) {
                        var marker = JSON.parse(fs.readFileSync("/opt/fabmo/config/.auto_profile_applied", "utf8"));
                        var backupTime = new Date(info.created_at).getTime();
                        var applyTime = new Date(marker.applied_at).getTime();
                        
                        // Only show modal if backup was created BEFORE the auto-profile was applied
                        // and both happened recently (within last 24 hours)
                        var now = Date.now();
                        var twentyFourHours = 24 * 60 * 60 * 1000;
                        
                        if (backupTime < applyTime && 
                            (now - applyTime) < twentyFourHours && 
                            (now - backupTime) < twentyFourHours) {
                            shouldPrompt = true;
                            log.info("Auto-profile backup restore available - showing modal");
                        } else {
                            log.debug("Backup exists but not from recent auto-profile process");
                        }
                    }
                } catch (markerErr) {
                    log.debug("Could not read auto-profile marker: " + markerErr.message);
                }
                
                res.json({
                    status: "success",
                    data: {
                        backup_available: true,
                        backup_info: info,
                        should_prompt: shouldPrompt  // ← key flag
                    }
                });
                next();
            });
        } else {
            res.json({
                status: "success",
                data: {
                    backup_available: false,
                    should_prompt: false
                }
            });
            next();
        }
    } catch(err) {
        res.json({
            status: "error",
            message: "Error checking backup: " + err.message
        });
        next();
    }
};

// Restore from pre-auto-profile backup
var post_restore_backup = function (req, res, next) {
    var configWatcher = require("../config_watcher");
    
    log.info("User requested restore from pre-auto-profile backup");
    
    try {
        configWatcher.restoreFromPreAutoProfileBackup(function(err) {
            if (err) {
                log.error("Failed to restore from backup: " + err.message);
                res.json({
                    status: "error",
                    message: "Failed to restore backup: " + err.message
                });
                return next(); 
            }
            
            log.info("Pre-auto-profile backup restored successfully");
            res.json({
                status: "success",
                message: "Backup restored successfully - engine will restart"
            });
            
            next();
            
            // Restart after a short delay
            setTimeout(function() {
                log.info("Restarting engine after backup restore...");
                process.exit(0);
            }, 1000);
        });
    } catch(err) {
        res.json({
            status: "error",
            message: "Error during restore: " + err.message
        });
        next();
    }
    
};

var get_backup_status = function (req, res, next) {
    var configWatcher = require("../config_watcher");
    
    try {
        var status = configWatcher.getBackupStatus();
        res.json({
            status: "success",
            data: status
        });
    } catch (err) {
        log.error("Error getting backup status: " + err.message);
        res.json({
            status: "error",
            message: "Failed to get backup status: " + err.message
        });
    }
    next();
};

var dismiss_backup_restore = function (req, res, next) {
    log.info("User dismissed backup restore modal - cleaning up markers");
    
    try {
        // Remove the auto-profile marker file
        const markerPath = "/opt/fabmo/config/.auto_profile_applied";
        if (fs.existsSync(markerPath)) {
            fs.unlinkSync(markerPath);
            log.info("Removed auto-profile marker file");
        }
        
        // Optionally remove the pre-auto-profile backup to fully clean up
        // (or just mark it as "dismissed" somehow)
        const configWatcher = require("../config_watcher");
        configWatcher.cleanupPreAutoProfileBackup(function(cleanupErr) {
            if (cleanupErr) {
                log.warn("Could not clean up pre-auto-profile backup: " + cleanupErr.message);
            } else {
                log.info("Cleaned up pre-auto-profile backup");
            }
            
            res.json({
                status: "success",
                message: "Backup restore dismissed and markers cleaned up"
            });
            next();
        });
        
    } catch (err) {
        log.error("Error dismissing backup restore: " + err.message);
        res.json({
            status: "error",
            message: "Error dismissing backup restore: " + err.message
        });
        next();
    }
};

module.exports = function (server) {
    server.post("/macros/restore", handleMacrosRestore);
    server.get("/macros/backup", backup_macros);
    server.get("/status", get_status);
    server.get("/config", get_config);
    server.post("/config", post_config);
    server.get("/version", get_version);
    server.get("/info", get_info);
    server.get("/profiles", getProfiles);
    server.get("/config/auto-profile-status", get_auto_profile_status);

    server.post("/profile/manual-change", post_manual_profile_change);

    server.get("/config/backup-status", get_backup_status);

    server.post('/config/dismiss-backup-restore', dismiss_backup_restore);
    server.get("/config/backup-restore-status", get_backup_restore_status);
    server.post("/config/restore-backup", post_restore_backup);
};
