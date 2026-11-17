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

// True when a browser sent this request from a page on some other site.
// Opening a session, widening it and allowing motion are the customer's
// decisions; a web page they happen to have open must not be able to make
// them. Browsers put the page's origin on such requests; ours is the same
// host as the machine (the port may differ: the startup page talks to the
// updater one port up). No Origin header at all means not a cross-site
// browser request.
function fromAnotherSite(req) {
    var origin = req && req.headers && req.headers.origin;
    if (!origin) {
        return false;
    }
    var mine = String((req.headers.host || "").replace(/:\d+$/, "")).toLowerCase();
    try {
        return new URL(origin).hostname.toLowerCase().replace(/^\[|\]$/g, "") !== mine.replace(/^\[|\]$/g, "");
    } catch (e) {
        return true; // "null" (a sandboxed or local page) or anything unreadable
    }
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

// ---------------------------------------------------------------------------
// Moving the machine. A connected tech can look at and change things, but
// cannot make the machine move until someone on the customer's side allows
// it, for a few minutes at a time. Stopping is never blocked.
// ---------------------------------------------------------------------------
var MOTION_MINUTES = 10;
var motion = { allowedUntil: 0, request: null, timer: null };

function motionAllowed() {
    return Date.now() < motion.allowedUntil;
}

function clearMotion() {
    if (motion.timer) {
        clearTimeout(motion.timer);
    }
    motion = { allowedUntil: 0, request: null, timer: null };
}

// A tech tried to move the machine without permission: put the question to
// the customer's dashboards.
function requestMotion(address) {
    var a = String(address || "").replace(/^::ffff:/, "");
    var asking = !motion.request;
    motion.request = { who: who[a] || a, at: Date.now() };
    if (asking) {
        audit("Asked to move the machine", a);
        require("./machine").machine.emit("change", "support");
    }
}

// The customer's answer. allow=false also withdraws a permission already given.
function answerMotion(allow) {
    var asked = motion.request;
    clearMotion();
    if (allow) {
        motion.allowedUntil = Date.now() + MOTION_MINUTES * 60000;
        motion.timer = setTimeout(function () {
            clearMotion();
            require("./machine").machine.emit("change", "support");
        }, MOTION_MINUTES * 60000);
        if (motion.timer.unref) {
            motion.timer.unref();
        }
        audit("Customer allowed the machine to be moved", null, "for " + MOTION_MINUTES + " minutes");
    } else {
        audit(
            asked
                ? "Customer did not allow the machine to be moved"
                : "Customer stopped allowing the machine to be moved",
        );
    }
    require("./machine").machine.emit("change", "support");
}

// For /support/status
function motionView() {
    return {
        allowed: motionAllowed(),
        until: motionAllowed() ? Math.floor(motion.allowedUntil / 1000) : null,
        request: motion.request && !motionAllowed() ? { who: motion.request.who } : null,
    };
}

// Is this HTTP request one that makes the machine move (or run code that
// can)? Stopping, pausing and everything else is not.
var MOTION_ROUTES = [
    /^\/code$/,
    /^\/macros\/[^/]+\/run$/,
    /^\/jobs\/queue\/run$/,
    /^\/job\/[^/]+\/ghost$/,
    /^\/resume$/,
    /^\/g2\/raw$/,
];
function isMotionRequest(method, url) {
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
        // GET /resume is the one read-style route that moves the machine
        if (!/^\/+resume\/?(\?|$)/.test(String(url || ""))) {
            return false;
        }
    }
    var path = String(url || "")
        .split("?")[0]
        .replace(/\/+/g, "/")
        .replace(/(.)\/$/, "$1");
    return MOTION_ROUTES.some(function (r) {
        return r.test(path);
    });
}

// Runtime messages over the websocket: everything moves or can move the
// machine except the ones that stop it.
var STOPPING = { stop: true, quit: true, exit: true, nudge_cancel: true };
function isMotionCode(data) {
    var cmd = data && data.data && data.data.cmd;
    return !STOPPING[cmd];
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
        clearMotion();
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
        clearMotion();
    } else if (was && now && was.level !== now.level) {
        // raised while running (the Grant Full Access button)
        audit("Full system access granted");
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
exports.fromAnotherSite = fromAnotherSite;
exports.readSession = readSession;
exports.audit = audit;
exports.getAudit = getAudit;
exports.noteTunnelClient = noteTunnelClient;
exports.noteTunnelMotion = noteTunnelMotion;
exports.connectedTechs = connectedTechs;
exports.motionAllowed = motionAllowed;
exports.requestMotion = requestMotion;
exports.answerMotion = answerMotion;
exports.motionView = motionView;
exports.isMotionRequest = isMotionRequest;
exports.isMotionCode = isMotionCode;
exports.MOTION_REFUSAL =
    "The customer has not allowed the machine to be moved. They have been asked on their dashboard.";
exports.onSessionChange = onSessionChange;
exports.updaterBase = updaterBase;
exports.start = start;
