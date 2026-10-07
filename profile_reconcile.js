/*
 * profile_reconcile.js
 *
 * Additive-only reconciliation of the on-tool configuration with the
 * configuration shipped by a just-updated engine's profiles.
 *
 * Policy (2026-10, see doc/update-settings-merge.md): a software update may
 * ADD configuration keys that arrive with updated profiles, but must never
 * change or remove anything the machine already has. Existing values are
 * machine state — envelope dimensions, G2 unit values, calibration,
 * user preference — and are left strictly alone.
 *
 * Mechanics:
 *  - Runs once on the first start after an update (engine.js gates on
 *    version_changed), BEFORE the machine/driver configs are loaded, so the
 *    loaders read the reconciled files.
 *  - Sources: the SHIPPED profile tree (./profiles/default/config with the
 *    current profile's config overlaid on top, profile winning). The
 *    /opt/fabmo/profiles copies are NOT used — they are refreshed
 *    copy-if-missing and go stale across updates.
 *  - Targets: /opt/fabmo/config/machine.json, g2.json, and opensbp.json.
 *      - opensbp.json participates additively like the others: a NEW key
 *        shipped by the profile (including a new default persistent
 *        variable) is added, but existing variables and settings are real
 *        calibration data and are never overwritten.
 *      - instance.json is machine identity and excluded.
 *      - engine.json is excluded because it is already loaded (and later
 *        re-saved from cache) by the time this runs — file-level additions
 *        would be clobbered. Profile-shipped engine keys are rare; revisit
 *        if one ever matters.
 *  - Operation: deep additive merge. A key missing from the user file is
 *    added with the profile's value; a key that exists is left untouched
 *    (plain objects recurse; arrays and scalars are atomic). Nothing is
 *    ever deleted.
 *  - A target file that is missing or unparseable is skipped: the config
 *    recovery chain owns those cases and this module never fights it.
 */

var fs = require("fs");
var path = require("path");
var log = require("./log").logger("profiles");

var SHIPPED_PROFILES_DIR = path.join(__dirname, "profiles");
var RECONCILE_FILES = ["machine.json", "g2.json", "opensbp.json"];

// Plain-object check: arrays and null are atomic values, not containers.
function isPlainObject(v) {
    return v !== null && typeof v === "object" && !Array.isArray(v);
}

// Full merge for building the shipped baseline: overlay wins everywhere,
// recursing through plain objects.
function overlayMerge(base, overlay) {
    var out = {};
    Object.keys(base).forEach(function (k) {
        out[k] = base[k];
    });
    Object.keys(overlay).forEach(function (k) {
        if (isPlainObject(out[k]) && isPlainObject(overlay[k])) {
            out[k] = overlayMerge(out[k], overlay[k]);
        } else {
            out[k] = overlay[k];
        }
    });
    return out;
}

// Additive merge: copy keys from source that target lacks; recurse into
// plain objects on both sides; never overwrite, never delete. Returns the
// dotted paths of every key added.
function additiveMerge(target, source, prefix) {
    var added = [];
    Object.keys(source).forEach(function (k) {
        var p = prefix ? prefix + "." + k : k;
        if (!(k in target)) {
            target[k] = source[k];
            added.push(p);
        } else if (isPlainObject(target[k]) && isPlainObject(source[k])) {
            added = added.concat(additiveMerge(target[k], source[k], p));
        }
        // Key exists and is not a matching container: leave it alone.
    });
    return added;
}

function readJSON(file) {
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (e) {
        return null;
    }
}

// Durable in-place replace: write a temp file, fsync it, rename over the
// original. Synchronous — this runs once, during startup, before config load.
function writeFileDurable(file, data) {
    var tmp = file + ".reconcile.tmp";
    var fd = fs.openSync(tmp, "w");
    try {
        fs.writeSync(fd, data);
        fs.fsyncSync(fd);
    } finally {
        fs.closeSync(fd);
    }
    fs.renameSync(tmp, file);
}

// Run the reconcile for the named profile (display name or directory name).
// callback(err, summary) — summary maps filename → [added key paths].
// Never fails the boot: per-file problems are logged and skipped.
// opts.configDir overrides the target directory (tests only).
var run = function (profileName, opts, callback) {
    if (typeof opts === "function") {
        callback = opts;
        opts = {};
    }
    var configDir = (opts && opts.configDir) || "/opt/fabmo/config";
    var summary = {};
    try {
        var Config = require("./config/config").Config;
        var profileDir = Config.resolveProfileDirectory(profileName || "default");

        RECONCILE_FILES.forEach(function (name) {
            var defaultFile = path.join(SHIPPED_PROFILES_DIR, "default", "config", name);
            var overlayFile = path.join(SHIPPED_PROFILES_DIR, profileDir, "config", name);
            var userFile = path.join(configDir, name);

            var shipped = readJSON(defaultFile);
            if (!shipped) {
                log.warn("Reconcile: no shipped default for " + name + " - skipping");
                return;
            }
            var overlay = profileDir !== "default" ? readJSON(overlayFile) : null;
            if (overlay) {
                shipped = overlayMerge(shipped, overlay);
            }

            if (!fs.existsSync(userFile)) {
                // Missing file: the config recovery chain rebuilds it with
                // full profile content on load. Not our job.
                log.debug("Reconcile: " + name + " not present - leaving to recovery chain");
                return;
            }
            var user = readJSON(userFile);
            if (!user) {
                log.warn("Reconcile: " + name + " unparseable - leaving to recovery chain");
                return;
            }

            var added = additiveMerge(user, shipped, "");
            if (added.length) {
                writeFileDurable(userFile, JSON.stringify(user, null, 4));
                summary[name] = added;
                log.info(
                    "Reconcile: added " + added.length + " new key(s) to " + name + ": " + added.join(", ")
                );
            } else {
                log.debug("Reconcile: " + name + " has no new keys");
            }
        });
    } catch (err) {
        return callback(err, summary);
    }
    callback(null, summary);
};

module.exports.run = run;
// Exposed for tests
module.exports._additiveMerge = additiveMerge;
module.exports._overlayMerge = overlayMerge;
