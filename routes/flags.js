/*
 * routes/flags.js
 *
 * REST access to machine condition flags (see flags.js).
 * Definitions live in the machine config (machine.flags); these routes
 * expose the live state and allow setting/clearing a flag directly —
 * mainly for apps and bench testing. The usual set path is an input edge
 * or engine startup; the usual clear path is SF,"NAME",0 at the end of a
 * recovery macro.
 */
var flags = require("../flags");
var log = require("../log").logger("routes");

/**
 * @apiGroup Flags
 * @api {get} /flags Get condition flags
 * @apiDescription Every defined flag with its definition and current state.
 */
// eslint-disable-next-line no-unused-vars
var getFlags = function (req, res, next) {
    res.json({ status: "success", data: { flags: flags.summary() } });
    next();
};

/**
 * @apiGroup Flags
 * @api {post} /flags/:name Set or clear a condition flag
 * @apiParam {Number} value 1 to set, 0 to clear
 */
// eslint-disable-next-line no-unused-vars
var postFlag = function (req, res, next) {
    var name = req.params.name;
    var value = req.params.value !== undefined ? Number(req.params.value) : 1;
    var result = value ? flags.set(name, "api") : flags.clear(name, "api");
    if (result && result.error) {
        log.warn("Flag " + name + " not " + (value ? "set" : "cleared") + ": " + result.error);
        res.json({ status: "error", message: result.error });
    } else {
        res.json({ status: "success", data: { flags: flags.summary() } });
    }
    next();
};

module.exports = function (server) {
    server.get("/flags", getFlags);
    server.post("/flags/:name", postFlag);
};
