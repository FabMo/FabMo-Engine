var machine = require("../machine").machine;

/**
 * @api {post} /direct control of acc's like spindles
 * @apiGroup acc
 * @apiDescription Execute the POSTed acc request
 * @apiParam {Object} acc ITEM.  Currently suppored: `spindle-speed`
 * @apiParam {Object} new RPM.
 * @apiError {String} status `error`
 * @apiError {Object} message Error message
 */
var spindle_speed = function (req, res, next) {
    var answer = {
        status: "success",
        data: null,
    };
    // Adjust parameter names to match the client's payload
    if (req.body.rpm !== undefined) {
        var RPM = req.body.rpm;
        machine.spindleSpeed(RPM);
    } else {
        answer = {
            status: "error",
            message: "No RPM specified in request.",
        };
    }
    res.json(answer);
};

module.exports = function (server) {
    server.post("/acc/spindle_speed", spindle_speed);
};
