/*
 * updater_bundle.js
 *
 * Background self-update of the FabMo-Updater from a package bundled with
 * the engine.
 *
 * Design (agreed 2026-10, see doc/updater-bundling.md): updater updates are
 * no longer a separate, user-visible product. The engine release carries the
 * pinned updater .fmp in ./bundled_updater/, and on startup the engine
 * compares that package's version against the installed updater
 * (/fabmo-updater/version.json). If the bundle is newer, the engine streams
 * it to the updater's own manual-update endpoint on loopback :81 — the
 * updater applies it with its proven shadow-copy self-update and restarts
 * its own service. The engine, the dashboard, and any running job are
 * untouched: the whole thing is invisible to the user.
 *
 * Safety properties:
 *  - Only ever upgrades (semver compare); never downgrades or reinstalls.
 *  - Runs once per boot, several minutes after startup, and only when the
 *    machine is idle — not because the updater restart would disturb motion
 *    (it wouldn't), but to keep the tool maximally boring while cutting.
 *  - The check is cheap and runs every boot, so a failed attempt simply
 *    retries on the next one (version.json only advances on success).
 *  - No bundle directory, no package, or an unreachable updater all mean
 *    "do nothing", silently.
 */

var fs = require("fs");
var path = require("path");
var got = require("got");
var log = require("./log").logger("updater");
var updaterRoutes = require("./routes/updater");

var BUNDLE_DIR = path.join(__dirname, "bundled_updater");
var INSTALLED_VERSION_FILE = "/fabmo-updater/version.json";
var INITIAL_DELAY_MS = 3 * 60 * 1000; // settle time after boot
var IDLE_RETRY_MS = 10 * 60 * 1000; // machine busy: try again later

function parseVer(v) {
    var p = String(v || "")
        .replace(/^v/i, "")
        .split(".")
        .map(function (n) {
            return parseInt(n, 10) || 0;
        });
    while (p.length < 3) {
        p.push(0);
    }
    return p;
}

function verCmp(a, b) {
    var va = parseVer(a),
        vb = parseVer(b);
    for (var i = 0; i < 3; i++) {
        if (va[i] !== vb[i]) {
            return va[i] - vb[i];
        }
    }
    return 0;
}

// The newest FabMo-Updater package in the bundle directory, or null.
function findBundledPackage() {
    var files;
    try {
        files = fs.readdirSync(BUNDLE_DIR);
    } catch (e) {
        return null; // no bundle shipped with this engine build
    }
    var best = null;
    files.forEach(function (f) {
        if (!/\.(fmp|fmu)$/i.test(f)) {
            return;
        }
        var parsed = updaterRoutes.parsePackageName(f);
        if (parsed.product !== "fabmo-updater" || !parsed.version) {
            return;
        }
        if (!best || verCmp(parsed.version, best.version) > 0) {
            best = { path: path.join(BUNDLE_DIR, f), name: f, version: parsed.version };
        }
    });
    return best;
}

function installedUpdaterVersion() {
    try {
        var v = JSON.parse(fs.readFileSync(INSTALLED_VERSION_FILE, "utf8"));
        return v.number || null;
    } catch (e) {
        return null; // unreadable: don't guess, don't install
    }
}

// Decide whether an install should happen. Split out for tests.
// Returns {install: bool, reason: string, bundle: {..}|null}
function decide() {
    var bundle = findBundledPackage();
    if (!bundle) {
        return { install: false, reason: "no bundled updater package", bundle: null };
    }
    var installed = installedUpdaterVersion();
    if (!installed) {
        return { install: false, reason: "installed updater version unreadable", bundle: bundle };
    }
    if (verCmp(bundle.version, installed) <= 0) {
        return {
            install: false,
            reason: "installed " + installed + " >= bundled " + bundle.version,
            bundle: bundle,
        };
    }
    return { install: true, reason: "bundled " + bundle.version + " > installed " + installed, bundle: bundle };
}

function updaterAlive(callback) {
    got(updaterRoutes.updaterBase() + "/status", { responseType: "json", timeout: 5000 })
        .then(function () {
            callback(true);
        })
        .catch(function () {
            callback(false);
        });
}

function attemptInstall(bundle, callback) {
    updaterAlive(function (alive) {
        if (!alive) {
            log.warn("Bundled updater " + bundle.version + " pending, but the updater service is not reachable.");
            return callback(new Error("updater unreachable"));
        }
        log.info("Installing bundled updater " + bundle.version + " in the background (" + bundle.name + ")");
        updaterRoutes.relayPackage(bundle.path, bundle.name, function (err, body) {
            if (err) {
                log.warn("Bundled updater install failed (will retry next boot): " + err.message);
                return callback(err);
            }
            if (body && body.status && body.status !== "success") {
                log.warn("Updater rejected the bundled package: " + (body.message || body.status));
                return callback(new Error(body.message || "updater rejected package"));
            }
            // The updater now shadow-copies itself and restarts its own
            // service; version.json advances when that succeeds.
            log.info("Bundled updater " + bundle.version + " handed to the updater for self-install.");
            callback(null);
        });
    });
}

// Kick off the once-per-boot background check. machine is the engine's
// machine object (used only to read the idle state); never throws.
function start(machine) {
    var attempted = false;
    function tick() {
        if (attempted) {
            return;
        }
        var decision = decide();
        if (!decision.install) {
            log.debug("Bundled updater check: " + decision.reason);
            attempted = true; // nothing to do this boot
            return;
        }
        var state = machine && machine.status && machine.status.state;
        if (state && state !== "idle") {
            log.debug("Bundled updater " + decision.bundle.version + " pending; machine is " + state + " - deferring.");
            setTimeout(tick, IDLE_RETRY_MS);
            return;
        }
        attempted = true;
        attemptInstall(decision.bundle, function () {
            // Errors already logged; next boot retries naturally.
        });
    }
    setTimeout(tick, INITIAL_DELAY_MS);
}

module.exports.start = start;
// Exposed for tests
module.exports._decide = decide;
module.exports._verCmp = verCmp;
module.exports._findBundledPackage = findBundledPackage;
module.exports._BUNDLE_DIR = BUNDLE_DIR;
