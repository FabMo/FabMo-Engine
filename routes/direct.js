var machine = require('../machine').machine;
var default_feed_rate = 300;

/**
 * @api {post} /direct/gcode Execute G-code string
 * @apiGroup Direct
 * @apiParam {String} cmd A single G-code block to execute
 * @apiSuccess {String} status success
 * @apiSuccess {Object} data null
 * @apiError {String} status error
 * @apiError {Object} message Error message
 */
sendGCode = function(req, res, next) {
	var answer;
	if (machine.status.state === 'idle')
	{
		// If cmd is specified in the request parameters, execute it as g-code
		if (req.params.cmd !== undefined )
		{
			machine.gcode(req.params.cmd);
			answer = {
				status:"success",
				data : null
			};
			res.json(answer);
		}
		// If not, check the request body.  If it is non-empty, execute it as g-code.
		else if (req.body) {
			machine.gcode(req.body);
			answer = {
				status:"success",
				data : null
			};
			res.json(answer);
		}
		// Finally, if no cmd argument and an empty request body, return an error.
		else {
			answer = {
				status:"fail",
				data : {body : "no Gcode sent"}
			};
			res.json(answer);
		}
	}
	else {
		answer = {
			status:"fail",
			data : {status : "the machine is not in idle state"}
		};
		res.json(answer);
	}
};

/**
 * @api {post} /direct/sbp Execute OpenSBP string
 * @apiGroup Direct
 * @apiParam {String} cmd A single line of OpenSBP code to execute
 * @apiSuccess {String} status success
 * @apiSuccess {Object} data null
 * @apiError {String} status error
 * @apiError {Object} message Error message
 */
 sendSBP = function(req, res, next) {
	if (machine.status.state === 'idle')
	{
		// If cmd is specified in the request parameters, execute it as OpenSBP.
		if (req.params.cmd !== undefined )
		{
			machine.sbp(req.params.cmd);
			answer = {
				status:"success",
				data : null
			};
			res.json(answer);
		}
		// If not, check the request body.  If it is non-empty, execute it as OpenSBP.
		else if (req.body) {
			machine.sbp(req.body);
			answer = {
				status:"success",
				data : null
			};
			res.json(answer);

		}
		// Finally, if no cmd argument and an empty request body, return an error.
		else {
			answer = {
				status:"fail",
				data : {body : "no SBP sent"}
			};
			res.json(answer);
		}
	}
	else {
		answer = {
			status:"fail",
			data : {status : "the machine is not in idle state"}
		};
		res.json(answer);
	}
};

/**
 * @api {post} /direct/fixed_move Move a fixed distance
 * @apiGroup Direct
 * @apiParam {String} move One of the following direction strings ("x", "-x" , "y" , "-y" , "z" , "-z" , etc.) or "stop" to stop moving. 
 * @apiParam {Number} step Increment to move in the specified direction
 * @apiSuccess {String} status success
 * @apiSuccess {Object} data null
 * @apiError {String} status error
 * @apiError {Object} message Error message
 */
fixed_move = function(req, res, next) {
	if(req.params.move ==="stop"){
		machine.stopJog();
		answer = {
			status:"success",
			data : null
		};
		res.json(answer);
	}
	else if (req.params.move !== undefined && req.params.step !== undefined) {
		machine.fixed_move(req.params.move, req.params.step, req.params.speed);
		answer = {
			status:"success",
			data : null
		};
		res.json(answer);
	}
	else {
		machine.stopJog();
		answer = {
			status:"fail",
			data : {move : "require an argument"}
		};
		res.json(answer);
	}
};

/**
 * @api {post} /direct/goto Move to a fixed position
 * @apiGroup Direct
 * @apiParam {number} x X position
 * @apiParam {number} y Y position
 * @apiParam {number} z Z position
 * @apiParam {number} a A position
 * @apiParam {number} b B position
 * @apiParam {number} c C position
 * @apiParam {number} f Feedrate (in current system units)
 * @apiSuccess {String} status success
 * @apiSuccess {Object} data null
 * @apiError {String} status error
 * @apiError {Object} message Error message
 */
goto = function(req, res, next) {
   	if (machine.status.state === 'idle')
	{
		if (req.params.x !== undefined || req.params.y !== undefined || req.params.z !== undefined || req.params.a !== undefined || req.params.b !== undefined || req.params.c !== undefined)
		{
			var gcode_string = 'G01';
			if (req.params.x !== undefined )
				gcode_string += ' X'+ req.params.x;
			if (req.params.y !== undefined )
				gcode_string += ' Y'+ req.params.y;
		 	if (req.params.z !== undefined )
				gcode_string += ' Z'+ req.params.z;
			if (req.params.a !== undefined )
				gcode_string += ' A'+ req.params.a;
			if (req.params.b !== undefined )
				gcode_string += ' B'+ req.params.b;
		 	if (req.params.c !== undefined )
				gcode_string += ' C'+ req.params.c;
			if (req.params.f !== undefined )
				gcode_string += ' F'+ req.params.f;
			else 
				gcode_string +=' F'+default_feed_rate;

			machine.driver.gcode(gcode_string);
    	answer = {
				status:"success",
				data : null
			};
			res.json(answer);
		}
		else
		{
			answer = {
				status:"fail",
				data : {posx : "require an argument"}
			};
			res.json(answer);
			}
	}
	else
	{
		answer = {
			status:"fail",
			data : {status : "the machine is not in idle state"}
		};
		res.json(answer);
	}
};


module.exports = function(server) {
	server.post('/direct/sbp',sendSBP); //OK
	server.post('/direct/gcode',sendGCode); //OK
	server.post('/direct/move',move); //OK
	server.post('/direct/jog',jog); //OK
	server.post('/direct/fixed_move',fixed_move);
	server.post('/direct/goto',goto); //OK
};
