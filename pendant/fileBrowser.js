// Pendant file-browser: shared scroll/select state for the USB-file picker.
//
// One instance per pendant subsystem (created in pendant/index.js, passed to
// each device adapter's open() call). Maintains a flat list of submittable
// files enumerated from USB-stick mount points and a currently-selected
// index. Device adapters call scroll(±N) and select() in response to wheel
// pulses and a submit button; the browser emits "pendant_file_select"
// events on the machine, which the dashboard relays to the Job Manager UI.
//
// Submission goes through db.createJob — same path as POST /usb/submit.
//
// USB enumeration is intentionally duplicated from routes/usbFileRoutes.js
// (private helpers there) rather than refactored, to keep this change
// scoped to the pendant subsystem. If a third caller appears the helpers
// should be extracted to a shared util.

var fs = require("fs-extra");
var path = require("path");
var log = require("../log").logger("pendant");
var util = require("../util");
var config = require("../config");
var db = require("../db");

// Mount roots scanned for plugged-in USB drives. Mirrors USB_MOUNT_POINTS
// in routes/usbFileRoutes.js.
var USB_MOUNT_POINTS = ["/media/pi", "/media/root", "/mnt"];

// How often to auto-refresh (covers USB hotplug without a watcher).
var REFRESH_MS = 5000;

function isValidUSBPath(p) {
    return USB_MOUNT_POINTS.some(function (m) { return p && p.indexOf(m) === 0; });
}

// Recursively-but-shallow enumerate allowed files across all mounted USB
// drives. One level deep: each drive's root + immediate subdirectories,
// matching what a user typically organizes (drive/jobs/foo.sbp).
function enumerateUsbFiles(callback) {
    var results = [];
    var pendingDrives = USB_MOUNT_POINTS.length;
    if (pendingDrives === 0) return callback(null, results);

    USB_MOUNT_POINTS.forEach(function (mount) {
        fs.access(mount, fs.constants.F_OK, function (err) {
            if (err) return drivesDone();
            fs.readdir(mount, function (err, drives) {
                if (err || !drives.length) return drivesDone();
                var pendingDirs = drives.length;
                drives.forEach(function (drive) {
                    if (drive.startsWith(".")) return dirDone();
                    var drivePath = path.join(mount, drive);
                    scanDir(drivePath, drive, 2, function () { dirDone(); });
                    function dirDone() {
                        if (--pendingDirs === 0) drivesDone();
                    }
                });
                if (drives.length === 0) drivesDone();
            });
        });
    });

    function drivesDone() {
        if (--pendingDrives === 0) {
            results.sort(function (a, b) {
                if (a.drive !== b.drive) return a.drive.localeCompare(b.drive);
                return a.name.localeCompare(b.name);
            });
            callback(null, results);
        }
    }

    function scanDir(dir, drive, depth, done) {
        fs.readdir(dir, function (err, entries) {
            if (err || !entries.length) return done();
            var pending = entries.length;
            entries.forEach(function (entry) {
                if (entry.startsWith(".")) return entryDone();
                var full = path.join(dir, entry);
                fs.stat(full, function (err, stats) {
                    if (err) return entryDone();
                    if (stats.isDirectory() && depth > 1) {
                        scanDir(full, drive, depth - 1, entryDone);
                    } else if (stats.isFile() && util.allowed_file(entry)) {
                        results.push({
                            name: entry,
                            path: full,
                            drive: drive,
                            size: stats.size,
                        });
                        entryDone();
                    } else {
                        entryDone();
                    }
                });
            });
            function entryDone() {
                if (--pending === 0) done();
            }
        });
    }
}

// Submit a USB file via the same db.createJob path as POST /usb/submit.
// Copies into the engine's tmp dir first (db.createJob takes ownership of
// the file via path).
function submitUsbFile(file, callback) {
    if (!file || !file.path || !isValidUSBPath(file.path)) {
        return callback(new Error("invalid USB file path"));
    }
    if (!util.allowed_file(file.name)) {
        return callback(new Error("file type not allowed: " + file.name));
    }
    var tempDir = config.getDataDir("tmp");
    var tempPath = path.join(tempDir, "pendant-" + Date.now() + "-" + file.name);
    fs.copy(file.path, tempPath, function (err) {
        if (err) return callback(err);
        var fileObj = { name: file.name, path: tempPath };
        var opts = {
            filename: file.name,
            name: file.name,
            description: "Loaded from pendant (USB: " + file.drive + ")",
            index: 0,
        };
        db.createJob(fileObj, opts, callback);
    });
}

function create(machine, opts) {
    opts = opts || {};
    var refreshMs = opts.refreshMs != null ? opts.refreshMs : REFRESH_MS;
    var enumerate = opts.enumerate || enumerateUsbFiles;     // injectable for tests
    var submit = opts.submit || submitUsbFile;               // injectable for tests
    var emitter = opts.emitter || machine;

    var list = [];
    var index = 0;
    var refreshing = false;
    var refreshTimer = null;

    function emit(extra) {
        var payload = {
            total: list.length,
            index: list.length ? index : -1,
            file: list.length ? list[index] : null,
        };
        if (extra) for (var k in extra) payload[k] = extra[k];
        try {
            if (emitter && emitter.emit) emitter.emit("pendant_file_select", payload);
        } catch (e) {
            log.warn("pendant_file_select emit failed: " + e.message);
        }
    }

    function refresh(cb) {
        if (refreshing) {
            if (cb) cb(null, list);
            return;
        }
        refreshing = true;
        enumerate(function (err, files) {
            refreshing = false;
            if (err) {
                log.warn("pendant fileBrowser refresh failed: " + err.message);
                if (cb) cb(err);
                return;
            }
            // Preserve selection across refreshes by file path when possible.
            var previousPath = list.length ? list[index].path : null;
            list = files;
            if (previousPath) {
                var found = -1;
                for (var i = 0; i < list.length; i++) {
                    if (list[i].path === previousPath) { found = i; break; }
                }
                index = found >= 0 ? found : 0;
            } else {
                index = 0;
            }
            emit({ reason: "refresh" });
            if (cb) cb(null, list);
        });
    }

    function scroll(delta) {
        if (!list.length) {
            // Empty list — trigger a refresh in case a stick was just plugged
            // in. Don't change index.
            refresh();
            return;
        }
        delta = delta | 0;
        if (!delta) return;
        index = ((index + delta) % list.length + list.length) % list.length;
        emit({ reason: "scroll" });
    }

    function current() {
        return list.length ? list[index] : null;
    }

    function select(cb) {
        var file = current();
        if (!file) {
            if (cb) cb(new Error("no file selected"));
            return;
        }
        log.info("pendant submitting " + file.name + " from " + file.drive);
        submit(file, function (err, job) {
            if (err) {
                log.error("pendant submit failed: " + err.message);
                emit({ reason: "submit-failed", error: err.message });
                if (cb) cb(err);
                return;
            }
            emit({ reason: "submitted", job: { _id: job && job._id, name: file.name } });
            if (cb) cb(null, job);
        });
    }

    function close() {
        if (refreshTimer) clearInterval(refreshTimer);
        refreshTimer = null;
    }

    // Kick off background refresh. Errors are logged; not fatal.
    refresh();
    refreshTimer = setInterval(function () { refresh(); }, refreshMs);

    return {
        refresh: refresh,
        scroll: scroll,
        current: current,
        select: select,
        close: close,
        getList: function () { return list.slice(); },
        getIndex: function () { return index; },
    };
}

module.exports = {
    create: create,
    USB_MOUNT_POINTS: USB_MOUNT_POINTS,
    REFRESH_MS: REFRESH_MS,
    // exposed for tests / potential extraction later
    _enumerateUsbFiles: enumerateUsbFiles,
    _submitUsbFile: submitUsbFile,
};
