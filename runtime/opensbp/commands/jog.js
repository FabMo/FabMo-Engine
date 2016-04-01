var log = require('../../../log').logger('sbp');
var g2 = require('../../../g2');
var sb3_commands = require('../sb3_commands');
var config = require('../../../config');

// Note that jogs don't need to be stack breakers, they only are to be consistent with sb3 behavior
// and to improve performance by breaking up large files.  Down the road, if the sender is improved, these
// should be made back into inline commands.

// Jog (rapid) the X axis
exports.JX = function(args) {
	var x = args[0];
	if ( x !== this.cmd_posx ){
		if(isNaN(x)) { throw( "Invalid JX argument: " + x ); }
		this.cmd_posx = x;
		this.emit_move('G0',{"X":x});
	}
};

// Jog (rapid) the Y axis
exports.JY = function(args) {
	var y = args[0];
	if ( y !== this.cmd_posy ){
		if(isNaN(y)) { throw( "Invalid JY argument: " + y ); }
		this.cmd_posy = y;
		this.emit_move('G0',{"Y":y});
	}
};

// Jog (rapid) the Z axis
exports.JZ = function(args) {
	var z = args[0];
	if ( z !== this.cmd_posz ){
		if(isNaN(z)) { throw( "Invalid JZ argument: " + z ); }
		this.cmd_posz = z;
		this.emit_move('G0',{"Z":z});
	}
};

// Jog (rapid) the A axis
exports.JA = function(args) {
	var a = args[0];
	if ( a !== this.cmd_posa ){
		if(isNaN(a)) { throw( "Invalid JA argument: " + a ); }
		this.cmd_posa = a;
		this.emit_move('G0',{"A":a});
	}
};

// Jog (rapid) the B axis
exports.JB = function(args) {
	var b = args[0];
	if ( b !== this.cmd_posb ){
		if(isNaN(b)) { throw( "Invalid JB argument: " + b ); }
		this.cmd_posb = b;
		this.emit_move('G0',{"B":b});
	}
};

// Jog (rapid) the C axis
exports.JC = function(args) {
	var c = args[0];
	if ( c !== this.cmd_posc ){
		if(isNaN(c)) { throw( "Invalid JC argument: " + c ); }
		this.cmd_posc = c;
		this.emit_move('G0',{"C":c});
	}
};

// Jog (rapid) 2 axes (XY).This is a modal command, any axis location that is left out
//   of the command will default to it's current position and not move
exports.J2 = function(args) {
	log.debug(" J2");
    var params = process_jog.bind(this)(args);
    log.debug( "  J2 params = " + JSON.stringify(params) );
    log.debug( "     result = " + this.cmd_result );
	if ( this.cmd_result < 2 ){
		this.emit_move('G0',params);
	}
};

// Jog (rapid) 3 axes (XYZ). This is a modal command, any axis location that is left out
//   of the command will default to it's current position and not move
exports.J3 = function(args) {
    var params = process_jog.bind(this)(args);
	if ( this.cmd_result < 3 ){
		this.emit_move('G0',params);
	}
};

// Jog (rapid) 4 axes (XYZA). This is a modal command, any axis location that is left out
//   of the command will default to it's current position and not move
exports.J4 = function(args) {
    var params = process_jog.bind(this)(args);
    if ( this.cmd_result < 4 ){
		this.emit_move('G0',params);
	}
};

// Jog (rapid) 5 axes (XYZAB). This is a modal command, any axis location that is left out
//   of the command will default to it's current position and not move
exports.J5 = function(args) {
    var params = process_jog.bind(this)(args);
    if ( this.cmd_result < 5 ){
		this.emit_move('G0',params);
	}
};

// Jog (rapid) 6 axes (XYZABC). This is a modal command, any axis location that is left out
//   of the command will default to it's current position and not move
exports.J6 = function(args) {
    var params = process_jog.bind(this)(args);
    if ( this.cmd_result < 6 ){
		this.emit_move('G0',params);
	}
};

process_jog = function(args) {
    log.debug(" process_jog: " + JSON.stringify(args));
	var params = {};
	this.cmd_result = 0;
	if( args[0] === 0 || args[0] && typeof args[0] === "number"){  //args[0] === 0 ||
		params.X = args[0];
		if ( params.X === this.cmd_posx ) { this.cmd_result += 1; }
	}
	if( args[1] === 0 || args[1] && typeof args[1] === "number"){  //args[1] === 0 || 
		params.Y = args[1];
		if ( params.Y === this.cmd_posy ) { this.cmd_result += 1; }
	}  
	if(args[2] === 0 || args[2] && typeof args[2] === "number"){ 
		params.Z = args[2];
		if ( params.Z === this.cmd_posz ) { this.cmd_result += 1; }
	}  
	if(args[3] === 0 || args[3] && typeof args[3] === "number"){ 
		params.A = args[3];
		if ( params.A === this.cmd_posa ) { this.cmd_result += 1; }
	}
	if(args[4] === 0 || args[4] && typeof args[4] === "number"){ 
		params.B = args[4];
		if ( params.B === this.cmd_posb ) { this.cmd_result += 1; }
	}  
	if(args[5] === 0 || args[5] && typeof args[5] === "number"){ 
		params.C = args[5];
		if ( params.C === this.cmd_posc ) { this.cmd_result += 1; }
	}  

	return params;
};

// Jog (rapid) XY to the Home position (0,0) 
exports.JH = function(args,callback) {
	var x = 0;
	var y = 0;
	var safeZ = config.opensbp.get('safeZpullUp');

	this.machine.driver.get('posz', function(err, MPO) {
		var unitConv = 1;
		log.debug( "JH" );
	 	if ( this.machine.driver.status.unit === 'in' ) {  // inches
	 		unitConv = 0.039370079;
	 	}
	 	var z = MPO;
		log.debug("z = " + z);
	 	if ( z < safeZ ){
			this.emit_move('G0',{"Z":safeZ});
			this.emit_move('G0',{"X":x,"Y":y});
 		}
 		else{
 			this.emit_move('G0',{"X":x,"Y":y});
 		}
		this.cmd_posx = 0;
		this.cmd_posy = 0;
		this.cmd_posz = safeZ;
		callback();
	}.bind(this));
};

// Set the Jog (Rapid) speed for any of the 6 axes
// This is a stack break command that won't change the persistent
//   setting of jog speed. Once a file has stopped the jog speed
//   back to the persistent values in G2.json
exports.JS = function(args, callback) {
	var speed_change = 0.0;

	if (args[0] !== undefined) {
		speed_change = args[0];
		if(isNaN(speed_change)) { throw "Invalid JS-XY argument: " + speed_change; }
		this.machine.driver.command({'xvm':(60 * speed_change)});
		this.machine.driver.command({'yvm':(60 * speed_change)});
		this.jogspeed_xy = speed_change;
	}
	if (args[1] !== undefined) {
		speed_change = args[1];
		if(isNaN(speed_change)) { throw "Invalid JS-Z argument: " + speed_change; }
		this.machine.driver.command({'zvm':(60 * speed_change)});
		this.jogspeed_z = speed_change;
	}
	if (args[2] !== undefined) {
		speed_change = args[2];
		if(isNaN(speed_change)) { throw "Invalid JS-A argument: " + speed_change; }
		this.machine.driver.command({'avm':(60 * speed_change)});
		this.jogspeed_a = speed_change;
	}
	if (args[3] !== undefined) {
		speed_change = args[3];
		if(isNaN(speed_change)) { throw "Invalid JS-B argument: " + speed_change; }
		this.machine.driver.command({'bvm':(60 * speed_change)});
		this.jogspeed_b = speed_change;
	}
	if (args[4] !== undefined) {
		speed_change = args[4];
		if(isNaN(speed_change)) { throw "Invalid JS-C argument: " + speed_change; }
		this.machine.driver.command({'cvm':(60 * speed_change)});
		this.jogspeed_c = speed_change;
	}
	// We have created the objects containing both the values to set on the G2 driver as well as for shopbot
	// Now send them to their appropriate places (shopbot first, followed by G2)
    this.vs_change = 1;	
	callback();
};
