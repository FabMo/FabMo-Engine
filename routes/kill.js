process = require('process');
log = require('../log').logger('routes');

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
   server.get('/restart', kill); 
};
