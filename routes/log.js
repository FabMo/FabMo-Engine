var log = require("../log");
var fs = require('fs');
var path = require('path');

/**
 * @apiGroup Log
 * @api {get} /log Get log
 * @apiDescription Get the contents of the debug log
 */
// eslint-disable-next-line no-unused-vars
var getLog = function (req, res, next) {
    console.log('=== LOG ROUTE CALLED ==='); // Debug output
    
    var body = log.getLogBuffer();
    
    // Always save when accessed via browser to capture diagnostic moment
    try {
        var dir = require('../config').getDataDir('log');
        var fn = 'fabmo-user-requested-' + Date.now() + '-log.txt';
        var filename = path.join(dir, fn);
        
        console.log('Attempting to save log to:', filename); // Debug output
        
        fs.writeFile(filename, body, function(err) {
            if (err) {
                console.error('FAILED to save log:', err); // Debug output
                log.logger('routes').error("Failed to save user-requested log: " + err);
            } else {
                console.log('SUCCESS: Log saved to', filename); // Debug output
                log.logger('routes').info("User-requested log saved to " + filename);
                // Rotate logs to prevent accumulation (keep last 10 user-requested logs)
                log.rotateLogs(10, function(rotateErr) {
                    if (rotateErr) {
                        log.logger('routes').error("Error rotating logs: " + rotateErr);
                    }
                });
            }
        });
    } catch(e) {
        console.error('EXCEPTION saving log:', e); // Debug output
        log.logger('routes').error("Error saving user-requested log: " + e);
    }
    
    // Send response immediately - don't wait for save to complete
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
    console.log('=== SAVE LOG ENDPOINT CALLED ==='); // Debug output
    log.logger('routes').info('Explicit save log request received');
    
    try {
        var dir = require('../config').getDataDir('log');
        var fn = 'fabmo-user-saved-' + Date.now() + '-log.txt';
        var filename = path.join(dir, fn);
        
        console.log('Attempting explicit save to:', filename); // Debug output
        
        fs.writeFile(filename, log.getLogBuffer(), function(err) {
            if (err) {
                console.error('FAILED explicit save:', err); // Debug output
                // Send error response
                res.json({
                    status: 'error',
                    message: 'Failed to save log: ' + err.message
                });
                next();
            } else {
                console.log('SUCCESS: Explicit save to', filename); // Debug output
                log.logger('routes').info("User explicitly saved log to " + filename);
                
                // Rotate logs AFTER sending response
                log.rotateLogs(10, function(rotateErr) {
                    if (rotateErr) {
                        log.logger('routes').error("Error rotating logs: " + rotateErr);
                    }
                    // Don't do anything with the response here - it's already sent
                });
                
                // Send success response immediately
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
        console.error('EXCEPTION in explicit save:', e); // Debug output
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
    console.log('=== REGISTERING LOG ROUTES ==='); // Debug output
    server.get("/log", getLog);
    server.post("/log/save", saveLog);
    server.del("/log", clearLog);
    server.get("/flight", getFlightLog);
};