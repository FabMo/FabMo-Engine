var machine = require('../machine').machine;

var code = function(req, res, next) {
	var answer = {
				status:"success",
				data : null
	};
	console.log(req.params)
	if(machine.status.state === 'idle') {
		if (req.params.cmd !== undefined )
		{
			if(req.params.runtime !== undefined) {
				var rt = req.params.runtime.toLowerCase().trim();
				switch(rt) {
					case 'opensbp':
					case 'sbp':
						console.log("OpenSBPing")
						console.log(req.params.cmd)
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
	server.post('/code',code);
};
