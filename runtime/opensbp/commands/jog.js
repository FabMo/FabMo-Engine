var log = require('../../../log').logger('sbp');
var g2 = require('../../../g2');
var sb3_commands = require('../sb3_commands');
var config = require('../../../config');


// Jog (rapid) the X axis
exports.JX = function(args) {
	var x = args[0];
	if(isNaN(x)) { throw( "Invalid JX argument: " + x ); }
	this.cmd_posx = x;
	this.emit_move('G0',{"X":x});

};

// Jog (rapid) the Y axis
exports.JY = function(args) {
	var y = args[0];
	if(isNaN(y)) { throw( "Invalid JY argument: " + y ); }
	this.cmd_posy = y;
	this.emit_move('G0',{"Y":y});

};

// Jog (rapid) the Z axis
exports.JZ = function(args) {
	var z = args[0];
	if(isNaN(z)) { throw( "Invalid JZ argument: " + z ); }
	this.cmd_posz = z;
	this.emit_move('G0',{"Z":z});

};

// Jog (rapid) the A axis
exports.JA = function(args) {
	var a = args[0];
	if(isNaN(a)) { throw( "Invalid JA argument: " + a ); }
	this.cmd_posa = a;
	this.emit_move('G0',{"A":a});

};

// Jog (rapid) the B axis
exports.JB = function(args) {
	var b = args[0];
	if(isNaN(b)) { throw( "Invalid JB argument: " + b ); }
	this.cmd_posb = b;
	this.emit_move('G0',{"B":b});

};

// Jog (rapid) the C axis
exports.JC = function(args) {
	var c = args[0];
	if(isNaN(c)) { throw( "Invalid JC argument: " + c ); }
	this.cmd_posc = c;
	this.emit_move('G0',{"C":c});

};

// Jog (rapid) 2 axes (XY).This is a modal command, any axis location that is left out
//   of the command will default to it's current position and not move
exports.J2 = function(args) {
    var params = process_move.bind(this)(args);
	this.emit_move('G0',params);
};

// Jog (rapid) 3 axes (XYZ). This is a modal command, any axis location that is left out
//   of the command will default to it's current position and not move
exports.J3 = function(args) {
    var params = process_move.bind(this)(args);
	this.emit_move('G0',params);
};

// Jog (rapid) 4 axes (XYZA). This is a modal command, any axis location that is left out
//   of the command will default to it's current position and not move
exports.J4 = function(args) {
    var params = process_move.bind(this)(args);
	this.emit_move('G0',params);
};

// Jog (rapid) 5 axes (XYZAB). This is a modal command, any axis location that is left out
//   of the command will default to it's current position and not move
exports.J5 = function(args) {
    var params = process_move.bind(this)(args);
	this.emit_move('G0',params);
};

// Jog (rapid) 6 axes (XYZABC). This is a modal command, any axis location that is left out
//   of the command will default to it's current position and not move
exports.J6 = function(args) {
    var params = process_move.bind(this)(args);
	this.emit_move('G0',params);
};

process_jog = function(args) {
//    log.debug(" process_move: " + JSON.stringify(args));
	var params = {};

	if(args[0] && typeof args[0] === "number"){ 
	  log.debug("   x = " + args[0]); this.cmd_posx = params.X = args[0];
	}
	if(args[1] && typeof args[1] === "number"){ 
	  log.debug("   y = " + args[1]); this.cmd_posy = params.Y = args[1];
	}  
	if(args[2] && typeof args[2] === "number"){ 
	  log.debug("   z = " + args[2]); this.cmd_posz = params.Z = args[2];
	}  
	if(args[3] && typeof args[3] === "number"){ 
	  log.debug("   a = " + args[3]); this.cmd_posa = params.A = args[3];
	}
	if(args[4] && typeof args[4] === "number"){ 
	  log.debug("   b = " + args[4]); this.cmd_posb = params.B = args[4];
	}  
	if(args[5] && typeof args[5] === "number"){ 
	  log.debug("   c = " + args[5]); this.cmd_posc = params.C = args[5];
	}  
	params.F = (60.0 * config.opensbp.get('movexy_speed'));
	return params;
};

// Jog (rapid) XY to the Home position (0,0) 
exports.JH = function(args) {
	var x = 0;
	var y = 0;
	this.cmd_posx = 0;
	this.cmd_posy = 0;
	this.emit_move('G0',{"X":x,"Y":y});
};

// Set the Jog (Rapid) speed for any of the 6 axes
exports.JS = function(args, callback) {
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
	// We have created the objects containing both the values to set on the G2 driver as well as for shopbot
	// Now send them to their appropriate places (shopbot first, followed by G2)
	config.opensbp.setMany(sbp_values, function(err, values) {
//		log.debug("SBP getMany values = " + JSON.stringify(values));
		config.driver.setMany(g2_values, function(err, values) {
//			log.debug("g2 getMany values = " + JSON.stringify(values));
			callback();
		});
	});

};
