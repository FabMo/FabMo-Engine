var log = require("../log");

/**
 * @apiGroup Log
 * @api {get} /log Get log
 * @apiDescription Get the contents of the debug log
 */
// eslint-disable-next-line no-unused-vars
var getLog = function (req, res, next) {
    var body = log.getLogBuffer();
    res.setHeader("content-type", "text/plain");
    res.send(body);
};

/**
 * @apiGroup Log
 * @api {get} /flight Get log
 * @apiDescription Get the contents of the debug log
 */
// eslint-disable-next-line no-unused-vars
var getFlightLog = function (req, res, next) {
    try {
        res.json(log.getFlightLog());
    } catch (e) {
        res.send(503, e.message);
    }
};

/**
 * @apiGroup Log
 * @api {delete} /log Clear log
 * @apiDescription Clear the debug log.
 * @apiSuccess {String} status `success`
 * @apiSuccess {Object} data null
 */
// eslint-disable-next-line no-unused-vars
var clearLog = function (req, res, next) {
    var answer = {
        status: "success",
        data: null,
    };
    log.clearLogBuffer();
    res.json(answer);
};

module.exports = function (server) {
    server.get("/log", getLog);
    server.del("/log", clearLog);
    server.get("/flight", getFlightLog);
};
