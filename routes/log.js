var log = require("../log");
var fs = require('fs');
var path = require('path');

/**
 * @apiGroup Log
 * @api {get} /log Get log
 * @apiDescription Get the contents of the debug log and save it to disk.
 *   A timestamped log file is created in /opt/fabmo/log.
 *   Logs are automatically rotated to keep the 10 most recent files.
 */
// eslint-disable-next-line no-unused-vars
var getLog = function (req, res, next) {
    log.logger('routes').info('Log request received - saving log to disk');
    
    // Get log buffer to return
    var body = log.getLogBuffer();
    
    // Save log to disk asynchronously (don't block response)
    try {
        var dir = require('../config').getDataDir('log');
        var fn = 'fabmo-' + Date.now() + '-log.txt';
        var filename = path.join(dir, fn);
        
        fs.writeFile(filename, body, function(err) {
            if (err) {
                log.logger('routes').error("Failed to save log on GET: " + err);
            } else {
                log.logger('routes').info("Log saved to " + filename);
                
                // Rotate logs asynchronously (keeps 10 most recent)
                log.rotateLogs(10, function(rotateErr) {
                    if (rotateErr) {
                        log.logger('routes').error("Error rotating logs: " + rotateErr);
                    }
                });
            }
        });
    } catch(e) {
        log.logger('routes').error("Exception saving log on GET: " + e);
    }
    
    // Return log buffer immediately (don't wait for save to complete)
    res.setHeader("content-type", "text/plain");
    res.send(body);
    next();
};

/**
 * @apiGroup Log
 * @api {post} /log/save Save current log
 * @apiDescription Save the current log buffer to disk immediately
 * @apiSuccess {String} status `success`
 * @apiSuccess {Object} data Object containing saved filename
 */
var saveLog = function (req, res, next) {
    log.logger('routes').info('Explicit save log request received');
    
    try {
        var dir = require('../config').getDataDir('log');
        var fn = 'fabmo-user-saved-' + Date.now() + '-log.txt';
        var filename = path.join(dir, fn);
        
        fs.writeFile(filename, log.getLogBuffer(), function(err) {
            if (err) {
                log.logger('routes').error("Failed to save log: " + err);
                res.json({
                    status: 'error',
                    message: 'Failed to save log: ' + err.message
                });
                next();
            } else {
                log.logger('routes').info("User explicitly saved log to " + filename);
                
                // Rotate logs AFTER sending response
                log.rotateLogs(10, function(rotateErr) {
                    if (rotateErr) {
                        log.logger('routes').error("Error rotating logs: " + rotateErr);
                    }
                });
                
                res.json({
                    status: 'success',
                    data: {
                        filename: fn,
                        path: filename
                    }
                });
                next();
            }
        });
    } catch(e) {
        log.logger('routes').error("Error saving log: " + e);
        res.json({
            status: 'error',
            message: 'Error saving log: ' + e.message
        });
        next();
    }
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
    next();
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
    next();
};

module.exports = function (server) {
    server.get("/log", getLog);
    server.post("/log/save", saveLog);
    server.del("/log", clearLog);
    server.get("/flight", getFlightLog);
};