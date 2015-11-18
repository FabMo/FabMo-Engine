var machine = require('../machine').machine;
var config = require('../config');
var log = require('../log');


/**
 * @apiGroup Log
 * @api {get} /log Get log
 * @apiDescription Get the contents of the debug log
 */
var getLog = function(req, res, next) {
  body = log.getLogBuffer();
  res.setHeader('content-type', 'text/plain');
  res.send(body);
};

/**
 * @apiGroup Log
 * @api {delete} /log Clear log
 * @apiDescription Clear the debug log.
 * @apiSuccess {String} status `success`
 * @apiSuccess {Object} data null
 */
var clearLog = function(req, res, next) {
    var answer = {
        status:"success",
        data : null
    }
    log.clearLogBuffer();
    res.json(answer);
};

module.exports = function(server) {
  server.get('/log', getLog);
  server.del('/log', clearLog)
};
