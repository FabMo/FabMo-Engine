var machine = require("../machine").machine;

/**
 * @api {post}  // Direct control of accessories like spindles
 * @apiGroup acc  // *have not figured out how to make these calls work as groups
 * @apiDescription Execute the POSTed acc request
 * @apiParam {Object} acc ITEM.  Currently supported: `spindle-speed`
 * @apiParam {Object} new RPM.
 * @apiError {String} status `error`
 * @apiError {Object} message Error message
 */

// eslint-disable-next-line no-unused-vars
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
    
    server.get('/backup/status', function(req, res, next) {
    const watcher = require('../config_watcher');
    res.send(watcher.getBackupStatus());
    next();
});

};
