var log = require('../../../log').logger('sbp');
var g2 = require('../../../g2');
var sb3_commands = require('../sb3_commands');
var config = require('../../../config');

// Bender-FEED command (with adjustment from bending)
exports.BF = function(args) {
	var y = args[0];
	var adj = config.opensbp.get('cutterDia');       // retrieve correction for adjusting loss from prev bend, example vc at moment

	log.debug( " BH args: " + JSON.stringify(args));
	if(isNaN(y)) { throw( "Invalid BH argument: " + y ); }
	feedrate = (60.0 * config.opensbp.get('movexy_speed'));
//	this.cmd_posy = y;
	y = y + adj;
	this.emit_move('G1',{"Y":y,'F':feedrate});

};

// Move X axis
exports.MX = function(args) {
	var x = args[0];

	log.debug( " MX args: " + JSON.stringify(args));
	if(isNaN(x)) { throw( "Invalid MX argument: " + x ); }
	feedrate = (60.0 * config.opensbp.get('movexy_speed'));
//	this.cmd_posx = x;
	this.emit_move('G1',{"X":x,'F':feedrate});

};

// Move Y axis
exports.MY = function(args) {
	var y = args[0];

	log.debug( " MX args: " + JSON.stringify(args));
	if(isNaN(y)) { throw( "Invalid MY argument: " + y ); }
	feedrate = (60.0 * config.opensbp.get('movexy_speed'));
//	this.cmd_posy = y;
	this.emit_move('G1',{"Y":y,'F':feedrate});

};

// Move Z axis
exports.MZ = function(args) {
	var z = args[0];

	log.debug( " MZ args: " + JSON.stringify(args));
	if(isNaN(z)) { throw( "Invalid MZ argument: " + z ); }
	feedrate = (60.0 * config.opensbp.get('movez_speed'));
//	this.cmd_posz = z;
	this.emit_move('G1',{"Z":z,'F':feedrate});

};

// Move A axis
exports.MA = function(args) {
	var a = args[0];

	log.debug( " MA args: " + JSON.stringify(args));
	if(isNaN(a)) { throw( "Invalid MA argument: " + a ); }
	feedrate = (60.0 * config.opensbp.get('movea_speed'));
//	this.cmd_posa = a;
	this.emit_move('G1',{"A":a,'F':feedrate});

};

// Move B axis
exports.MB = function(args) {
	var b = args[0];

	log.debug( " MB args: " + JSON.stringify(args));
	if(isNaN(b)) { throw( "Invalid MB argument: " + b ); }
	feedrate = (60.0 * config.opensbp.get('moveb_speed'));
//	this.cmd_posb = b;
	this.emit_move('G1',{"B":b,'F':feedrate});

};

// Move C axis
exports.MC = function(args) {
	var c = args[0];

	log.debug( " MC args: " + JSON.stringify(args));
	if(isNaN(c)) { throw( "Invalid MC argument: " + c ); }
	feedrate = (60.0 * config.opensbp.get('movec_speed'));
//	this.cmd_posc = c;
	this.emit_move('G1',{"C":c,'F':feedrate});

};

// Move 2 axes (XY). This is a modal command, any axis location that is left out
//   of the command will default to it's current position and not move
exports.M2 = function(args) {
    var params = process_move.bind(this)(args);
	this.emit_move('G1',params);
};

// Move 3 axes (XYZ). This is a modal command, any axis location that is left out
//   of the command will default to it's current position and not move
exports.M3 = function(args) {
    var params = process_move.bind(this)(args);
	this.emit_move('G1',params);
};

// Move 4 axes (XYZA). This is a modal command, any axis location that is left out
//   of the command will default to it's current position and not move
exports.M4 = function(args) {
    var params = process_move.bind(this)(args);
	this.emit_move('G1',params);
};

// Move 5 axes (XYZAB). This is a modal command, any axis location that is left out
//   of the command will default to it's current position and not move
exports.M5 = function(args) {
    var params = process_move.bind(this)(args);
	this.emit_move('G1',params);
};

// Move all 6 axes (XYZABC). This is a modal command, any axis location that is left out
//   of the command will default to it's current position and not move
exports.M6 = function(args) {
    var params = process_move.bind(this)(args);
	this.emit_move('G1',params);
};

process_move = function(args) {
    log.debug(" process_move: " + JSON.stringify(args));
	var params = {};

	feedrate = (60.0 * config.opensbp.get('movexy_speed'));
	if(args[0] === 0 || args[0] && typeof args[0] === "number"){
		params.X = args[0];
	}
	if(args[1] === 0 || args[1] && typeof args[1] === "number"){ 
		params.Y = args[1];
	}  
	if(args[1] === 0 || args[2] && typeof args[2] === "number"){ 
		params.Z = args[2];
	}  
	if(args[1] === 0 || args[3] && typeof args[3] === "number"){ 
		params.A = args[3];
	}
	if(args[1] === 0 || args[4] && typeof args[4] === "number"){ 
		params.B = args[4];
	}  
	if(args[1] === 0 || args[5] && typeof args[5] === "number"){ 
		params.C = args[5];
	}  
	params.F = (60.0 * config.opensbp.get('movexy_speed'));

	return params;
};

// Move to the XY home position (0,0)
exports.MH = function(args) {
	var x = 0;
	var y = 0;

  // Need to add pull-up to safez height
	log.debug( "MH" );
	feedrate = (60.0 * config.opensbp.get('movexy_speed'));
	this.cmd_posx = 0;
	this.cmd_posy = 0;
	this.emit_move('G1',{"X":x,"Y":y,'F':feedrate});

};

// Set the Move (cut) speed for any of the 6 axes
exports.MS = function(args, callback) {

	log.debug( "MS - args = " + args );

	var speed_change = 0.0;
	var g2_values = {};
	var sbp_values = {};

	if (args[0] !== undefined) {
		speed_change = args[0];
		if(isNaN(speed_change)) { throw( "Invalid MS-XY argument: " + speed_change ); }
//		g2_values.xfr = g2_values.yfr = (60 * speed_change);
		sbp_values.movexy_speed = speed_change;
	}
	if (args[1] !== undefined) {
		speed_change = args[1];
		if(isNaN(speed_change)) { throw( "Invalid MS-Z argument: " + speed_change ); }
//		g2_values.zfr = (60 * speed_change);
		sbp_values.movez_speed = speed_change;
	}
	if (args[2] !== undefined) {
		speed_change = args[2];
		if(isNaN(speed_change)) { throw( "Invalid MS-A argument: " + speed_change ); }
//		g2_values.afr = (60 * speed_change);
		sbp_values.movea_speed = speed_change;
	}
	if (args[3] !== undefined) {
		speed_change = args[3];
		if(isNaN(speed_change)) { throw( "Invalid MS-B argument: " + speed_change ); }
//		g2_values.bfr = (60 * speed_change);
		sbp_values.moveb_speed = speed_change;
	}
	if (args[4] !== undefined) {
		speed_change = args[4];
		if(isNaN(speed_change)) { throw( "Invalid MS-C argument: " + speed_change ); }
//		g2_values.cfr = (60 * speed_change);
		sbp_values.movec_speed = speed_change;
	}

	log.debug( "MS-g2_values = " + JSON.stringify(g2_values) );
	log.debug( "MS-sbp_values = " + JSON.stringify(sbp_values) );

	// We have created the objects containing both the values to set on the G2 driver as well as for shopbot
	// Now send them to their appropriate places (shopbot first, followed by G2)
	config.opensbp.setMany(sbp_values, function(err, values) {
		log.debug("SBP_setMany values:" + JSON.stringify(values));
		config.driver.setMany(g2_values, function(err, values) {
			log.debug("G2_setMany values:" + JSON.stringify(values));
			callback();
		});
	});

};

exports.MI = function(args) {
	//?????????????????????????????????????????????
};

exports.MO = function(args) {
	//?????????????????????????????????????????????
};
