var machine = require('./machine');
var default_feed_rate = 300;
var default_move_step = 0.1;
var default_jog_step = 0.2;

function move_direction(direction)
{
	machine.driver.jog(direction);
}

function jog_direction(direction)
{
	machine.driver.jog(direction);
}

function stop()
{
	machine.driver.jog(null);
}


exports.send_gcode = function(req, res, next) {
	if (machine.driver.status.state === 'idle')
	{
		if (req.params.cmd !== undefined )
		{
			machine.driver.runString(req.params.cmd);
    		res.json({'success': req.params.cmd})
		}
		else if (req.body) {
			machine.driver.runString(req.body);
			res.json({'success': req.params.cmd})

		}
		else
		{
			res.json({'error':'no cmd argument.'});	
		}
	}
	else
	{
		res.json({'error':'a file keeps running.'});	
	}
};


exports.move = function(req, res, next) {
	if (req.params.move !== undefined )
	{
		move_direction(req.params.move);			
		res.json({'success': 'moving in '+req.params.move+' direction'});
	}
	else
	{
		stop();
		res.json({'error':'need at least one argument'});	
	}
};

exports.jog = function(req, res, next) {
	if (req.params.move !== undefined )
	{
		jog_direction(req.params.move);
		res.json({'success': 'moving in '+req.params.move+' direction'});
	}
	else
	{
		stop();
		res.json({'error':'need at least one argument'});	
	}
};

exports.goto = function(req, res, next) {
   	if (machine.driver.status.state === 'idle')
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
				gcode_string += ' A'+ req.params.x;
			if (req.params.b !== undefined )
				gcode_string += ' B'+ req.params.y;
		 	if (req.params.c !== undefined )
				gcode_string += ' C'+ req.params.z;			
			if (req.params.f !== undefined )
				gcode_string += ' F'+ req.params.f;
			else 
				gcode_string +=' F'+default_feed_rate;

			machine.driver.gcode(gcode_string);
    			res.json({'success': gcode_string})
		}
		else
		{
			res.json({'error':'need at least one argument'});	
		}
	}
	else
	{
		res.json({'error':'a file keeps running.'});	
	}
};

