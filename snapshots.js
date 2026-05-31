/*
 * snapshots.js
 *
 * User-controlled named restore points for machine configuration. A snapshot
 * captures /opt/fabmo/config/ (minus runtime state and secrets) and
 * /opt/fabmo/macros/ as a frozen point-in-time copy. Snapshots are separate
 * from the chokidar-driven backup system - backups handle "my live config
 * just got corrupted, restore the most recent good copy"; snapshots handle
 * "bring me back to a tuned baseline I explicitly trust."
 *
 * Auto-snapshots are created before potentially destructive transitions
 * (profile change, snapshot restore). They use a reserved kind prefix and
 * are rotated to keep disk usage bounded.
 *
 * Restore is additive (overwrites existing files but does not delete files
 * absent from the snapshot). This protects forward-compatibility when newer
 * fabmo versions introduce config files the snapshot predates.
 */

var fs = require("fs-extra");
var path = require("path");
var async = require("async");
var log = require("./log").logger("snapshots");
var machine = require("./machine");

var SNAPSHOT_DIR = "/opt/fabmo_snapshots";
var DEFAULT_POINTER = "/opt/fabmo_snapshots/.default";
var LIVE_CONFIG_DIR = "/opt/fabmo/config";
var LIVE_MACROS_DIR = "/opt/fabmo/macros";
var MAX_AUTO_PER_KIND = 5;

// Snapshots marked as the user-default are mirrored here so they survive
// /opt being wiped (the whole reason /fabmo-def exists outside /opt).
var FABMO_DEF_SNAPSHOTS_DIR = "/fabmo-def/snapshots";

// Files in /opt/fabmo/config/ that should never be captured in a snapshot.
// instance.json is runtime state (position/offsets) that belongs to the
// current session. auth_secret is a security token - restoring it could
// invalidate active sessions in surprising ways.
var EXCLUDED_FILES = ["instance.json", "auth_secret"];

// Name rules for user-created snapshots: alphanumeric plus _- only,
// 1-25 chars. Reserved prefixes are owned by the auto-snapshot system.
var USER_NAME_RE = /^[a-zA-Z0-9_-]{1,25}$/;
var RESERVED_PREFIXES = ["auto_pre_restore", "auto_pre_profile"];

function isReservedName(name) {
    for (var i = 0; i < RESERVED_PREFIXES.length; i++) {
        var p = RESERVED_PREFIXES[i];
        if (name === p || name.indexOf(p + "_") === 0) {
            return true;
        }
    }
    return false;
}

function isValidUserName(name) {
    return typeof name === "string" && USER_NAME_RE.test(name) && !isReservedName(name);
}

function isIdle() {
    try {
        return machine && machine.machine && machine.machine.status && machine.machine.status.state === "idle";
    } catch (e) {
        return false;
    }
}

function snapshotPath(name) {
    return path.join(SNAPSHOT_DIR, name);
}

function shouldIncludeForSnapshot(srcPath) {
    var base = path.basename(srcPath);
    if (EXCLUDED_FILES.indexOf(base) !== -1) {
        return false;
    }
    // Skip dotfiles like .auto_profile_applied - those are state markers.
    if (base.charAt(0) === ".") {
        return false;
    }
    return true;
}

// Internal create — used by both user-initiated and auto paths. Does not
// enforce idle (callers decide). Writes config/, macros/, and snapshot_info.json.
function _create(name, opts, callback) {
    opts = opts || {};
    var dest = snapshotPath(name);
    var configDest = path.join(dest, "config");
    var macrosDest = path.join(dest, "macros");

    fs.ensureDir(dest, function (err) {
        if (err) {
            return callback(err);
        }
        async.series(
            [
                function (cb) {
                    fs.ensureDir(configDest, cb);
                },
                function (cb) {
                    if (!fs.existsSync(LIVE_CONFIG_DIR)) {
                        return cb();
                    }
                    fs.copy(LIVE_CONFIG_DIR, configDest, { filter: shouldIncludeForSnapshot }, cb);
                },
                function (cb) {
                    if (!fs.existsSync(LIVE_MACROS_DIR)) {
                        return cb();
                    }
                    fs.ensureDir(macrosDest, function (eErr) {
                        if (eErr) {
                            return cb(eErr);
                        }
                        fs.copy(LIVE_MACROS_DIR, macrosDest, cb);
                    });
                },
                function (cb) {
                    var info = {
                        name: name,
                        kind: opts.kind || "user",
                        description: opts.description || "",
                        created_at: new Date().toISOString(),
                    };
                    fs.writeFile(path.join(dest, "snapshot_info.json"), JSON.stringify(info, null, 2), cb);
                },
            ],
            function (err) {
                if (err) {
                    log.warn("snapshot create failed for " + name + ": " + err.message);
                    fs.remove(dest, function () {});
                    return callback(err);
                }
                log.info("snapshot created: " + name + " (" + (opts.kind || "user") + ")");
                callback(null);
            }
        );
    });
}

// Public: create a user-initiated snapshot. Enforces idle + name rules +
// non-collision.
function create(name, description, callback) {
    if (typeof callback !== "function") {
        callback = function () {};
    }
    if (!isValidUserName(name)) {
        return callback(new Error("Invalid snapshot name (1-25 chars, letters/digits/_-, no reserved prefix)"));
    }
    if (!isIdle()) {
        return callback(new Error("Machine must be idle to create a snapshot"));
    }
    if (fs.existsSync(snapshotPath(name))) {
        return callback(new Error("A snapshot named '" + name + "' already exists"));
    }
    _create(name, { kind: "user", description: description || "" }, callback);
}

// Public: register an extracted snapshot directory (typically the contents
// of an uploaded `.fmsnap.zip`) under SNAPSHOT_DIR as a user snapshot.
//
// The source directory must look like a snapshot root: a snapshot_info.json
// at the top with at least the `name` field. Name is sanitized against
// USER_NAME_RE, reserved-prefix collisions are avoided, and if a snapshot
// with the same name already exists a `_N` suffix is appended so the
// existing one isn't clobbered. Kind is forced to "user" on import — auto
// kind is reserved for the engine's own rotation.
function importFromDir(srcDir, callback) {
    if (typeof callback !== "function") {
        callback = function () {};
    }
    if (!isIdle()) {
        return callback(new Error("Machine must be idle to import a snapshot"));
    }
    var infoPath = path.join(srcDir, "snapshot_info.json");
    if (!fs.existsSync(infoPath)) {
        return callback(new Error("Not a valid snapshot zip: snapshot_info.json missing"));
    }
    var info;
    try {
        info = JSON.parse(fs.readFileSync(infoPath, "utf8"));
    } catch (e) {
        return callback(new Error("Snapshot info is corrupt: " + e.message));
    }

    var rawName = (info.name || "imported").toString();
    var sanitized = rawName.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 25) || "imported";
    if (isReservedName(sanitized)) {
        sanitized = ("imported_" + sanitized).slice(0, 25);
    }

    // Resolve collisions by appending _N. Keep the existing snapshot
    // untouched so the user can compare if they imported deliberately.
    var finalName = sanitized;
    if (fs.existsSync(snapshotPath(finalName))) {
        var base = sanitized;
        for (var n = 1; n <= 99; n++) {
            var attempt = base.slice(0, 25 - (("_" + n).length)) + "_" + n;
            if (!fs.existsSync(snapshotPath(attempt))) {
                finalName = attempt;
                break;
            }
            if (n === 99) {
                return callback(new Error("Too many existing snapshots named '" + base + "*'"));
            }
        }
    }

    var dest = snapshotPath(finalName);
    fs.copy(srcDir, dest, function (cpErr) {
        if (cpErr) {
            return callback(cpErr);
        }
        info.name = finalName;
        info.kind = "user";
        info.imported_at = new Date().toISOString();
        fs.writeFile(path.join(dest, "snapshot_info.json"), JSON.stringify(info, null, 2), function (wErr) {
            if (wErr) {
                fs.remove(dest, function () {});
                return callback(wErr);
            }
            log.info("imported snapshot as " + finalName);
            callback(null, finalName);
        });
    });
}

// Public: create an automatic snapshot of the given kind, prune older ones
// of the same kind. Bypasses idle and name-collision checks since callers
// are the engine itself, not user actions.
function createAuto(kind, callback) {
    if (typeof callback !== "function") {
        callback = function () {};
    }
    if (RESERVED_PREFIXES.indexOf(kind) === -1) {
        return callback(new Error("Unknown auto-snapshot kind: " + kind));
    }
    // Only create if there's something to capture - avoids empty snapshots
    // during fresh installs.
    if (!fs.existsSync(LIVE_CONFIG_DIR)) {
        log.debug("auto-snapshot skipped: no live config dir yet (" + kind + ")");
        return callback(null, null);
    }
    var stamp = new Date().toISOString().replace(/[:.]/g, "-");
    var name = kind + "_" + stamp;
    _create(name, { kind: kind, description: "Automatic " + kind + " snapshot" }, function (err) {
        if (err) {
            return callback(err);
        }
        pruneAuto(kind, function () {
            callback(null, name);
        });
    });
}

function pruneAuto(kind, callback) {
    fs.readdir(SNAPSHOT_DIR, function (err, entries) {
        if (err) {
            return callback();
        }
        var prefix = kind + "_";
        var matching = entries.filter(function (e) {
            return e.indexOf(prefix) === 0;
        });
        if (matching.length <= MAX_AUTO_PER_KIND) {
            return callback();
        }
        // Names contain ISO timestamps, so lexicographic sort = chronological.
        matching.sort();
        var excess = matching.slice(0, matching.length - MAX_AUTO_PER_KIND);
        async.each(
            excess,
            function (name, cb) {
                fs.remove(snapshotPath(name), function (rmErr) {
                    if (rmErr) {
                        log.warn("could not prune auto snapshot " + name + ": " + rmErr.message);
                    }
                    cb();
                });
            },
            function () {
                callback();
            }
        );
    });
}

// List all snapshots (user and auto). Sorted newest-first by created_at.
// Each snapshot's is_user_default is set if it currently holds the
// "user default" title.
function list(callback) {
    fs.ensureDir(SNAPSHOT_DIR, function (err) {
        if (err) {
            return callback(err);
        }
        var defaultName = getDefault();
        fs.readdir(SNAPSHOT_DIR, function (rErr, entries) {
            if (rErr) {
                return callback(rErr);
            }
            var snapshots = [];
            async.each(
                entries,
                function (name, cb) {
                    var infoFile = path.join(SNAPSHOT_DIR, name, "snapshot_info.json");
                    fs.readFile(infoFile, "utf8", function (readErr, data) {
                        if (readErr) {
                            return cb();
                        }
                        try {
                            var info = JSON.parse(data);
                            info.name = name;
                            info.is_user_default = name === defaultName;
                            snapshots.push(info);
                        } catch (e) {
                            log.warn("snapshot " + name + " has invalid info: " + e.message);
                        }
                        cb();
                    });
                },
                function () {
                    snapshots.sort(function (a, b) {
                        return (b.created_at || "").localeCompare(a.created_at || "");
                    });
                    callback(null, snapshots);
                }
            );
        });
    });
}

// Read the name of the user-default snapshot, or null if none is set.
// Sync because it's called from the config-load fallback path during
// engine boot, where async would complicate the chain.
function getDefault() {
    try {
        if (!fs.existsSync(DEFAULT_POINTER)) {
            return null;
        }
        var name = fs.readFileSync(DEFAULT_POINTER, "utf8").trim();
        if (!name) {
            return null;
        }
        // Verify the pointed-at snapshot still exists. A stale pointer
        // (snapshot was deleted out from under us) should behave the
        // same as no default at all.
        if (!fs.existsSync(snapshotPath(name))) {
            log.warn("user-default snapshot pointer is stale: " + name);
            return null;
        }
        return name;
    } catch (e) {
        log.warn("could not read default snapshot pointer: " + e.message);
        return null;
    }
}

// Mark a snapshot as the user-default fallback. Mirrors the snapshot to
// /fabmo-def/snapshots/<name>/ and records the name in fabmo-def.json so
// the choice survives /opt being wiped. Lazy-requires profile_definition
// to avoid a circular dep.
//
// Only user-named snapshots are eligible: auto-rotated snapshots
// disappear under their rotation policy, which would silently break the
// fallback link.
function setDefault(name, callback) {
    if (typeof callback !== "function") {
        callback = function () {};
    }
    if (!isValidUserName(name)) {
        return callback(new Error("Only user-named snapshots can be set as default"));
    }
    var src = snapshotPath(name);
    if (!fs.existsSync(src)) {
        return callback(new Error("Snapshot not found: " + name));
    }
    var profileDef;
    try {
        profileDef = require("./config/profile_definition");
    } catch (e) {
        return callback(new Error("profile_definition unavailable: " + e.message));
    }

    var previousDefault = getDefault();
    var newMirror = path.join(FABMO_DEF_SNAPSHOTS_DIR, name);

    async.series(
        [
            // Ensure the cross-/opt mirror directory exists.
            function (cb) {
                fs.ensureDir(FABMO_DEF_SNAPSHOTS_DIR, cb);
            },
            // If a different snapshot was previously the default, clear
            // its mirror so /fabmo-def only ever holds the active one.
            function (cb) {
                if (!previousDefault || previousDefault === name) {
                    return cb();
                }
                var oldMirror = path.join(FABMO_DEF_SNAPSHOTS_DIR, previousDefault);
                fs.remove(oldMirror, function () { cb(); });
            },
            // Mirror the snapshot to /fabmo-def. This is the
            // protection-against-/opt-loss step; if it fails, the whole
            // setDefault fails so the user knows their fallback isn't
            // protected.
            function (cb) {
                fs.copy(src, newMirror, { overwrite: true }, function (err) {
                    if (err) {
                        return cb(new Error("Could not mirror snapshot to /fabmo-def: " + err.message));
                    }
                    cb();
                });
            },
            // Record the snapshot name in fabmo-def.json.
            function (cb) {
                profileDef.setSnapshotName(name, function (err) {
                    if (err) {
                        log.warn("Snapshot mirrored but fabmo-def.json update failed: " + err.message);
                    }
                    cb();
                });
            },
            // Ensure fabmo-def.json also has profile_name set, so the
            // /opt-loss recovery flow (which runs through the auto-profile
            // pipeline) can resolve a target profile. If profile_name was
            // never set (user blessed a snapshot without ever changing
            // profile), populate it from the current engine config. This
            // converts to the directory name form since check_auto_profile
            // resolves targets that way.
            function (cb) {
                try {
                    var existing = profileDef.read(true);
                    var hasProfileName = !!(
                        existing &&
                        existing.auto_profile &&
                        existing.auto_profile.profile_name
                    );
                    if (hasProfileName) {
                        return cb();
                    }
                    var configModule = require("./config");
                    var currentProfile =
                        configModule &&
                        configModule.engine &&
                        configModule.engine.get &&
                        configModule.engine.get("profile");
                    if (!currentProfile) {
                        return cb();
                    }
                    var ConfigClass = require("./config/config").Config;
                    var dirName = ConfigClass.resolveProfileDirectory(currentProfile);
                    profileDef.setProfileName(dirName, function (e) {
                        if (e) {
                            log.warn("Auto-populate of profile_name failed: " + e.message);
                        }
                        cb();
                    });
                } catch (e) {
                    log.warn("Could not auto-populate profile_name: " + e.message);
                    cb();
                }
            },
            // Write the in-/opt pointer used by the recovery chain.
            function (cb) {
                fs.ensureDir(SNAPSHOT_DIR, function (e) {
                    if (e) {
                        return cb(e);
                    }
                    fs.writeFile(DEFAULT_POINTER, name, cb);
                });
            },
        ],
        function (err) {
            if (err) {
                log.warn("setDefault failed for " + name + ": " + err.message);
                return callback(err);
            }
            log.info("user-default snapshot set to: " + name);
            callback(null);
        }
    );
}

function clearDefault(callback) {
    if (typeof callback !== "function") {
        callback = function () {};
    }
    var currentName = getDefault();
    var profileDef;
    try {
        profileDef = require("./config/profile_definition");
    } catch (e) {
        profileDef = null;
    }

    async.series(
        [
            // Remove the /fabmo-def mirror for the previously-blessed
            // snapshot, if any.
            function (cb) {
                if (!currentName) {
                    return cb();
                }
                var mirror = path.join(FABMO_DEF_SNAPSHOTS_DIR, currentName);
                fs.remove(mirror, function () { cb(); });
            },
            // Clear the snapshot field in fabmo-def.json (profile_name
            // remains as the deeper fallback).
            function (cb) {
                if (!profileDef) {
                    return cb();
                }
                profileDef.clearSnapshotName(function () { cb(); });
            },
            // Remove the in-/opt pointer.
            function (cb) {
                if (!fs.existsSync(DEFAULT_POINTER)) {
                    return cb();
                }
                fs.remove(DEFAULT_POINTER, function () { cb(); });
            },
        ],
        function (err) {
            if (!err) {
                log.info("user-default snapshot cleared");
            }
            callback(err);
        }
    );
}

// Restore a snapshot over the live config + macros. Auto-snapshots the
// current state first so an accidental restore is itself reversible.
// Caller is responsible for triggering an engine restart after the callback.
function restore(name, callback) {
    if (typeof callback !== "function") {
        callback = function () {};
    }
    if (typeof name !== "string" || name.length === 0) {
        return callback(new Error("Snapshot name required"));
    }
    var dest = snapshotPath(name);
    if (!fs.existsSync(dest)) {
        return callback(new Error("Snapshot not found: " + name));
    }
    if (!isIdle()) {
        return callback(new Error("Machine must be idle to restore a snapshot"));
    }
    createAuto("auto_pre_restore", function (autoErr, autoName) {
        if (autoErr) {
            log.warn("pre-restore snapshot failed (continuing): " + autoErr.message);
        }
        var snapConfigDir = path.join(dest, "config");
        var snapMacrosDir = path.join(dest, "macros");
        async.series(
            [
                function (cb) {
                    if (!fs.existsSync(snapConfigDir)) {
                        return cb();
                    }
                    fs.copy(snapConfigDir, LIVE_CONFIG_DIR, { overwrite: true }, cb);
                },
                function (cb) {
                    if (!fs.existsSync(snapMacrosDir)) {
                        return cb();
                    }
                    fs.copy(snapMacrosDir, LIVE_MACROS_DIR, { overwrite: true }, cb);
                },
            ],
            function (err) {
                if (err) {
                    log.error("snapshot restore failed for " + name + ": " + err.message);
                    return callback(err);
                }
                log.info("snapshot restored: " + name);
                callback(null, { pre_restore_snapshot: autoName });
            }
        );
    });
}

// Delete a user snapshot. Auto-snapshots are managed by their own pruning;
// this endpoint refuses to delete them so we never accidentally throw away
// safety nets.
function remove(name, callback) {
    if (typeof callback !== "function") {
        callback = function () {};
    }
    if (!isValidUserName(name)) {
        return callback(new Error("Only user snapshots can be deleted (auto snapshots rotate themselves)"));
    }
    var dest = snapshotPath(name);
    if (!fs.existsSync(dest)) {
        return callback(new Error("Snapshot not found: " + name));
    }
    var wasDefault = getDefault() === name;
    fs.remove(dest, function (err) {
        if (err) {
            return callback(err);
        }
        log.info("snapshot removed: " + name);
        if (wasDefault) {
            clearDefault(function () {
                callback(null);
            });
        } else {
            callback(null);
        }
    });
}

// Recover a snapshot from its /fabmo-def mirror into /opt. Used during
// /opt-loss recovery: the engine boot sequence calls this after the
// auto-profile has been applied and detects that the user previously
// blessed a snapshot whose operational copy is no longer present.
//
// Steps:
//   1. Overlay the mirror's config files onto /opt/fabmo/config
//      (overwrite). Files in /opt absent from the mirror remain.
//   2. Overlay the mirror's macros onto /opt/fabmo/macros.
//   3. Re-populate /opt/fabmo_snapshots/<name>/ so the user has the
//      same operational view as before /opt was wiped.
//   4. Re-establish the in-/opt .default pointer.
function recoverFromMirror(name, callback) {
    if (typeof callback !== "function") {
        callback = function () {};
    }
    if (typeof name !== "string" || !name) {
        return callback(new Error("Snapshot name required"));
    }
    var mirror = path.join(FABMO_DEF_SNAPSHOTS_DIR, name);
    if (!fs.existsSync(mirror)) {
        return callback(new Error("Mirror not found: " + mirror));
    }
    var mirrorConfig = path.join(mirror, "config");
    var mirrorMacros = path.join(mirror, "macros");
    var opSnapshot = snapshotPath(name);

    var BACKUP_CONFIG_DIR = "/opt/fabmo_backup/config";
    async.series(
        [
            function (cb) {
                if (!fs.existsSync(mirrorConfig)) {
                    return cb();
                }
                fs.ensureDir(LIVE_CONFIG_DIR, function (e) {
                    if (e) {
                        return cb(e);
                    }
                    fs.copy(mirrorConfig, LIVE_CONFIG_DIR, { overwrite: true }, cb);
                });
            },
            function (cb) {
                if (!fs.existsSync(mirrorMacros)) {
                    return cb();
                }
                fs.ensureDir(LIVE_MACROS_DIR, function (e) {
                    if (e) {
                        return cb(e);
                    }
                    fs.copy(mirrorMacros, LIVE_MACROS_DIR, { overwrite: true }, cb);
                });
            },
            function (cb) {
                fs.ensureDir(SNAPSHOT_DIR, function (e) {
                    if (e) {
                        return cb(e);
                    }
                    fs.copy(mirror, opSnapshot, { overwrite: true }, cb);
                });
            },
            // Keep the auto-backup mirror aligned with the snapshot we
            // just restored. Otherwise the mirror retains whatever
            // content was written there during the pre-recovery boot
            // (typically profile defaults), and a config corruption
            // between now and the next save would have the corruption
            // recovery chain return that stale content instead of
            // falling through to the snapshot tier.
            function (cb) {
                if (!fs.existsSync(mirrorConfig)) {
                    return cb();
                }
                fs.ensureDir(BACKUP_CONFIG_DIR, function (e) {
                    if (e) {
                        return cb(e);
                    }
                    fs.copy(mirrorConfig, BACKUP_CONFIG_DIR, { overwrite: true }, cb);
                });
            },
            function (cb) {
                fs.writeFile(DEFAULT_POINTER, name, cb);
            },
        ],
        function (err) {
            if (err) {
                log.warn("recoverFromMirror failed for " + name + ": " + err.message);
                return callback(err);
            }
            log.info("recovered user-default snapshot from mirror: " + name);
            callback(null);
        }
    );
}

module.exports = {
    create: create,
    createAuto: createAuto,
    importFromDir: importFromDir,
    list: list,
    restore: restore,
    remove: remove,
    getDefault: getDefault,
    setDefault: setDefault,
    clearDefault: clearDefault,
    snapshotPath: snapshotPath,
    recoverFromMirror: recoverFromMirror,
};
