/*
 * routes/time.js
 *
 * Route for setting the time
 */

 // Set time to the value provided in the post body.
 // POST body example: {"ms": 1234567} where `ms` is ms since the unix epoch

 var engine = require('../engine');
 
 var setTime = function(req, res, next) {
	if(req.params.ms) {

		engine.setTime(req.params.ms)		
	}
};

module.exports = function(server) {
   server.post('/time', setTime); 
};
