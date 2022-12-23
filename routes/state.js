var fs = require("fs");
var machine = require("../machine").machine;
var db = require("../db");
var File = db.File;

// These are the only file extensions that are allowed for upload.
// File extension filtering is not case sensitive
ALLOWED_EXTENSIONS = [".nc", ".g", ".sbp", ".gc", ".gcode"];

/**
 * @api {get} /quit Quit
 * @apiGroup State
 * @apiDescription Abort the current job, whether it is running, paused, or stopped due to an error.
 * @apiSuccess {String} status `success`
 * @apiSuccess {Object} data null
 * @apiError {String} status `error`
 * @apiError {Object} message Error message
 */
quit = function (req, res, next) {
    machine.quit();
    var answer = {
        status: "success",
        data: null,
    };
    res.json(answer);
};

/**
 * @api {get} /pause Pause
 * @apiDescription Pause the current job. Only a valid operation when a job is running. Generally, a resume is possible after this operation.
 * @apiGroup State
 * @apiSuccess {String} status `success`
 * @apiSuccess {Object} data null
 * @apiError {String} status `error`
 * @apiError {Object} message Error message
 */
pause = function (req, res, next) {
    machine.pause();
    var answer = {
        status: "success",
        data: null,
    };
    res.json(answer);
};

/**
 * @api {get} /resume Resume
 * @apiGroup State
 * @apiDescription Continue running the current job if the system is paused.
 * @apiSuccess {String} status `success`
 * @apiSuccess {Object} data null
 * @apiError {String} status `error`
 * @apiError {Object} message Error message
 */
resume = function (req, res, next) {
    machine.resume();
    var answer = {
        status: "success",
        data: null,
    };
    res.json(answer);
};

module.exports = function (server) {
    //server.get('/run/:id',run); //OK
    server.post("/quit", quit); //OK
    server.post("/pause", pause); //OK
    server.post("/resume", resume); //OK
};
