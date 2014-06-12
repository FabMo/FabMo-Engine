var machine = require('./machine');
var default_feed_rate = 300;
var default_move_step = 0.1;
var default_jog_step = 0.2;
var move_x_loop = undefined;
var move_y_loop = undefined;
var move_z_loop = undefined;
var jog_x_loop = undefined;
var jog_y_loop = undefined;
var jog_z_loop = undefined;
//need to improve that in the future (in a proper way)
function move_direction(direction)
{
	if (direction==='x')
	{
	machine.driver.gcode('G91');
	move_x_loop = setInterval(function () {
			machine.driver.gcode('G01 X'+ default_move_step +' F'+default_feed_rate);
		},  default_move_step*default_feed_rate);
	}
	if (direction==='-x')
	{
	machine.driver.gcode('G91');
	move_x_loop = setInterval(function () {
			machine.driver.gcode('G01 X-'+ default_move_step +' F'+default_feed_rate);
		},  default_move_step*default_feed_rate);
	}
	if (direction==='y')
	{
	machine.driver.gcode('G91');
	move_y_loop = setInterval(function () {
			machine.driver.gcode('G01 Y'+ default_move_step +' F'+default_feed_rate);
		},  default_move_step*default_feed_rate);
	}
	if (direction==='-y')
	{
	machine.driver.gcode('G91');
	move_y_loop = setInterval(function () {
			machine.driver.gcode('G01 Y-'+ default_move_step +' F'+default_feed_rate);
		},  default_move_step*default_feed_rate);
	}
	if (direction==='z')
	{
	machine.driver.gcode('G91');
	move_z_loop = setInterval(function () {
			machine.driver.gcode('G01 Z'+ default_move_step +' F'+default_feed_rate);
		},  default_move_step*default_feed_rate);
	}
	if (direction==='-z')
	{
	machine.driver.gcode('G91');
	move_z_loop = setInterval(function () {
			machine.driver.gcode('G01 Z-'+ default_move_step +' F'+default_feed_rate);
		},  default_move_step*default_feed_rate);
	}
}

function jog_direction(direction)
{
	if (direction==='x')
	{
	machine.driver.gcode('G91');
	move_x_loop = setInterval(function () {
			machine.driver.gcode('G01 X'+ default_jog_step +' F'+2*default_feed_rate);
		},  default_jog_step*2*default_feed_rate);
	}
	if (direction==='-x')
	{
	machine.driver.gcode('G91');
	move_x_loop = setInterval(function () {
			machine.driver.gcode('G01 X-'+ default_jog_step +' F'+2*default_feed_rate);
		},  default_jog_step*2*default_feed_rate);
	}
	if (direction==='y')
	{
	machine.driver.gcode('G91');
	move_y_loop = setInterval(function () {
			machine.driver.gcode('G01 Y'+ default_jog_step +' F'+2*default_feed_rate);
		},  default_jog_step*2*default_feed_rate);
	}
	if (direction==='-y')
	{
	machine.driver.gcode('G91');
	move_y_loop = setInterval(function () {
			machine.driver.gcode('G01 Y-'+ default_jog_step +' F'+2*default_feed_rate);
		},  default_jog_step*2*default_feed_rate);
	}
	if (direction==='z')
	{
	machine.driver.gcode('G91');
	move_z_loop = setInterval(function () {
			machine.driver.gcode('G01 Z'+ default_jog_step +' F'+2*default_feed_rate);
		},  default_jog_step*2*default_feed_rate);
	}
	if (direction==='-z')
	{
	machine.driver.gcode('G91');
	move_z_loop = setInterval(function () {
			machine.driver.gcode('G01 Z-'+ default_jog_step +' F'+2*default_feed_rate);
		},  default_jog_step*2*default_feed_rate);
	}
}

function stop()
{
	clearInterval(move_x_loop);
	clearInterval(move_y_loop);
	clearInterval(move_z_loop);
	clearInterval(jog_x_loop);
	clearInterval(jog_y_loop);
	clearInterval(jog_z_loop);
	machine.driver.gcode('G90');
}


exports.send_gcode = function(req, res, next) {
	console.log('Sending gcode');
	console.log(req.headers);
	console.log(req.body);	
	if (machine.driver.status.state === 'idle')
	{
		if (req.params.cmd !== undefined )
		{
			machine.driver.runString(req.params.cmd);
    			res.json({'success': req.params.cmd})
		}
		else if (req.body) {
			machine.driver.runString(req.body);
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
    	if (machine.driver.status.state === 'idle')
	{
		if (req.params.move !== undefined )
		{
			stop();
			move_direction(req.params.move);			
			res.json({'success': 'moving in '+req.params.move+' direction'});
		}
		else
		{
			res.json({'error':'need at least one argument'});	
		}
    				
	}
	else
	{
		if (req.params.move !== undefined )
		{
			if (req.params.move === 'stop')
			{
					stop();
					res.json({'success': 'stop'});
			}
		}
		else
			res.json({'error':'a file keeps running.'});	
	}
};

exports.jog = function(req, res, next) {
    	if (machine.driver.status.state === 'idle')
	{
		if (req.params.move !== undefined )
		{
			stop();
			jog_direction(req.params.move);			
			res.json({'success': 'moving in '+req.params.move+' direction'});
		}
		else
		{
			res.json({'error':'need at least one argument'});	
		}
    				
	}
	else
	{
		if (req.params.move !== undefined )
		{
			if (req.params.move === 'stop')
			{
					stop();
					res.json({'success': 'stop'});
			}
		}
		else
			res.json({'error':'a file keeps running.'});	
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

