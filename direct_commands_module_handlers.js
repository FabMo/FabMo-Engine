var machine = require('./machine');
var default_feed_rate = 300;

exports.send_gcode = function(req, res, next) {
	if (machine.driver.status.state === 'idle')
	{
		
    		res.json({'error':'Not implemented yet.'});	
	}
	else
	{
		res.json({'error':'file keep running.'});	
	}
};


exports.move = function(req, res, next) {
    	if (machine.driver.status.state === 'idle')
	{
		
    		res.json({'error':'Not implemented yet.'});	
	}
	else
	{
		res.json({'error':'file keep running.'});	
	}
};

exports.jog = function(req, res, next) {
    	if (machine.driver.status.state === 'idle')
	{
		
    		res.json({'error':'Not implemented yet.'});	
	}
	else
	{
		res.json({'error':'file keep running.'});	
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
				gcode_string +='F'+default_feed_rate;

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
		res.json({'error':'file keep running.'});	
	}
};

