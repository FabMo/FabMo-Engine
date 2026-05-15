var log = require("../log");
var fs = require('fs');
var path = require('path');

// Rate limiting for log saves to prevent excessive disk writes
var lastLogSave = 0;
var LOG_SAVE_COOLDOWN = 30000; // 30 seconds minimum between saves

// Excessive polling detection (warns clients polling too frequently without nosave=1)
var pollingTracker = {}; // { ip: { count: N, firstSeen: timestamp, lastWarned: timestamp } }
var POLLING_WINDOW = 10000; // 10 second window
var POLLING_THRESHOLD = 8;   // More than 8 requests in 10 seconds = excessive
var POLLING_WARN_COOLDOWN = 300000; // Warn once every 5 minutes per IP

/**
 * @apiGroup Log
 * @api {get} /log Get log
 * @apiDescription Get the contents of the debug log and save it to disk (rate-limited).
 *   A timestamped log file is created in /opt/fabmo/log, but no more than once per 30 seconds.
 *   Logs are automatically rotated to keep the 10 most recent files.
 *   For immediate saves without rate limiting, use POST /log/save.
 *   To skip auto-save entirely (e.g., for polling/monitoring), add ?nosave=1 query parameter.
 * 
 * @apiParam {String} [nosave] If "1" or "true", skip auto-save and only return log buffer
 */
// eslint-disable-next-line no-unused-vars
var getLog = function (req, res, next) {
    var now = Date.now();
    var nosave = req.query.nosave === '1' || req.query.nosave === 'true';
    var shouldSave = !nosave && (now - lastLogSave) > LOG_SAVE_COOLDOWN;
        // Track polling frequency to warn about excessive polling
    var ip = req.connection.remoteAddress || 'unknown';
    if (!nosave && ip !== 'unknown') {
        if (!pollingTracker[ip]) {
            pollingTracker[ip] = { count: 1, firstSeen: now, lastWarned: 0 };
        } else {
            var tracker = pollingTracker[ip];
            
            // Reset counter if window has expired
            if (now - tracker.firstSeen > POLLING_WINDOW) {
                tracker.count = 1;
                tracker.firstSeen = now;
            } else {
                tracker.count++;
                
                // Warn if excessive polling detected (and not warned recently)
                if (tracker.count > POLLING_THRESHOLD && (now - tracker.lastWarned) > POLLING_WARN_COOLDOWN) {
                    log.logger('routes').warn(
                        'EXCESSIVE LOG POLLING detected from ' + ip + ': ' + tracker.count + 
                        ' requests in ' + (now - tracker.firstSeen) + 'ms. ' +
                        'This may cause G2 disconnects! Use ?nosave=1 and reduce polling frequency to 10+ seconds.'
                    );
                    tracker.lastWarned = now;
                }
            }
        }
    }
        // Log who's requesting (for debugging excessive polling)
    var userAgent = req.headers['user-agent'] || 'unknown';
    var saveReason = nosave ? 'NO - nosave param' : (shouldSave ? 'YES' : 'NO - cooldown active');
    log.logger('routes').debug('Log request from: ' + (req.connection.remoteAddress || 'unknown') + 
                                ' UA: ' + userAgent.substring(0, 50) +
                                ' (save: ' + saveReason + ')');
    
    // Get log buffer to return
    var body = log.getLogBuffer();
    
    // Save log to disk asynchronously (but only if cooldown elapsed)
    if (shouldSave) {
        lastLogSave = now;
        log.logger('routes').info('Log request received - saving log to disk');
        
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