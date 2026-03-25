var upload = require("./util").upload;
var exec = require("child_process").exec;
var fs = require("fs");
var path = require("path");
var engine = require("../engine");

var PORTS = ["/dev/fabmo_g2_motion", "/dev/ttyACM0", "/dev/ttyACM1", "/dev/ttyACM2"];
var DEFAULT_FIRMWARE = "/fabmo/firmware/g2.bin";

// Try each port in sequence until bossac succeeds on one.
// This handles the VFD (or other device) claiming ttyACM0,
// pushing the G2 SAM-BA bootloader to ttyACM1 or ttyACM2.
var tryFlashPort = function (ports, binPath, index, callback) {
    if (index >= ports.length) {
        return callback(new Error("bossac could not find a SAM-BA device on any port"));
    }
    var port = ports[index];
    log.info("Trying bossac on " + port);
    exec("bossac -e -w -v --port=" + port + " " + binPath, function (err, result) {
        if (err) {
            log.info("Port " + port + " failed, trying next...");
            return tryFlashPort(ports, binPath, index + 1, callback);
        }
        log.info("Success flash on " + port + ": " + result);
        exec("bossac -b --port=" + port, function (err, result) {
            if (err) {
                return callback(new Error("Error setting boot flag on " + port + ": " + err));
            }
            log.info("Success boot flag on " + port + ": " + result);
            exec("bossac -R --port=" + port, function (err) {
                if (err) {
                    return callback(new Error("Error resetting on " + port + ": " + err));
                }
                log.info("Success resetting — restarting engine");
                process.exit(1);
            });
        });
    });
};

// Core flash sequence: stop engine, trigger bootloader, scan ports, flash
var doFlash = function (binPath) {
    engine.stop("firmware", function () {
        setTimeout(function () {
            exec("stty -F /dev/fabmo_g2_motion 1200", function (err) {
                if (err) {
                    log.warn("Bootloader trigger failed (may already be in SAM-BA mode): " + err);
                } else {
                    log.info("Bootloader triggered via 1200-baud touch");
                }
                // Wait for USB re-enumeration into SAM-BA mode, then scan ports
                setTimeout(function () {
                    tryFlashPort(PORTS, binPath, 0, function (err) {
                        if (err) {
                            log.error("Firmware flash failed: " + err.message);
                        }
                    });
                }, 3000);
            });
        }, 2000);
    });
};

// POST /firmware/update — flash an uploaded .bin file
var flashFirmWare = function (req, res, next) {
    upload(req, res, next, function (err, upload) {
        log.info("Upload complete");
        log.info("Processing Manual Update");

        var uploads = upload.files;
        if (uploads.length > 1) {
            log.warn(
                "Got an upload of " +
                    uploads.length +
                    " files for a manual update when only one is allowed."
            );
        }
        var filePath = upload.files[0].file.path;
        var fileName = upload.files[0].file.name;
        log.info(filePath);
        log.info(fileName);
        try {
            if (!fileName.match(/.*\.bin/i)) {
                throw new Error("Unknown file type for " + fileName);
            }
            doFlash(filePath);
            res.json({
                status: "success",
                data: { status: "complete" },
            });
        } catch (err) {
            res.json({ status: "error", message: err.message || String(err) });
        }
    });
};

// POST /firmware/reload — re-flash the existing firmware from /fabmo/firmware/g2.bin
var reloadFirmWare = function (req, res, next) {
    var binPath = req.body && req.body.filepath ? req.body.filepath : DEFAULT_FIRMWARE;

    // Only allow .bin files from the firmware directory
    if (!binPath.match(/\.bin$/i) || path.dirname(path.resolve(binPath)) !== path.resolve("/fabmo/firmware")) {
        return res.json({ status: "error", message: "Firmware file must be a .bin in /fabmo/firmware/" });
    }
    if (!fs.existsSync(binPath)) {
        return res.json({ status: "error", message: "Firmware file not found: " + binPath });
    }

    log.info("Reloading firmware from " + binPath);
    try {
        doFlash(binPath);
        res.json({
            status: "success",
            data: { status: "complete", file: binPath },
        });
    } catch (err) {
        res.json({ status: "error", message: err.message || String(err) });
    }
};

module.exports = function (server) {
    server.post("/firmware/update", flashFirmWare);
    server.post("/firmware/reload", reloadFirmWare);
};
