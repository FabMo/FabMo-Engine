/*
 * g2_recovery.js
 *
 * USB-level recovery actions for the G2 motion controller, used by the
 * reconnect escalation ladder in g2.js when the G2 has dropped off the USB
 * bus and its device node never comes back (the "latch-up" failure mode).
 *
 * Two actions, in increasing order of severity:
 *
 *   rebindUsb()       - host-side: unbind/rebind the device (or its parent
 *                       hub when the device is gone from the bus) from the
 *                       kernel's usb driver, forcing re-enumeration.
 *   powerCycleVbus()  - cut VBUS to the port via uhubctl. The G2 board is
 *                       self-powered, but the SAM3X watches VBUS, so a
 *                       detach/reattach handshake can clear a wedged USB
 *                       session. Requires uhubctl to be installed; skipped
 *                       (with a log message) when it isn't. Note that port
 *                       power on the Pi 4's onboard VL805 hub is ganged, so
 *                       other devices on the hub (camera, pendant dongles)
 *                       will bounce too; pendant hotplug recovery handles
 *                       re-enumeration of those.
 *
 * The USB topology (which port the G2 sits on, and its parent hub) is
 * captured by cacheTopology() while the G2 is healthy — at connect time —
 * because once the card latches up it may vanish from sysfs entirely.
 */
var fs = require("fs");
var path = require("path");
var exec = require("child_process").exec;
var log = require("./log").logger("g2recovery");

// ShopBot SBv300 "FabMo-G2" USB identity, for discovery when nothing is cached
var G2_VID = "1d50";
var G2_PID = "606d";

var SYS_USB_DEVICES = "/sys/bus/usb/devices";
var USB_DRIVER = "/sys/bus/usb/drivers/usb";

// Captured while connected: { devicePort: "1-1.3", hubPort: "1-1", portNumber: "3" }
var cached = null;

// Resolve the serial device node (eg /dev/fabmo_g2_motion) back to its USB
// port id and parent hub in sysfs, and cache the result. Called on every
// successful connect, so the cache tracks the port the G2 was actually on.
function cacheTopology(serialPath, callback) {
    callback = callback || function () {};
    fs.realpath(serialPath, function (err, ttyPath) {
        if (err) {
            return callback(err);
        }
        var tty = path.basename(ttyPath); // ttyACM0
        fs.realpath("/sys/class/tty/" + tty + "/device", function (err, ifacePath) {
            if (err) {
                return callback(err);
            }
            // ifacePath ends .../1-1/1-1.3/1-1.3:1.0 — interface dir; its
            // parent is the device (1-1.3), grandparent the hub (1-1).
            var deviceDir = path.dirname(ifacePath);
            var hubDir = path.dirname(deviceDir);
            var devicePort = path.basename(deviceDir);
            var hubPort = path.basename(hubDir);
            if (!/^\d+-[\d.]+$/.test(devicePort)) {
                return callback(new Error("Unexpected sysfs layout for " + tty + ": " + ifacePath));
            }
            cached = {
                devicePort: devicePort,
                // "usb1" means the device hangs directly off the root hub
                hubPort: /^\d+-[\d.]+$/.test(hubPort) ? hubPort : null,
                portNumber: devicePort.split(".").pop(),
            };
            log.info(
                "G2 USB topology cached: device " + cached.devicePort +
                " on hub " + (cached.hubPort || "(root)")
            );
            callback(null, cached);
        });
    });
}

// Fallback discovery: scan sysfs for the G2's VID:PID. Only useful if the
// device is actually present on the bus (ie not for the latch-up case).
function findG2Device(callback) {
    fs.readdir(SYS_USB_DEVICES, function (err, entries) {
        if (err) {
            return callback(err);
        }
        var candidates = entries.filter(function (e) {
            return /^\d+-[\d.]+$/.test(e);
        });
        var remaining = candidates.length;
        if (!remaining) {
            return callback(null, null);
        }
        var found = null;
        candidates.forEach(function (entry) {
            fs.readFile(SYS_USB_DEVICES + "/" + entry + "/idVendor", "utf8", function (err, vid) {
                fs.readFile(SYS_USB_DEVICES + "/" + entry + "/idProduct", "utf8", function (err2, pid) {
                    if (!err && !err2 && vid.trim() === G2_VID && pid.trim() === G2_PID) {
                        found = entry;
                    }
                    if (--remaining === 0) {
                        callback(null, found);
                    }
                });
            });
        });
    });
}

function sysfsWrite(file, value, callback) {
    fs.writeFile(file, value, function (err) {
        callback(err);
    });
}

// Unbind/rebind a USB port id from the kernel usb driver, forcing the host
// side to re-enumerate it. If the G2's own port is gone from sysfs (device
// dropped off the bus), the parent hub is rebound instead so everything
// downstream re-enumerates.
function rebindUsb(callback) {
    callback = callback || function () {};
    pickRebindTarget(function (err, target) {
        if (err || !target) {
            log.warn("USB rebind: no target available" + (err ? " (" + err + ")" : ""));
            return callback(err || new Error("No USB rebind target"));
        }
        log.info("USB rebind: unbinding " + target);
        sysfsWrite(USB_DRIVER + "/unbind", target, function (err) {
            if (err) {
                log.warn("USB rebind: unbind of " + target + " failed: " + err);
                return callback(err);
            }
            setTimeout(function () {
                log.info("USB rebind: rebinding " + target);
                sysfsWrite(USB_DRIVER + "/bind", target, function (err) {
                    if (err) {
                        // A bind error is common and harmless when the device
                        // re-enumerated under a new address during the gap.
                        log.warn("USB rebind: bind of " + target + " reported: " + err);
                    }
                    callback(null);
                });
            }, 1000);
        });
    });
}

function pickRebindTarget(callback) {
    if (cached) {
        // Prefer the device itself if it is still present on the bus
        fs.access(SYS_USB_DEVICES + "/" + cached.devicePort, function (err) {
            if (!err) {
                return callback(null, cached.devicePort);
            }
            if (cached.hubPort) {
                return callback(null, cached.hubPort);
            }
            callback(null, null);
        });
        return;
    }
    findG2Device(function (err, port) {
        callback(err, port);
    });
}

// Power-cycle VBUS on the G2's port via uhubctl. Needs the cached topology
// (there is nothing to locate once the device is off the bus).
function powerCycleVbus(callback) {
    callback = callback || function () {};
    if (!cached || !cached.hubPort) {
        log.warn("USB power cycle: no cached hub topology — skipping");
        return callback(new Error("No cached USB topology for power cycle"));
    }
    var cmd =
        "uhubctl -l " + cached.hubPort +
        " -p " + cached.portNumber +
        " -a cycle -d 2";
    log.info("USB power cycle: " + cmd);
    exec(cmd, function (err, stdout, stderr) {
        if (err) {
            if (err.code === 127 || /not found/.test(String(stderr))) {
                log.warn("USB power cycle: uhubctl is not installed — skipping");
            } else {
                log.warn("USB power cycle failed: " + (stderr || err));
            }
            return callback(err);
        }
        log.info("USB power cycle completed");
        callback(null);
    });
}

function getTopology() {
    return cached;
}

exports.cacheTopology = cacheTopology;
exports.rebindUsb = rebindUsb;
exports.powerCycleVbus = powerCycleVbus;
exports.getTopology = getTopology;
