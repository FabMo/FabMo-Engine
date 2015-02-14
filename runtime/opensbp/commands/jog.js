var log = require('../../../log').logger('sbp');
var g2 = require('../../../g2');
var sb3_commands = require('../sb3_commands');
var config = require('../../../config');


// Jog (rapid) the X axis
exports.JX = function(args) {
	var x = args[0];
	if(isNaN(x)) { throw "Invalid JX argument: " + x; }
	this.emit_gcode("G0X" + x);
	this.cmd_posx = x;
};

// Jog (rapid) the Y axis
exports.JY = function(args) {
	var y = args[0];
	if(isNaN(y)) { throw "Invalid JY argument: " + y; }
	this.emit_gcode("G0Y" + y);
	this.cmd_posy = y;
};

// Jog (rapid) the Z axis
exports.JZ = function(args) {
	var z = args[0];
	if(isNaN(z)) { throw "Invalid JZ argument: " + z; }
	this.emit_gcode("G0Z" + z);
	this.cmd_posz = z;
};

// Jog (rapid) the A axis
exports.JA = function(args) {
	var a = args[0];
	if(isNaN(a)) { throw "Invalid JA argument: " + a; }
	this.emit_gcode("G0A" + a);
	this.cmd_posa = a;
};

// Jog (rapid) the B axis
exports.JB = function(args) {
	var b = args[0];
	if(isNaN(b)) { throw "Invalid JB argument: " + b; }
	this.emit_gcode("G0B" + b);
	this.cmd_posb = b;
};

// Jog (rapid) the C axis
exports.JC = function(args) {
	var c = args[0];
	if(isNaN(c)) { throw "Invalid JC argument: " + c; }
	this.emit_gcode("G0C" + c);
	this.cmd_posc = c;
};

// Jog (rapid) 2 axes (XY). This is a modal command, any axis location that is left out
//   of the command will default to it's current position and not move
exports.J2 = function(args) {
	var outStr = "G0";
	if (args[0] !== undefined) {
		var x = args[0];
		if(isNaN(x)) { throw "Invalid JX argument: " + x; }
		outStr = outStr + "X" + x;
		this.cmd_posx = x;
	}
	if (args[1] !== undefined) {
		var y = args[1];
		if(isNaN(y)) { throw "Invalid JY argument: " + y; }
		outStr = outStr + "Y" + y;
		this.cmd_posy = y;
	}
	this.emit_gcode(outStr);
};

// Jog (rapid) 3 axes (XYZ). This is a modal command, any axis location that is left out
//   of the command will default to it's current position and not move
exports.J3 = function(args) {
	var outStr = "G0";
	if (args[0] !== undefined) {
		var x = args[0];
		if(isNaN(x)) { throw "Invalid JX argument: " + x; }
		outStr = outStr + "X" + x;
		this.cmd_posx = x;
	}
	if (args[1] !== undefined) {
		var y = args[1];
		if(isNaN(y)) { throw "Invalid JY argument: " + y; }
		outStr = outStr + "Y" + y;
		this.cmd_posy = y;
	}
	if (args[2] !== undefined) {
		var z = args[2];
		if(isNaN(z)) { throw "Invalid JZ argument: " + z; }
		outStr = outStr + "Z" + z;
		this.cmd_posz = z;
	}
	this.emit_gcode(outStr);
};

// Jog (rapid) 4 axes (XYZA). This is a modal command, any axis location that is left out
//   of the command will default to it's current position and not move
exports.J4 = function(args) {
	var outStr = "G0";
	if (args[0] !== undefined) {
		var x = args[0];
		if(isNaN(x)) { throw "Invalid JX argument: " + x; }
		outStr = outStr + "X" + x;
		this.cmd_posx = x;
	}
	if (args[1] !== undefined) {
		var y = args[1];
		if(isNaN(1)) { throw "Invalid JY argument: " + y; }
		outStr = outStr + "Y" + y;
		this.cmd_posy = y;
	}
	if (args[2] !== undefined) {
		var z = args[2];
		if(isNaN(z)) { throw "Invalid JZ argument: " + z; }
		outStr = outStr + "Z" + z;
		this.cmd_posz = z;
	}
	if (args[3] !== undefined) {
		var a = args[3];
		if(isNaN(a)) { throw "Invalid JA argument: " + a; }
		outStr = outStr + "A" + a;
		this.cmd_posa = a;
	}
	this.emit_gcode(outStr);
};

// Jog (rapid) 5 axes (XYZAB). This is a modal command, any axis location that is left out
//   of the command will default to it's current position and not move
exports.J5 = function(args) {
	var outStr = "G0";
	if (args[0] !== undefined) {
		var x = args[0];
		if(isNaN(x)) { throw "Invalid JX argument: " + x; }
		outStr = outStr + "X" + x;
		this.cmd_posx = x;
	}
	if (args[1] !== undefined) {
		var y = args[1];
		if(isNaN(y)) { throw "Invalid JY argument: " + y; }
		outStr = outStr + "Y" + y;
		this.cmd_posy = y;
	}
	if (args[2] !== undefined) {
		var z = args[2];
		if(isNaN(z)) { throw "Invalid JZ argument: " + z; }
		outStr = outStr + "Z" + z;
		this.cmd_posz = z;
	}
	if (args[3] !== undefined) {
		var a = args[3];
		if(isNaN(a)) { throw "Invalid JA argument: " + a; }
		outStr = outStr + "A" + a;
		this.cmd_posa = a;
	}
	if (args[4] !== undefined) {
		var b = args[4];
		if(isNaN(b)) { throw "Invalid JB argument: " + b; }
		outStr = outStr + "B" + b;
		this.cmd_posb = b;
	}
	this.emit_gcode(outStr);
};

// Jog (rapid) 6 axes (XYZABC). This is a modal command, any axis location that is left out
//   of the command will default to it's current position and not move
exports.J6 = function(args) {
	var outStr = "G0";
	if (args[0] !== undefined) {
		var x = args[0];
		if(isNaN(x)) { throw "Invalid JX argument: " + x; }
		outStr = outStr + "X" + x;
		this.cmd_posx = x;
	}
	if (args[1] !== undefined) {
		var y = args[1];
		if(isNaN(y)) { throw "Invalid JY argument: " + y; }
		outStr = outStr + "Y" + y;
		this.cmd_posy = y;
	}
	if (args[2] !== undefined) {
		var z = args[2];
		if(isNaN(z)) { throw "Invalid JZ argument: " + z; }
		outStr = outStr + "Z" + z;
		this.cmd_posz = z;
	}
	if (args[3] !== undefined) {
		var a = args[3];
		if(isNaN(a)) { throw "Invalid JA argument: " + a; }
		outStr = outStr + "A" + a;
		this.cmd_posa = a;
	}
	if (args[4] !== undefined) {
		var b = args[4];
		if(isNaN(b)) { throw "Invalid JB argument: " + b; }
		outStr = outStr + "B" + b;
		this.cmd_posb = b;
	}
	if (args[5] !== undefined) {
		var c = args[5];
		if(isNaN(c)) { throw "Invalid JC argument: " + c; }
		outStr = outStr + "C" + c;
		this.cmd_posc = c;
	}
	this.emit_gcode(outStr);
};

// Jog (rapid) XY to the Home position (0,0) 
exports.JH = function(args) {
	this.cmd_posx = 0;
	this.cmd_posy = 0;
	this.emit_gcode("G0X0Y0");
};

// Set the Jog (Rapid) speed for any of the 6 axes
exports.JS = function(args, callback) {

	log.debug( "JS - args = " + args );

	var speed_change = 0.0;
	var g2_values = {};
	var sbp_values = {};

	if (args[0] !== undefined) {
		speed_change = args[0];
		if(isNaN(speed_change)) { throw "Invalid JS-XY argument: " + speed_change; }
		g2_values.xvm = g2_values.yvm = (60 * speed_change);
		sbp_values.jogxy_speed = speed_change;
	}
	if (args[1] !== undefined) {
		speed_change = args[1];
		if(isNaN(speed_change)) { throw "Invalid JS-Z argument: " + speed_change; }
		g2_values.zvm = (60 * speed_change);
		sbp_values.jogz_speed = speed_change;
	}
	if (args[2] !== undefined) {
		speed_change = args[2];
		if(isNaN(speed_change)) { throw "Invalid JS-A argument: " + speed_change; }
		g2_values.avm = (60 * speed_change);
		sbp_values.joga_speed = speed_change;
	}
	if (args[3] !== undefined) {
		speed_change = args[3];
		if(isNaN(speed_change)) { throw "Invalid JS-B argument: " + speed_change; }
		g2_values.bvm = (60 * speed_change);
		sbp_values.jogb_speed = speed_change;
	}
	if (args[4] !== undefined) {
		speed_change = args[4];
		if(isNaN(speed_change)) { throw "Invalid JS-C argument: " + speed_change; }
		g2_values.cvm = (60 * speed_change);
		sbp_values.jogc_speed = speed_change;
	}

	log.debug( "JS-g2_values = " + JSON.stringify(g2_values) );
	log.debug( "JS-sbp_values = " + JSON.stringify(sbp_values) );

	// We have created the objects containing both the values to set on the G2 driver as well as for shopbot
	// Now send them to their appropriate places (shopbot first, followed by G2)
	config.opensbp.setMany(sbp_values, function(err, values) {
		log.debug("SBP getMany values = " + JSON.stringify(values));
		config.driver.setMany(g2_values, function(err, values) {
			log.debug("g2 getMany values = " + JSON.stringify(values));
			callback();
		});
	});

};
