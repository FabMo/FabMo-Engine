/*
 * routes/support.js
 *
 * Remote-support sessions, as the dashboard sees them. The session itself
 * is run by the updater (port 81); these routes relay to it over loopback
 * and add the engine's own view: who is connected and the audit log.
 *
 *   GET  /support/status  -> {active, level, address, name, started, expires,
 *                             viaTunnel, techs: [...]}
 *   POST /support/request {level, minutes} -> {code, expires, state}  (normal way in)
 *   POST /support/cancel
 *   POST /support/start   {key, level: "dashboard"|"system", minutes}  (key in hand)
 *   POST /support/stop
 *   GET  /support/log     -> [{time, what, who, from, detail}, ...] newest first
 */
var got = require("got");
var log = require("../log").logger("routes");
var config = require("../config");
var support = require("../support");

// The real peer address. Deliberately not util.getClientAddress(): that
// honours X-Forwarded-For, which a tech's browser could set to look local.
function peer(req) {
    return (req.connection && req.connection.remoteAddress) || "";
}

function relayError(res, err) {
    var message = err && err.message ? err.message : String(err);
    if (err && err.code === "ECONNREFUSED") {
        message = "The updater service is not running, so remote support is not available.";
    }
    res.json({ status: "error", message: message });
}

var getStatus = function (req, res, next) {
    got(support.updaterBase() + "/support/status", { responseType: "json", timeout: 5000 })
        .then(function (r) {
            var body = r.body || {};
            if (body.status === "success" && body.data) {
                body.data.viaTunnel = support.isTunnelAddress(peer(req));
                body.data.techs = body.data.active ? support.connectedTechs() : [];
            }
            res.json(body);
            next();
        })
        .catch(function (err) {
            relayError(res, err);
            next();
        });
};

// Only the customer's side may open a session. The relay below reaches the
// updater from loopback, so the updater's own check cannot see where the
// request really came from - it has to be refused here.
var start = function (req, res, next) {
    if (support.isTunnelAddress(peer(req))) {
        log.warn("Refused a support/start request that came in over the support tunnel");
        support.audit("Tried to start a support session from the support side (refused)", peer(req));
        res.json({
            status: "error",
            message: "A support session can only be started from the machine's own network.",
        });
        return next();
    }
    var body = req.body && typeof req.body === "object" ? req.body : req.params || {};
    got.post(support.updaterBase() + "/support/start", {
        json: { key: body.key, level: body.level, minutes: body.minutes },
        responseType: "json",
        timeout: 8 * 60 * 1000, // a first start downloads the support software
    })
        .then(function (r) {
            support.onSessionChange();
            res.json(r.body);
            next();
        })
        .catch(function (err) {
            relayError(res, err);
            next();
        });
};

// Ask for a short code to read to the technician (the normal way in).
// Same rule as start: only from the customer's side.
var request = function (req, res, next) {
    if (support.isTunnelAddress(peer(req))) {
        log.warn("Refused a support/request that came in over the support tunnel");
        support.audit("Tried to start a support session from the support side (refused)", peer(req));
        res.json({
            status: "error",
            message: "A support session can only be started from the machine's own network.",
        });
        return next();
    }
    var body = req.body && typeof req.body === "object" ? req.body : req.params || {};
    got.post(support.updaterBase() + "/support/request", {
        json: { level: body.level, minutes: body.minutes, version: config.engine.get("version") || "" },
        responseType: "json",
        timeout: 30000,
    })
        .then(function (r) {
            res.json(r.body);
            next();
        })
        .catch(function (err) {
            relayError(res, err);
            next();
        });
};

var cancel = function (req, res, next) {
    got.post(support.updaterBase() + "/support/cancel", { responseType: "json", timeout: 15000 })
        .then(function (r) {
            res.json(r.body);
            next();
        })
        .catch(function (err) {
            relayError(res, err);
            next();
        });
};

// Anyone may end a session, from either side.
var stop = function (req, res, next) {
    var from = peer(req);
    got.post(support.updaterBase() + "/support/stop", { responseType: "json", timeout: 60000 })
        .then(function (r) {
            if (support.isTunnelAddress(from)) {
                support.audit("Ended the support session", from);
            }
            support.onSessionChange();
            res.json(r.body);
            next();
        })
        .catch(function (err) {
            relayError(res, err);
            next();
        });
};

var getLog = function (req, res, next) {
    res.json({ status: "success", data: support.getAudit(200) });
    next();
};

// What a support tech did, in words the customer can read. Reads (GET) are
// not logged; anything that changes the machine is.
var ACTIONS = [
    [/^\/job\/?$/, "POST", "Submitted a job"],
    [/^\/jobs\/queue\/run/, "POST", "Started the next job"],
    [/^\/jobs\/queue/, "DELETE", "Cleared the job queue"],
    [/^\/job\//, "DELETE", "Removed a job"],
    [/^\/job\//, "POST", "Changed a job"],
    [/^\/quit/, "POST", "Quit the running job"],
    [/^\/pause/, "POST", "Paused the machine"],
    [/^\/resume/, "POST", "Resumed the machine"],
    [/^\/code/, "POST", "Ran a command"],
    [/^\/direct\//, "POST", "Ran a command"],
    [/^\/macros\/\d+\/run/, "POST", "Ran a macro"],
    [/^\/macros/, "POST", "Changed a macro"],
    [/^\/macros/, "DELETE", "Deleted a macro"],
    [/^\/config/, "POST", "Changed settings"],
    [/^\/snapshots/, "POST", "Saved or restored a settings snapshot"],
    [/^\/snapshots/, "DELETE", "Deleted a settings snapshot"],
    [/^\/apps/, "POST", "Installed an app"],
    [/^\/apps/, "DELETE", "Removed an app"],
    [/^\/update/, "POST", "Started a software update"],
    [/^\/firmware/, "POST", "Updated the motion firmware"],
    [/^\/network/, "POST", "Changed network settings"],
    [/^\/authentication/, "POST", "Signed in or changed a user"],
    [/^\/kill/, "POST", "Stopped the machine (kill)"],
    [/^\/g2\//, "POST", "Sent a low-level command to the motion board"],
    [/^\/acc\//, "POST", "Changed spindle settings"],
    [/^\/profile/, "POST", "Changed the machine profile"],
    [/^\/time/, "POST", ""], // the dashboard sets the clock on load; not an action
    [/^\/support\//, "", ""], // logged by the handlers above
];

function describe(method, url) {
    var path = String(url || "").split("?")[0];
    for (var i = 0; i < ACTIONS.length; i++) {
        if (ACTIONS[i][0].test(path) && (!ACTIONS[i][1] || ACTIONS[i][1] === method)) {
            return ACTIONS[i][2];
        }
    }
    return "Changed something (" + method + " " + path + ")";
}

module.exports = function (server) {
    // Before routing, so nothing over the tunnel is missed
    server.pre(function supportAudit(req, res, next) {
        var from = peer(req);
        if (support.isTunnelAddress(from)) {
            support.noteTunnelClient(from);
            if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS") {
                var what = describe(req.method, req.url);
                if (what) {
                    support.audit(what, from, req.method + " " + String(req.url).split("?")[0]);
                }
            }
        }
        return next();
    });

    server.get("/support/status", getStatus);
    server.post("/support/request", request);
    server.post("/support/cancel", cancel);
    server.post("/support/start", start);
    server.post("/support/stop", stop);
    server.get("/support/log", getLog);
    support.start();
};
