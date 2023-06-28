/*
 * routes/time.js
 *
 * Route for setting the time
 */

// Set time to the value provided in the post body.
// POST body example: {"ms": 1234567} where `ms` is ms since the unix epoch

var engine = require("../engine");

// eslint-disable-next-line no-unused-vars
var setTime = function (req, res, next) {
    if (req.params.ms) {
        engine.setTime(req.params.ms);
    }
};

// eslint-disable-next-line no-unused-vars
var get_time = function (req, res, next) {
    const d = new Date();
    let t = d.getTime();
    var answer = {
        status: "success",
        data: { time: t },
    };
    res.json(answer);
};

module.exports = function (server) {
    server.post("/time", setTime);
    server.get("/time", get_time);
};
