var log = require('../../../log').logger('sbp');
var g2 = require('../../../g2');
var sb3_commands = require('../sb3_commands');
var config = require('../../../config');

// Move X axis
exports.MX = function(args) {
	x = args[0]
	if(isNaN(x)) { throw "Invalid MX argument: " + x}
	this.emit_gcode("G1X" + x + " F" + ( 60.0 * config.opensbp.get('movexy_speed')));
	this.cmd_posx = x;
};

// Move Y axis
exports.MY = function(args) {
	this.emit_gcode("G1Y" + args[0] + " F" + ( 60.0 * config.opensbp.get('movexy_speed')));
	this.cmd_posy = args[0];
};

// Move Z axis
exports.MZ = function(args) {
	this.emit_gcode("G1Z" + args[0] + " F" + ( 60.0 * config.opensbp.get('movez_speed')));
	this.cmd_posz = args[0];
};

// Move A axis
exports.MA = function(args) {
	this.emit_gcode("G1A" + args[0] + " F" + ( 60.0 * config.opensbp.get('movea_speed')));
	this.cmd_posa = args[0];
};

// Move B axis
exports.MB = function(args) {
	this.emit_gcode("G1B" + args[0] + " F" + ( 60.0 * config.opensbp.get('moveb_speed')));
	this.cmd_posb = args[0];
};

// Move C axis
exports.MC = function(args) {
	this.emit_gcode("G1C" + args[0] + " F" + ( 60.0 * config.opensbp.get('movec_speed')));
	this.cmd_posc = args[0];
};

// Move 2 axes (XY). This is a modal command, any axis location that is left out
//   of the command will default to it's current position and not move
exports.M2 = function(args) {
	var outStr = "G1";
	if (args[0] !== undefined) {
		outStr = outStr + "X" + args[0];
		this.cmd_posx = args[0];
	}
	if (args[1] !== undefined) {
		outStr = outStr + "Y" + args[1];
		this.cmd_posy = args[1];
	}
	outStr = outStr + "F" + ( 60.0 * config.opensbp.get('movexy_speed')); 
	this.emit_gcode(outStr);
};

// Move 3 axes (XYZ). This is a modal command, any axis location that is left out
//   of the command will default to it's current position and not move
exports.M3 = function(args) {
	var outStr = "G1";
	if (args[0] !== undefined) {
		outStr = outStr + "X" + args[0];
		this.cmd_posx = args[0];
	}
	if (args[1] !== undefined) {
		outStr = outStr + "Y" + args[1];
		this.cmd_posy = args[1];
	}
	if (args[2] !== undefined) {
		outStr = outStr + "Z" + args[2];
		this.cmd_posz = args[2];
	}
	outStr = outStr + "F" + ( 60.0 * config.opensbp.get('movexy_speed')); 
	this.emit_gcode(outStr);
};

// Move 4 axes (XYZA). This is a modal command, any axis location that is left out
//   of the command will default to it's current position and not move
exports.M4 = function(args) {
	var outStr = "G1";
	if (args[0] !== undefined) {
		outStr = outStr + "X" + args[0];
		this.cmd_posx = args[0];
	}
	if (args[1] !== undefined) {
		outStr = outStr + "Y" + args[1];
		this.cmd_posy = args[1];
	}
	if (args[2] !== undefined) {
		outStr = outStr + "Z" + args[2];
		this.cmd_posz = args[2];
	}
	if (args[3] !== undefined) {
		outStr = outStr + "A" + args[3];
		this.cmd_posa = args[3];
	}
	outStr = outStr + "F" + ( 60.0 * config.opensbp.get('movexy_speed')); 
	this.emit_gcode(outStr);
};

// Move 5 axes (XYZAB). This is a modal command, any axis location that is left out
//   of the command will default to it's current position and not move
exports.M5 = function(args) {
	var outStr = "G1";
	if (args[0] !== undefined) {
		outStr = outStr + "X" + args[0];
		this.cmd_posx = args[0];
	}
	if (args[1] !== undefined) {
		outStr = outStr + "Y" + args[1];
		this.cmd_posy = args[1];
	}
	if (args[2] !== undefined) {
		outStr = outStr + "Z" + args[2];
		this.cmd_posz = args[2];
	}
	if (args[3] !== undefined) {
		outStr = outStr + "A" + args[3];
		this.cmd_posa = args[3];
	}
	if (args[4] !== undefined) {
		outStr = outStr + "B" + args[4];
		this.cmd_posb = args[4];
	}
	outStr = outStr + "F" + ( 60.0 * config.opensbp.get('movexy_speed')); 
	this.emit_gcode(outStr);
};

// Move all 6 axes (XYZABC). This is a modal command, any axis location that is left out
//   of the command will default to it's current position and not move
exports.M6 = function(args) {
	var outStr = "G1";
	if (args[0] !== undefined) {
		outStr = outStr + "X" + args[0];
		this.cmd_posx = args[0];
	}	
	if (args[1] !== undefined) {
		outStr = outStr + "Y" + args[1];
		this.cmd_posy = args[1];
	}
	if (args[2] !== undefined) {
		outStr = outStr + "Z" + args[2];
		this.cmd_posz = args[2];
	}
	if (args[3] !== undefined) {
		outStr = outStr + "A" + args[3];
		this.cmd_posa = args[3];
	}
	if (args[4] !== undefined) {
		outStr = outStr + "B" + args[4];
		this.cmd_posb = args[4];
	}
	if (args[5] !== undefined) {
		outStr = outStr + "C" + args[5];
		this.cmd_posc = args[5];
	}
	outStr = outStr + "F" + ( 60 * config.opensbp.get('movexy_speed')); 
	this.emit_gcode(outStr);
};

// Move to the XY home position (0,0)
exports.MH = function(args) {
	this.emit_gcode("G1X0Y0F" + ( 60 * config.opensbp.get('movexy_speed')));
	this.cmd_posx = 0;
	this.cmd_posy = 0;
};

// Set the move speeds for Axes XYZABC
exports.MS = function(args) {
	var speed_change = 0.0;
	var xSpd, ySpd, zSpd, aSpd, bSpd, cSpd;

	if (args[0] !== undefined) {
		speed_change = args[0];
		xSpd = 60 * speed_change;
		ySpd = 60 * speed_change;
		config.opensbp.set('movexy_speed', speed_change);
	}
	if (args[1] !== undefined) {
		speed_change = args[1];
		zSpd = 60 * speed_change;
		config.opensbp.set('movez_speed', speed_change);
	}
	if (args[2] !== undefined) {
		speed_change = args[2];
		aSpd = 60 * speed_change;
		config.opensbp.set('movea_speed', speed_change);
	}
	if (args[3] !== undefined) {
		speed_change = args[3];
		bSpd = 60 * speed_change;
		config.opensbp.set('moveb_speed', speed_change);
	}
	if (args[4] !== undefined) {
		speed_change = args[4];
		cSpd = 60 * speed_change;
		config.opensbp.set('movec_speed', speed_change);
	}

	var MSstr = { 'xfr':xSpd,
				  'yfr':ySpd,
				  'zfr':zSpd,
				  'afr':aSpd,
				  'bfr':bSpd,
				  'cfr':cSpd  };

	config.driver.setMany(MSstr, function(err, values) {
		console.log("set:values = " + values );
		callback();
	});
};

exports.MI = function(args) {
	//?????????????????????????????????????????????
};

exports.MO = function(args) {
	//?????????????????????????????????????????????
};
