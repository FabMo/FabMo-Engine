/*
 * diagnostics.js
 *
 * System-level diagnostic capture for G2 disconnect investigation.
 *
 * The engine's own log tells us what the software saw; the questions that
 * actually diagnose a USB latch-up live below it: did the kernel log a USB
 * disconnect/re-enumeration or dwc/xhci error? Was the Pi flagging
 * undervoltage or throttling (the prime suspect for G2 brownouts)? Did the
 * device node come back? This module shells out for that context and writes
 * it alongside the fabmo-g2-disconnect-* log dumps so one bundle tells the
 * whole story.
 *
 * All commands are best-effort with short timeouts: a diagnostic capture
 * must never hang or crash the thing it is diagnosing.
 */

var exec = require("child_process").exec;
var fs = require("fs");
var path = require("path");
var async = require("async");
var log = require("./log").logger("diagnostics");

var CMD_TIMEOUT_MS = 10000;

// The commands captured in a snapshot, in display order.
var SNAPSHOT_COMMANDS = [
    { title: "Date / uptime", cmd: "date -u '+%Y-%m-%d %H:%M:%S UTC'; uptime" },
    { title: "Throttle flags (vcgencmd get_throttled)", cmd: "vcgencmd get_throttled" },
    { title: "Core temperature", cmd: "vcgencmd measure_temp" },
    { title: "Core voltage", cmd: "vcgencmd measure_volts core" },
    { title: "USB devices (lsusb)", cmd: "lsusb" },
    { title: "G2 device nodes", cmd: "ls -la /dev/fabmo* /dev/ttyACM* 2>&1" },
    { title: "Kernel log tail (dmesg)", cmd: "dmesg --ctime 2>/dev/null | tail -n 200 || dmesg | tail -n 200" },
];

// Decode the vcgencmd get_throttled bitmask into English. The sticky bits
// (16-19) are the gold for after-the-fact diagnosis: they latch since boot.
var THROTTLE_BITS = {
    0: "under-voltage detected NOW",
    1: "arm frequency capped NOW",
    2: "currently throttled NOW",
    3: "soft temperature limit active NOW",
    16: "under-voltage has occurred since boot",
    17: "arm frequency capping has occurred since boot",
    18: "throttling has occurred since boot",
    19: "soft temperature limit has occurred since boot",
};

function decodeThrottled(output) {
    var m = /throttled=0x([0-9a-fA-F]+)/.exec(output || "");
    if (!m) {
        return null;
    }
    var value = parseInt(m[1], 16);
    if (value === 0) {
        return "0x0 — no undervoltage or throttling since boot";
    }
    var meanings = [];
    Object.keys(THROTTLE_BITS).forEach(function (bit) {
        // eslint-disable-next-line no-bitwise
        if (value & (1 << bit)) {
            meanings.push(THROTTLE_BITS[bit]);
        }
    });
    return "0x" + m[1] + " — " + meanings.join("; ");
}

// Capture a system snapshot as a single text blob. Never fails: commands
// that error are recorded with their error text.
function captureSystemSnapshot(callback) {
    var engineVersion = "unknown";
    try {
        engineVersion = JSON.parse(fs.readFileSync(path.join(__dirname, "version.json"), "utf8")).number;
    } catch (e) {
        engineVersion = "dev/unknown";
    }
    var lines = [
        "FabMo G2 diagnostic system snapshot",
        "Engine version: " + engineVersion,
        "Captured (engine clock): " + new Date().toISOString(),
        "",
    ];
    async.eachSeries(
        SNAPSHOT_COMMANDS,
        function (entry, cb) {
            exec(entry.cmd, { timeout: CMD_TIMEOUT_MS, maxBuffer: 1024 * 1024 }, function (err, stdout, stderr) {
                lines.push("===== " + entry.title + " =====");
                if (stdout && stdout.trim()) {
                    lines.push(stdout.trim());
                }
                if (stderr && stderr.trim()) {
                    lines.push("[stderr] " + stderr.trim());
                }
                if (err && !(stdout && stdout.trim())) {
                    lines.push("[error] " + err.message);
                }
                if (entry.cmd.indexOf("get_throttled") !== -1) {
                    var decoded = decodeThrottled(stdout);
                    if (decoded) {
                        lines.push("Decoded: " + decoded);
                    }
                }
                lines.push("");
                cb();
            });
        },
        function () {
            callback(null, lines.join("\n"));
        }
    );
}

// Write a full disconnect diagnostic: the system snapshot text plus the
// flight recording (recent G2 traffic), both named fabmo-<source>-<ts>-*
// so rotation and the /log/bundle download pick them up. Best-effort.
// Kernel messages for a USB disconnect can trail the serial-close event by
// a moment — settle briefly so the dmesg tail includes them.
var CAPTURE_SETTLE_MS = 2000;

function saveDisconnectDiagnostics(source, callback) {
    callback = callback || function () {};
    var logModule = require("./log");
    var ts = Date.now();
    setTimeout(function () {
    captureSystemSnapshot(function (err, text) {
        var dir;
        try {
            dir = require("./config").getDataDir("log");
        } catch (e) {
            return callback(e);
        }
        var sysFile = path.join(dir, "fabmo-" + source + "-" + ts + "-system.txt");
        fs.writeFile(sysFile, text, function (writeErr) {
            if (writeErr) {
                log.error("Could not write system snapshot: " + writeErr.message);
            } else {
                log.info("System snapshot saved to " + sysFile);
            }
            logModule.saveCurrentFlightLog(source, function () {
                callback(null);
            });
        });
    });
    }, CAPTURE_SETTLE_MS);
}

module.exports.captureSystemSnapshot = captureSystemSnapshot;
module.exports.saveDisconnectDiagnostics = saveDisconnectDiagnostics;
module.exports._decodeThrottled = decodeThrottled;
