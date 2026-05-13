/*
 * recovery_log.js
 *
 * Tracks config-corruption recovery events. When Config.prototype.load() falls
 * back through its tier chain (backup -> working profile -> original profile),
 * it records *which* tier won, the original parse error, and saves a copy of
 * the corrupt source file for post-mortem analysis. Events are persisted as
 * JSON-lines in /opt/fabmo_backup/recovery.log so they survive restarts and
 * can be reviewed long after the fact.
 *
 * All write errors are logged and swallowed - failures here must never
 * affect the primary config load path.
 */

var fs = require("fs-extra");
var path = require("path");
var log = require("../log").logger("recovery");

var LOG_FILE = "/opt/fabmo_backup/recovery.log";
var CORRUPT_DIR = "/opt/fabmo_backup/corrupt";
var MAX_IN_MEMORY = 50;

var events = [];
var nextId = 1;
var loaded = false;

function loadFromDisk() {
    if (loaded) {
        return;
    }
    loaded = true;
    try {
        if (!fs.existsSync(LOG_FILE)) {
            return;
        }
        var raw = fs.readFileSync(LOG_FILE, "utf8");
        var lines = raw.split(/\n+/);
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            if (!line) {
                continue;
            }
            try {
                var ev = JSON.parse(line);
                if (typeof ev.id === "number" && ev.id >= nextId) {
                    nextId = ev.id + 1;
                }
                events.push(ev);
            } catch (e) {
                // ignore malformed lines
            }
        }
        if (events.length > MAX_IN_MEMORY) {
            events = events.slice(-MAX_IN_MEMORY);
        }
    } catch (e) {
        log.warn("recovery_log: could not read " + LOG_FILE + ": " + e.message);
    }
}

function rewriteLogFile() {
    try {
        fs.ensureDirSync(path.dirname(LOG_FILE));
        var body =
            events
                .map(function (e) {
                    return JSON.stringify(e);
                })
                .join("\n") + (events.length ? "\n" : "");
        fs.writeFileSync(LOG_FILE, body);
    } catch (e) {
        log.warn("recovery_log: rewrite failed: " + e.message);
    }
}

function record(event) {
    loadFromDisk();
    var ev = Object.assign(
        {
            id: nextId++,
            timestamp: new Date().toISOString(),
            acknowledged: false,
        },
        event
    );
    events.push(ev);
    if (events.length > MAX_IN_MEMORY) {
        events.shift();
    }
    try {
        fs.ensureDirSync(path.dirname(LOG_FILE));
        fs.appendFileSync(LOG_FILE, JSON.stringify(ev) + "\n");
    } catch (e) {
        log.warn("recovery_log: append failed: " + e.message);
    }
    log.info(
        "recovery event recorded: " +
            ev.config +
            " recovered_from=" +
            ev.recovered_from
    );
    return ev;
}

function getEvents(opts) {
    loadFromDisk();
    opts = opts || {};
    if (opts.unacknowledgedOnly) {
        return events.filter(function (e) {
            return !e.acknowledged;
        });
    }
    return events.slice();
}

function acknowledge(id) {
    loadFromDisk();
    var found = false;
    for (var i = 0; i < events.length; i++) {
        if (events[i].id === id && !events[i].acknowledged) {
            events[i].acknowledged = true;
            found = true;
            break;
        }
    }
    if (found) {
        rewriteLogFile();
    }
    return found;
}

function acknowledgeAll() {
    loadFromDisk();
    var changed = false;
    for (var i = 0; i < events.length; i++) {
        if (!events[i].acknowledged) {
            events[i].acknowledged = true;
            changed = true;
        }
    }
    if (changed) {
        rewriteLogFile();
    }
    return changed;
}

// Save a copy of the (presumably corrupt) source file so it can be inspected
// later. Returns the saved path via callback, or null on failure.
function saveCorruptCopy(originalPath, callback) {
    var done = function (result) {
        if (typeof callback === "function") {
            callback(result);
        }
    };
    fs.ensureDir(CORRUPT_DIR, function (mkErr) {
        if (mkErr) {
            log.warn("recovery_log: could not ensure corrupt dir: " + mkErr.message);
            return done(null);
        }
        fs.readFile(originalPath, function (rErr, data) {
            if (rErr) {
                // The file might not even be readable - log size 0 marker.
                log.warn(
                    "recovery_log: could not read corrupt source " +
                        originalPath +
                        ": " +
                        rErr.message
                );
                return done(null);
            }
            var stamp = new Date().toISOString().replace(/[:.]/g, "-");
            var dest = path.join(
                CORRUPT_DIR,
                stamp + "-" + path.basename(originalPath)
            );
            fs.writeFile(dest, data, function (wErr) {
                if (wErr) {
                    log.warn("recovery_log: could not write corrupt copy: " + wErr.message);
                    return done(null);
                }
                done(dest);
            });
        });
    });
}

module.exports = {
    record: record,
    getEvents: getEvents,
    acknowledge: acknowledge,
    acknowledgeAll: acknowledgeAll,
    saveCorruptCopy: saveCorruptCopy,
};
