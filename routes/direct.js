var machine = require('../machine').machine;
var default_feed_rate = 300;

// Handler for move in a specified direction (keypad mode)
function move_direction(direction) {
	machine.jog(direction);
}

// Handler for jog in a specified direction (keypad mode)
function jog_direction(direction) {
	machine.jog(direction);
}

// Handler for move in a specified direction by fixed step(keypad mode)
function fixed_move_direction(direction,step) {
	machine.fixed_move(direction,step);
}

// Handler for immediate stop of a keypad move or jog
function stop() {
	machine.stopJog();
}

/**
 * @api {post} /direct/gcode Execute G-code directly
 * @apiGroup Direct
 * @apiParam {String} cmd A single G-code block to execute
 * @apiSuccess {Object} success Echo of the command sent
 */
sendGCode = function(req, res, next) {
	if (machine.status.state === 'idle')
	{
		// If cmd is specified in the request parameters, execute it as g-code
		if (req.params.cmd !== undefined )
		{
			machine.gcode(req.params.cmd);
			res.json({'success': req.params.cmd});
		}
		// If not, check the request body.  If it is non-empty, execute it as g-code.
		else if (req.body) {
			machine.gcode(req.body);
			res.json({'success': req.params.cmd});

		}
		// Finally, if no cmd argument and an empty request body, return an error.
		else {
			res.json({'error':'No cmd argument'});
		}
	}
	else {
		res.json({'error':'A file is running'});
	}
};

/**
 * @api {post} /direct/sbp Execute OpenSBP code directly
 * @apiGroup Direct
 * @apiParam {String} cmd A single line of OpenSBP code to execute
 * @apiSuccess {Object} success Echo of the command sent
 */
 sendSBP = function(req, res, next) {
	if (machine.status.state === 'idle')
	{
		// If cmd is specified in the request parameters, execute it as OpenSBP.
		if (req.params.cmd !== undefined )
		{
			machine.sbp(req.params.cmd);
			res.json({'success': req.params.cmd});
		}
		// If not, check the request body.  If it is non-empty, execute it as OpenSBP.
		else if (req.body) {
			machine.sbp(req.body);
			res.json({'success': req.params.cmd});

		}
		// Finally, if no cmd argument and an empty request body, return an error.
		else {
			res.json({'error':'No cmd argument'});
		}
	}
	else {
		res.json({'error':'A file is running'});
	}
};


move = function(req, res, next) {
	if(req.params.move ==="stop"){
		stop();
		res.json({'success':'stop'});
	}
	else if (req.params.move !== undefined )
	{
		move_direction(req.params.move);
		res.json({'success': 'moving in '+req.params.move+' direction'});
	}
	else {
		stop();
		res.json({'error':'Need at least one argument'});
	}
};

jog = function(req, res, next) {
	if(req.params.move ==="stop"){
		stop();
		res.json({'success':'stop'});
	}
	else if (req.params.move !== undefined ) {
		jog_direction(req.params.move);
		res.json({'success': 'Moving in '+req.params.move+' direction'});
	}
	else {
		stop();
		res.json({'error':'Need at least one argument'});
	}
};

fixed_move = function(req, res, next) {
	if(req.params.move ==="stop"){
		stop();
		res.json({'success':'stop'});
	}
	else if (req.params.move !== undefined && req.params.step !== undefined) {
		fixed_move_direction(req.params.move, req.params.step);
		res.json({'success': 'Moving in '+req.params.move+' direction'});
	}
	else {
		stop();
		res.json({'error':'Need at least one argument'});
	}
};


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
    			res.json({'success': gcode_string});
		}
		else
		{
			res.json({'error':'Need at least one argument'});
		}
	}
	else
	{
		res.json({'error':'A file is running'});
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
