process = require('process');
log = require('../log').logger('routes');

/**
 * @api {get} /restart  Kill the engine
 * @apiDescription Forcibly terminate the engine software.  Software may be restarted by system service manager
 * @apiGroup Developer
 * @apiSuccess {String} status success
 * @apiSuccess {Object} data null
 */
kill = function(req, res, next) {
    log.warn('Killing the engine by user request...');
    var answer = {
			status:"success",
			data : null
		};
		res.json(answer);
    process.exit(1);
};

module.exports = function(server) {
   server.get('/kill', kill); 
};
