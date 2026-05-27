// Dev-only raw G2 JSON passthrough.
//
// Lets us POST arbitrary G2 firmware JSON commands and see the firmware's reply.
// Intended for testing firmware features that don't have a higher-level FabMo
// wrapper yet (initial use case: {"jgvx":...} velocity-mode jog). Not safe to
// expose long-term — it bypasses every safety wrapper in machine.js.
//
// POST /g2/raw   body: {cmd: "<json string>"}    or   body: {cmd: {tokens...}}
//   Forwards via machine.driver.command(...). Returns the firmware's next
//   response if it arrives within RESPONSE_TIMEOUT_MS, otherwise {status:"sent"}.

var machine = require("../machine").machine;
var log = require("../log").logger("g2raw");

var RESPONSE_TIMEOUT_MS = 500;

var rawCommand = function (req, res, next) {
    var cmd = req.params.cmd;
    if (cmd === undefined || cmd === null) {
        return res.json({ status: "error", message: "missing 'cmd' (string or object)" });
    }

    var driver = machine && machine.driver;
    if (!driver || typeof driver.command !== "function") {
        return res.json({ status: "error", message: "g2 driver not available" });
    }

    // Response capture. Driver emits a "response" event per JSON reply
    // (see g2.js:1235). fabmo sends its own background commands (status polls,
    // etc.), so we don't just grab the next response — we try to match by
    // token name. If the response body contains a key we sent, that's "ours";
    // otherwise it belongs to fabmo's internal traffic and we keep listening.
    // Collect any unmatched responses in case nothing matches by timeout.
    var settled = false;
    var timer = null;
    var collected = [];
    var sentKeys = [];
    var cmdObj = (typeof cmd === "string") ? null : cmd;
    if (cmdObj && typeof cmdObj === "object") {
        sentKeys = Object.keys(cmdObj);
    }

    var responseMatchesOurCommand = function (body) {
        if (!body || typeof body !== "object" || sentKeys.length === 0) return false;
        // direct token match: {"jgvx":...}, {"fb":...}
        for (var i = 0; i < sentKeys.length; i++) {
            if (Object.prototype.hasOwnProperty.call(body, sentKeys[i])) return true;
        }
        // wrapped match: response is {x:{...}} when we sent {x:{...}}
        // (g2 sometimes echoes nested keys at the parent level instead)
        return false;
    };

    var finishWith = function (body, note) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        driver.removeListener("response", onResponse);
        var payload = { response: body };
        if (note) payload.note = note;
        if (collected.length && body !== collected[collected.length - 1]) {
            payload.also_seen = collected;
        }
        res.json({ status: "success", data: payload });
    };

    var onResponse = function (filtered, body) {
        if (settled) return;
        collected.push(body);
        if (responseMatchesOurCommand(body)) {
            finishWith(body, null);
        }
        // else keep listening — this was probably a fabmo-internal poll
    };

    driver.on("response", onResponse);

    timer = setTimeout(function () {
        finishWith(collected.length ? collected[collected.length - 1] : null,
                   "no token-matched response within " + RESPONSE_TIMEOUT_MS + "ms");
    }, RESPONSE_TIMEOUT_MS);

    try {
        log.info("g2raw cmd: " + (typeof cmd === "string" ? cmd : JSON.stringify(cmd)));
        driver.command(cmd);
    } catch (e) {
        if (!settled) {
            settled = true;
            clearTimeout(timer);
            driver.removeListener("response", onResponse);
            res.json({ status: "error", message: "driver.command threw: " + (e.message || String(e)) });
        }
    }
};

module.exports = function (server) {
    server.post("/g2/raw", rawCommand);
};
