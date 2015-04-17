var machine = require('../machine').machine;
var default_feed_rate = 300;

/**
 * @api {post} /direct/gcode Execute G-code directly
 * @apiGroup Direct
 * @apiParam {String} cmd A single G-code block to execute
 * @apiSuccess {Object} {status:"success",data : null}
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
 * @api {post} /direct/sbp Execute OpenSBP code directly
 * @apiGroup Direct
 * @apiParam {String} cmd A single line of OpenSBP code to execute
 * @apiSuccess {Object} {status:"success",data : null}
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
 * @api {post} /direct/move move the machine in a given direction 
 * @apiGroup Direct
 * @apiParam {Object} {move:dir} with dir equals to the direction ("x", "-x" , "y" , "-y" , "z" , "-z" , etc.) or "stop" to stop moving. 
 * @apiSuccess {Object} {status:"success",data : null}
 */
move = function(req, res, next) {
	if(req.params.move ==="stop"){
		machine.stopJog();
		answer = {
			status:"success",
			data : null
		};
		res.json(answer);
	}
	else if (req.params.move !== undefined )
	{
		machine.jog(req.params.move);
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
 * @api {post} /direct/jog jog the machine in a given direction /!\ same as move for now /!\
 * @apiGroup Direct
 * @apiParam {Object} {move:dir} with dir equals to the direction ("x", "-x" , "y" , "-y" , "z" , "-z" , etc.) or "stop" to stop moving. 
 * @apiSuccess {Object} {status:"success",data : null}
 */
jog = function(req, res, next) {
	if(req.params.move ==="stop"){
		machine.stopJog();
		answer = {
			status:"success",
			data : null
		};
		res.json(answer);
	}
	else if (req.params.move !== undefined ) {
		machine.jog(req.params.move);
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
 * @api {post} /direct/fixed_move move the machine in a given direction by a defined length (step)
 * @apiGroup Direct
 * @apiParam {Object} {move:dir,step:step} with dir equals to the direction ("x", "-x" , "y" , "-y" , "z" , "-z" , etc.) or "stop" to stop moving. 
 * @apiSuccess {Object} {status:"success",data : null}
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
 * @api {post} /direct/goto move the machine to a given position
 * @apiGroup Direct
 * @apiParam {Object} {x:posx,y:posy,z:posz, a:posa, b:posb, c:posc , f:speed}   posx,posy,posz,etc are the coordinate of the desired position. every field is optionnal.
 * @apiSuccess {Object} {status:"success",data : null}
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
