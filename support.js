/*
 * support.js
 *
 * Engine side of remote-support sessions.
 *
 * The session itself (the Tailscale tunnel, its firewall and its expiry) is
 * owned by the updater - see FabMo-Updater support/README.md. The engine
 * adds the parts the customer sees:
 *   - knowing whether a request came in over the support tunnel
 *   - telling the dashboard when a session starts or ends (a "change" event
 *     with topic "support" - the dashboard does not poll)
 *   - an audit log of what was done over the tunnel, kept where the customer
 *     can read it
 */
var fs = require("fs");
var path = require("path");
var got = require("got");
var config = require("./config");
var log = require("./log").logger("support");

// Written by the updater's fabmo-support script while a session is running
var SESSION_FILE = "/run/fabmo-support/session.json";
// ...and while a support code is waiting to be used (no secrets in it)
var PENDING_FILE = "/run/fabmo-support/pending.json";

// Outside /opt/fabmo on purpose: engine updates delete that tree wholesale,
// and a record of who was on the machine should survive an update.
var AUDIT_DIR = "/opt/fabmo-support";
var AUDIT_FILE = path.join(AUDIT_DIR, "audit.log");
var AUDIT_MAX_BYTES = 512 * 1024;
var AUDIT_KEEP = 300; // entries held in memory for the dashboard

var entries = [];
var loaded = false;
var lastSession = null; // what the watcher last saw
var who = {}; // tunnel address -> "name (device)" for the current session
var seen = {}; // tunnel address -> true once "connected" was logged
var lastMotionNote = {}; // tunnel address -> ms, to keep jogging from flooding the log

function updaterBase() {
    return "http://127.0.0.1:" + (config.engine.get("server_port") + 1);
}

// True when a connection came in over the support tunnel (Tailscale's
// address ranges) rather than from the customer's own network.
// Pass the socket's real remote address - never a forwarded-for header,
// which the far end could set to anything.
function isTunnelAddress(address) {
    var a = String(address || "")
        .toLowerCase()
        .replace(/^::ffff:/, "");
    if (a.indexOf("fd7a:115c:a1e0:") === 0) {
        return true;
    }
    var m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(a);
    if (!m) {
        return false;
    }
    var first = parseInt(m[1], 10);
    var second = parseInt(m[2], 10);
    return first === 100 && second >= 64 && second <= 127; // 100.64.0.0/10
}

function readSession() {
    try {
        var s = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
        return s && s.active ? s : null;
    } catch (e) {
        return null;
    }
}

function loadAudit() {
    if (loaded) {
        return;
    }
    loaded = true;
    try {
        fs.readFileSync(AUDIT_FILE, "utf8")
            .split("\n")
            .forEach(function (line) {
                if (!line) {
                    return;
                }
                try {
                    entries.push(JSON.parse(line));
                } catch (e) {
                    /* skip a damaged line */
                }
            });
        entries = entries.slice(-AUDIT_KEEP);
    } catch (e) {
        /* no log yet */
    }
}

// Add one line to the audit log. `what` is a short plain-language phrase.
function audit(what, address, detail) {
    loadAudit();
    var entry = { time: Date.now(), what: what };
    if (address) {
        entry.from = String(address).replace(/^::ffff:/, "");
        if (who[entry.from]) {
            entry.who = who[entry.from];
        }
    }
    if (detail) {
        entry.detail = detail;
    }
    entries.push(entry);
    if (entries.length > AUDIT_KEEP) {
        entries = entries.slice(-AUDIT_KEEP);
    }
    try {
        fs.mkdirSync(AUDIT_DIR, { recursive: true });
        var size = 0;
        try {
            size = fs.statSync(AUDIT_FILE).size;
        } catch (e) {
            /* new file */
        }
        if (size > AUDIT_MAX_BYTES) {
            // start over from what is in memory rather than grow without end
            fs.writeFileSync(
                AUDIT_FILE,
                entries
                    .map(function (e) {
                        return JSON.stringify(e);
                    })
                    .join("\n") + "\n",
            );
        } else {
            fs.appendFileSync(AUDIT_FILE, JSON.stringify(entry) + "\n");
        }
    } catch (e) {
        log.warn("Could not write the support audit log: " + e.message);
    }
    log.info("audit: " + what + (entry.who ? " [" + entry.who + "]" : entry.from ? " [" + entry.from + "]" : ""));
}

// Most recent entries, newest first
function getAudit(limit) {
    loadAudit();
    return entries.slice(-(limit || 100)).reverse();
}

// Ask the updater who is behind a tunnel address, once per address per
// session, so log lines and the banner can name the tech.
function identify(address) {
    var a = String(address || "").replace(/^::ffff:/, "");
    if (who[a] !== undefined) {
        return;
    }
    who[a] = ""; // asked; filled in below if the lookup works
    got(updaterBase() + "/support/whois/" + encodeURIComponent(a), { responseType: "json", timeout: 5000 })
        .then(function (r) {
            var d = r.body && r.body.data;
            if (d && (d.user || d.device)) {
                who[a] = [d.user, d.device ? "(" + d.device + ")" : ""].join(" ").trim();
                require("./machine").machine.emit("change", "support");
            }
        })
        .catch(function () {
            /* the name is a nicety; the address is still logged */
        });
}

// Called for every HTTP request and socket connection that arrived over the
// tunnel. Logs the first sighting of each tech.
function noteTunnelClient(address) {
    var a = String(address || "").replace(/^::ffff:/, "");
    identify(a);
    if (!seen[a]) {
        seen[a] = true;
        // give the name lookup a moment so the line can carry it
        setTimeout(function () {
            audit("Support tech connected", a);
            require("./machine").machine.emit("change", "support");
        }, 1500);
    }
}

// Jogging sends a stream of messages; one line per burst is enough.
function noteTunnelMotion(address) {
    var a = String(address || "").replace(/^::ffff:/, "");
    var now = Date.now();
    if (!lastMotionNote[a] || now - lastMotionNote[a] > 15000) {
        audit("Moved the machine by hand (keypad)", a);
    }
    lastMotionNote[a] = now;
}

// Techs seen in the current session, for the banner
function connectedTechs() {
    return Object.keys(seen).map(function (a) {
        return who[a] || a;
    });
}

function onSessionChange() {
    var now = readSession();
    var was = lastSession;
    lastSession = now;
    if (!was && now) {
        who = {};
        seen = {};
        lastMotionNote = {};
        audit(
            "Support session started",
            null,
            (now.level === "system" ? "full system access" : "dashboard access") +
                ", until " +
                new Date(now.expires * 1000).toLocaleTimeString(),
        );
    } else if (was && !now) {
        audit("Support session ended");
        who = {};
        seen = {};
    } else {
        return;
    }
    require("./machine").machine.emit("change", "support");
}

// Start watching for sessions starting and ending. The session can end
// without the engine being told (its own timer, the updater page, a
// terminal), so the record file is watched rather than trusted to callers.
function start() {
    lastSession = readSession();
    fs.watchFile(SESSION_FILE, { interval: 2000, persistent: false }, onSessionChange);
    // each step of a code request (issued, claimed, failed) reaches the
    // dashboard the same way
    fs.watchFile(PENDING_FILE, { interval: 1000, persistent: false }, function () {
        require("./machine").machine.emit("change", "support");
    });
}

exports.isTunnelAddress = isTunnelAddress;
exports.readSession = readSession;
exports.audit = audit;
exports.getAudit = getAudit;
exports.noteTunnelClient = noteTunnelClient;
exports.noteTunnelMotion = noteTunnelMotion;
exports.connectedTechs = connectedTechs;
exports.onSessionChange = onSessionChange;
exports.updaterBase = updaterBase;
exports.start = start;
