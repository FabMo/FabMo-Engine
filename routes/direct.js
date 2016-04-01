var machine = require('../machine').machine;
var passport = require('../authentication').passport;
/**
 * @api {post} /code Execute tool runtime code
 * @apiGroup Direct
 * @apiDescription Run the POSTed code using the specified runtime.
 * @apiParam {Object} runtime Name of the runtime to run the code.  Currently suppored: `g` | `sbp`
 * @apiParam {Object} cmd The actual code to run.
 * @apiError {String} status `error`
 * @apiError {Object} message Error message
 */
var code = function(req, res, next) {
	var answer = {
				status:"success",
				data : null
	};

	if(machine.status.state === 'idle') {
		if (req.params.cmd !== undefined )
		{
			if(req.params.runtime !== undefined) {
				var rt = req.params.runtime.toLowerCase().trim();
				switch(rt) {
					case 'opensbp':
					case 'sbp':
						machine.sbp(req.params.cmd);
						break;

					case 'g':
					case 'nc':
					case 'gcode':
						machine.gcode(req.params.cmd);
						break;

					default:
						answer = {
							status:"error",
							message: "Runtime '" + rt + "' is unknown."
						}
						break;
				}
			} else {
				answer = {
					status:"error",
					message: "No runtime specified in request."
				}
			}
		} else {
			answer = {
				status:"error",
				message:"No code specified in request."
			}
		}
	} else {
		answer = {
			status:"error",
			message:"Machine is not in 'idle' state."
		}
	}
	res.json(answer);
}

module.exports = function(server) {
	server.post('/code',passport.authenticate('local'),code);
};
