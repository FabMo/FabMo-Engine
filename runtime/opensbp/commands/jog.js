var log = require('../../../log').logger('sbp');
var g2 = require('../../../g2');
var sb3_commands = require('../sb3_commands');
var config = require('../../../config');


// Jog (rapid) the X axis
exports.JX = function(args) {
	this.emit_gcode("G0X" + args[0]);
	this.cmd_posx = args[0];
};

// Jog (rapid) the Y axis
exports.JY = function(args) {
	this.emit_gcode("G0Y" + args[0]);
	this.cmd_posy = args[0];
};

// Jog (rapid) the Z axis
exports.JZ = function(args) {
	this.emit_gcode("G0Z" + args[0]);
	this.cmd_posz = args[0];
};

// Jog (rapid) the A axis
exports.JA = function(args) {
	this.emit_gcode("G0A" + args[0]);
	this.cmd_posa = args[0];
};

// Jog (rapid) the B axis
exports.JB = function(args) {
	this.emit_gcode("G0B" + args[0]);
	this.cmd_posb = args[0];
};

// Jog (rapid) the C axis
exports.JC = function(args) {
	this.emit_gcode("G0C" + args[0]);
	this.cmd_posc = args[0];
};

// Jog (rapid) 2 axes (XY). This is a modal command, any axis location that is left out
//   of the command will default to it's current position and not move
exports.J2 = function(args) {
	var outStr = "G0";
	if (args[0] !== undefined) {
		outStr = outStr + "X" + args[0];
		this.cmd_posx = args[0];
	}
	if (args[1] !== undefined) {
		outStr = outStr + "Y" + args[1];
		this.cmd_posy = args[1];
	}
	this.emit_gcode(outStr);
};

// Jog (rapid) 3 axes (XYZ). This is a modal command, any axis location that is left out
//   of the command will default to it's current position and not move
exports.J3 = function(args) {
	var outStr = "G0";
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
	this.emit_gcode(outStr);
};

// Jog (rapid) 4 axes (XYZA). This is a modal command, any axis location that is left out
//   of the command will default to it's current position and not move
exports.J4 = function(args) {
	var outStr = "G0";
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
	this.emit_gcode(outStr);
};

// Jog (rapid) 5 axes (XYZAB). This is a modal command, any axis location that is left out
//   of the command will default to it's current position and not move
exports.J5 = function(args) {
	var outStr = "G0";
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
	this.emit_gcode(outStr);
};

// Jog (rapid) 6 axes (XYZABC). This is a modal command, any axis location that is left out
//   of the command will default to it's current position and not move
exports.J6 = function(args) {
	var outStr = "G0";
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

	console.log( "JS - args = " + args );
//	console.log(callback);

	var speed_change = 0.0;
	var g2_values = {};
	var sbp_values = {};

	if (args[0] !== undefined) {
		speed_change = args[0];
		g2_values.xvm = g2_values.yvm = (60 * speed_change);
		sbp_values.jogxy_speed = speed_change;
	}
	if (args[1] !== undefined) {
		speed_change = args[1];
		if ( speed_change !== undefined ){
			g2_values.zvm = (60 * speed_change);
			sbp_values.jogz_speed = speed_change;
		}
	}
	if (args[2] !== undefined) {
		speed_change = args[2];
		if ( speed_change !== undefined ){
			g2_values.avm = (60 * speed_change);
			sbp_values.joga_speed = speed_change;
		}
	}
	if (args[3] !== undefined) {
		speed_change = args[3];
		if ( speed_change !== undefined ){
			g2_values.bvm = (60 * speed_change);
			sbp_values.jogb_speed = speed_change;
		}
	}
	if (args[4] !== undefined) {
		speed_change = args[4];
		if ( speed_change !== undefined ){
			g2_values.cvm = (60 * speed_change);
			sbp_values.jogc_speed = speed_change;
		}
	}

	console.log( "JS-g2_values = " + JSON.stringify(g2_values) );
	console.log( "JS-sbp_values = " + JSON.stringify(sbp_values) );

	// We have created the objects containing both the values to set on the G2 driver as well as for shopbot
	// Now send them to their appropriate places (shopbot first, followed by G2)
//	config.opensbp.setMany(sbp_values, function(err, values) {
//		config.driver.setMany(g2_values, function(err, values) {
//			callback();
//		});
//	});

};
