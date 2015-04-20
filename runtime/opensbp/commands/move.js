var log = require('../../../log').logger('sbp');
var g2 = require('../../../g2');
var sb3_commands = require('../sb3_commands');
var config = require('../../../config');

// Move X axis
exports.MX = function(args) {
	var x = args[0];

	log.debug( " MX args: " + JSON.stringify(args));
	feedrate = (60.0 * config.opensbp.get('movexy_speed'));
	this.emit_move('G1',{"X":x,'F':feedrate});

/*	if(isNaN(x)) { throw( "Invalid MX argument: " + x ); }
	var PtXfrm = { "X":x };
	PtXfrm = this.transformation(PtXfrm);
    x = PtXfrm.X;
	this.emit_gcode("G1X" + x + " F" + ( 60.0 * config.opensbp.get('movexy_speed')));
	this.cmd_posx = x;
*/
};

// Move Y axis
exports.MY = function(args) {
	var y = args[0];

	log.debug( " MY args: " + JSON.stringify(args));
	feedrate = (60.0 * config.opensbp.get('movexy_speed'));
	this.emit_move('G1',{"Y":y,'F':feedrate});

/*	if(isNaN(y)) { throw( "Invalid MY argument: " + y ); }
	log.debug("MY  " + y );
	var PtXfrm = { "Y":y };
	this.raw_posy = args[0];
	PtXfrm = this.transformation(PtXfrm);
    y = PtXfrm.Y;
	this.emit_gcode("G1Y" + y + " F" + ( 60.0 * config.opensbp.get('movexy_speed')));
	this.cmd_posy = y;
*/
};

// Move Z axis
exports.MZ = function(args) {
	var z = args[0];

	log.debug( " MZ args: " + JSON.stringify(args));
	feedrate = (60.0 * config.opensbp.get('movez_speed'));
	this.emit_move('G1',{"Z":z,'F':feedrate});

/*	if(isNaN(z)) { throw( "Invalid MZ argument: " + z ); }
	var PtXfrm = { "Z":z };
	this.raw_posz = args[0];
	PtXfrm = this.transformation(PtXfrm);
    z = PtXfrm.Z;
	this.emit_gcode("G1Z" + z + " F" + ( 60.0 * config.opensbp.get('movez_speed')));
	this.cmd_posz = z;
*/
};

// Move A axis
exports.MA = function(args) {
	var a = args[0];

	log.debug( " MA args: " + JSON.stringify(args));
	feedrate = (60.0 * config.opensbp.get('movea_speed'));
	this.emit_move('G1',{"A":a,'F':feedrate});

/*	if(isNaN(a)) { throw( "Invalid MA argument: " + a ); }
	var PtXfrm = { "A":a };
	this.raw_posa = args[0];
	PtXfrm = this.transformation(PtXfrm);
    a = PtXfrm.A;
	this.emit_gcode("G1A" + a + " F" + ( 60.0 * config.opensbp.get('movea_speed')));
	this.cmd_posa = a;
*/
};

// Move B axis
exports.MB = function(args) {
	var b = args[0];

	log.debug( " MB args: " + JSON.stringify(args));
	feedrate = (60.0 * config.opensbp.get('moveb_speed'));
	this.emit_move('G1',{"B":b,'F':feedrate});

/*	if(isNaN(b)) { throw( "Invalid MB argument: " + b ); }
	this.raw_posb = args[0];
	this.emit_gcode("G1B" + b + " F" + ( 60.0 * config.opensbp.get('moveb_speed')));
	this.cmd_posb = b;
*/
};

// Move C axis
exports.MC = function(args) {
	var c = args[0];

	log.debug( " MC args: " + JSON.stringify(args));
	feedrate = (60.0 * config.opensbp.get('movec_speed'));
	this.emit_move('G1',{"C":c,'F':feedrate});

/*	if(isNaN(c)) { throw( "Invalid MC argument: " + c ); }
	this.raw_posc = args[0];
	this.emit_gcode("G1C" + c + " F" + ( 60.0 * config.opensbp.get('movec_speed')));
	this.cmd_posc = c;
*/
};

// Move 2 axes (XY). This is a modal command, any axis location that is left out
//   of the command will default to it's current position and not move
exports.M2 = function(args) {
	var x = args[0];
	var y = args[1];

	log.debug( " M2 args: " + JSON.stringify(args));
	feedrate = (60.0 * config.opensbp.get('movexy_speed'));
	this.emit_move('G1',{"X":x,"Y":y,'F':feedrate});

/*	if (x === undefined) { x = this.cmd_posx; }
	  else { 
	  	if(isNaN(x)) { throw( "Invalid M2-X argument: " + x ); }
	  	this.raw_posx = args[0]; 
	  }
	if (y === undefined) { y = this.cmd_posy; }
	  else { 
	  	if(isNaN(y)) { throw( "Invalid M2-Y argument: " + y ); }
		this.raw_posy = args[1];
	  }

	var PtXfrm = { "X":x, "Y":y };
	PtXfrm = this.transformation(PtXfrm);

	var outStr = "G1";
	if (args[0] !== undefined) {
		x = PtXfrm.X;
		outStr = outStr + "X" + x;
		this.cmd_posx = x;
	}
	if (args[1] !== undefined) {
		y = PtXfrm.Y;
		outStr = outStr + "Y" + y;
		this.cmd_posy = y;
	}
	outStr = outStr + "F" + ( 60.0 * config.opensbp.get('movexy_speed')); 
	this.emit_gcode(outStr);
*/	
};

// Move 3 axes (XYZ). This is a modal command, any axis location that is left out
//   of the command will default to it's current position and not move
exports.M3 = function(args) {
	var x = args[0];
	var y = args[1];
	var z = args[2];
	//var M3res = 5;

	log.debug( " M3 args: " + JSON.stringify(args));
	feedrate = (60.0 * config.opensbp.get('movexy_speed'));
	this.emit_move('G1',{"X":x,"Y":y,"Z":z, 'F':feedrate});

/*
	if (x === undefined) { x = this.cmd_posx; }
	  else {
	  	if(isNaN(x)) { throw( "Invalid M3-X argument: " + x ); } 
		this.raw_posx = args[0];
	  } 
	if (y === undefined) { y = this.cmd_posy; }
	  else {
	  	if(isNaN(y)) { throw( "Invalid M3-Y argument: " + y ); } 
		this.raw_posy = args[1];
	  }
	if (z === undefined) { z = this.cmd_posz; }
	  else {
	  	if(isNaN(z)) { throw( "Invalid M3-Z argument: " + z ); } 
		this.raw_posz = args[2];
	  }

	var PtXfrm = { "X":x, "Y":y, "Z":z };
	log.debug("  M3: " + JSON.stringify(PtXfrm));
	PtXfrm = this.transformation(PtXfrm);

	var outStr = "G1";
	if (args[0] !== undefined) {
		x = PtXfrm.X;
		outStr = outStr + "X" + (x).toFixed(M3res);
		this.cmd_posx = x;
	}
	if (args[1] !== undefined) {
		y = PtXfrm.Y;
		outStr = outStr + "Y" + (y).toFixed(M3res);
		this.cmd_posy = y;
	}
	if (args[2] !== undefined) {
		z = PtXfrm.Z;
		outStr = outStr + "Z" + (z).toFixed(M3res);
		this.cmd_posz = z;
	}
	outStr = outStr + "F" + ( 60.0 * config.opensbp.get('movexy_speed')); 
	log.debug( "M3 outstr: " + outStr);
	this.emit_gcode(outStr);
	*/

};

// Move 4 axes (XYZA). This is a modal command, any axis location that is left out
//   of the command will default to it's current position and not move
exports.M4 = function(args) {
	var x = args[0];
	var y = args[1];
	var z = args[2];
	var a = args[3];

	log.debug( " M3 args: " + JSON.stringify(args));
	feedrate = (60.0 * config.opensbp.get('movexy_speed'));
	this.emit_move('G1',{"X":x,"Y":y,"Z":z,"A":a, 'F':feedrate});

/*	var M3res = 5;

	if (x === undefined) { x = this.cmd_posx; }
	  else { 
	  	if(isNaN(x)) { throw( "Invalid M4-X argument: " + x ); } 
		this.raw_posx = args[0];
	  } 
	if (y === undefined) { y = this.cmd_posy; }
	  else { 
	  	if(isNaN(y)) { throw( "Invalid M4-Y argument: " + y ); } 
		this.raw_posy = args[1];
	  }
	if (z === undefined) { z = this.cmd_posz; }
	  else { 
	  	if(isNaN(z)) { throw( "Invalid M4-Z argument: " + z ); } 
		this.raw_posz = args[2];
	  }

	var PtXfrm = { "X":x, "Y":y, "Z":z };
	PtXfrm = this.transformation(PtXfrm);

	var outStr = "G1";
	if (args[0] !== undefined) {
		x = PtXfrm.X;
		outStr = outStr + "X" + x;
		this.cmd_posx = x;
	}
	if (args[1] !== undefined) {
		y = PtXfrm.Y;
		outStr = outStr + "Y" + y;
		this.cmd_posy = y;
	}
	if (args[2] !== undefined) {
		z = PtXfrm.Z;
		outStr = outStr + "Z" + z;
		this.cmd_posz = z;
	}
	if (args[3] !== undefined) {
		var a = args[3];
		if(isNaN(a)) { throw( "Invalid M4-A argument: " + a ); }
		this.raw_posa = args[3];
		outStr = outStr + "A" + a;
		this.cmd_posa = a;
	}
	outStr = outStr + "F" + ( 60.0 * config.opensbp.get('movexy_speed')); 
	this.emit_gcode(outStr);
*/	
};

// Move 5 axes (XYZAB). This is a modal command, any axis location that is left out
//   of the command will default to it's current position and not move
exports.M5 = function(args) {
	var x = args[0];
	var y = args[1];
	var z = args[2];
	var a = args[3];
	var b = args[4];

	log.debug( " M5 args: " + JSON.stringify(args));
	feedrate = (60.0 * config.opensbp.get('movexy_speed'));
	this.emit_move('G1',{"X":x,"Y":y,"Z":z,"A":a,"B":b,'F':feedrate});

/*	var M3res = 5;

	if (x === undefined) { x = this.cmd_posx; }
	  else { 
	  	if(isNaN(x)) { throw( "Invalid M5-X argument: " + x ); } 
		this.raw_posx = args[0];
	  } 
	if (y === undefined) { y = this.cmd_posy; }
	  else { 
	  	if(isNaN(y)) { throw( "Invalid M5-Y argument: " + y ); } 
		this.raw_posy = args[1];
	  }
	if (z === undefined) { z = this.cmd_posz; }
	  else { 
	  	if(isNaN(z)) { throw( "Invalid M5-Z argument: " + z ); } 
		this.raw_posz = args[2];
	  }

	var PtXfrm = { "X":x, "Y":y, "Z":z };
	PtXfrm = this.transformation(PtXfrm);

	var outStr = "G1";
	if (args[0] !== undefined) {
		x = PtXfrm.X;
		outStr = outStr + "X" + x;
		this.cmd_posx = x;
	}
	if (args[1] !== undefined) {
		y = PtXfrm.Y;
		outStr = outStr + "Y" + y;
		this.cmd_posy = y;
	}
	if (args[2] !== undefined) {
		z = PtXfrm.Z;
		outStr = outStr + "Z" + z;
		this.cmd_posz = z;
	}
	if (args[3] !== undefined) {
		var a = args[3];
		if(isNaN(a)) { throw( "Invalid M5-A argument: " + a ); }
		this.raw_posa = args[3];
		outStr = outStr + "A" + a;
		this.cmd_posa = a;
	}
	if (args[4] !== undefined) {
		var b = args[4];
		if(isNaN(b)) { throw( "Invalid M5-B argument: " + b ); }
		this.raw_posb = args[4];
		outStr = outStr + "B" + b;
		this.cmd_posb = b;
	}
	outStr = outStr + "F" + ( 60.0 * config.opensbp.get('movexy_speed')); 
	this.emit_gcode(outStr);
*/
};

// Move all 6 axes (XYZABC). This is a modal command, any axis location that is left out
//   of the command will default to it's current position and not move
exports.M6 = function(args) {
	var x = args[0];
	var y = args[1];
	var z = args[2];
	var a = args[3];
	var b = args[4];
	var c = args[5];

	log.debug( " M6 args: " + JSON.stringify(args));
	feedrate = (60.0 * config.opensbp.get('movexy_speed'));
	this.emit_move('G1',{"X":x,"Y":y,"Z":z,"A":a,"B":b,"C":c,'F':feedrate});

/*	var x = args[0];
	var y = args[1];
	var z = args[2];
	var M3res = 5;

	if (x === undefined) { x = this.cmd_posx; }
	  else { 
	  	if(isNaN(x)) { throw( "Invalid M6-X argument: " + x ); } 
		this.raw_posx = args[0];
	  } 
	if (y === undefined) { y = this.cmd_posy; }
	  else { 
	  	if(isNaN(y)) { throw( "Invalid M6-Y argument: " + y ); } 
		this.raw_posy = args[1];
	  }
	if (z === undefined) { z = this.cmd_posz; }
	  else { 
	  	if(isNaN(z)) { throw( "Invalid M6-Z argument: " + z ); } 
		this.raw_posz = args[2];
	  }

	var PtXfrm = { "X":x, "Y":y, "Z":z };
	PtXfrm = this.transformation(PtXfrm);

	var outStr = "G1";
	if (args[0] !== undefined) {
		x = PtXfrm.X;
		outStr = outStr + "X" + x;
		this.cmd_posx = x;
	}	
	if (args[1] !== undefined) {
		y = PtXfrm.Y;
		outStr = outStr + "Y" + y;
		this.cmd_posy = y;
	}
	if (args[2] !== undefined) {
		z = PtXfrm.Z;
		outStr = outStr + "Z" + z;
		this.cmd_posz = z;
	}
	if (args[3] !== undefined) {
		var a = args[3];
		if(isNaN(a)) { throw( "Invalid M6-A argument: " + a ); }
		this.raw_posa = args[3];
		outStr = outStr + "A" + a;
		this.cmd_posa = a;
	}
	if (args[4] !== undefined) {
		var b = args[4];
		if(isNaN(b)) { throw( "Invalid M6-B argument: " + b ); }
		this.raw_posb = args[4];
		outStr = outStr + "B" + b;
		this.cmd_posb = b;
	}
	if (args[5] !== undefined) {
		var c = args[5];
		if(isNaN(c)) { throw( "Invalid M6-C argument: " + c ); }
		this.raw_posc = args[5];
		outStr = outStr + "C" + c;
		this.cmd_posc = c;
	}
	outStr = outStr + "F" + ( 60 * config.opensbp.get('movexy_speed')); 
	this.emit_gcode(outStr);
*/	
};

// Move to the XY home position (0,0)
exports.MH = function(args) {
	var x = 0;
	var y = 0;

	log.debug( "MH" );
	feedrate = (60.0 * config.opensbp.get('movexy_speed'));
	this.emit_move('G1',{"X":x,"Y":y,'F':feedrate});

/*	this.emit_gcode("G1X0Y0F" + ( 60 * config.opensbp.get('movexy_speed')));
	this.cmd_posx = 0;
	this.cmd_posy = 0;
*/
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
		g2_values.xfr = g2_values.yfr = (60 * speed_change);
		sbp_values.movexy_speed = speed_change;
	}
	if (args[1] !== undefined) {
		speed_change = args[1];
		if(isNaN(speed_change)) { throw( "Invalid MS-Z argument: " + speed_change ); }
		g2_values.zfr = (60 * speed_change);
		sbp_values.movez_speed = speed_change;
	}
	if (args[2] !== undefined) {
		speed_change = args[2];
		if(isNaN(speed_change)) { throw( "Invalid MS-A argument: " + speed_change ); }
		g2_values.afr = (60 * speed_change);
		sbp_values.movea_speed = speed_change;
	}
	if (args[3] !== undefined) {
		speed_change = args[3];
		if(isNaN(speed_change)) { throw( "Invalid MS-B argument: " + speed_change ); }
		g2_values.bfr = (60 * speed_change);
		sbp_values.moveb_speed = speed_change;
	}
	if (args[4] !== undefined) {
		speed_change = args[4];
		if(isNaN(speed_change)) { throw( "Invalid MS-C argument: " + speed_change ); }
		g2_values.cfr = (60 * speed_change);
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
