var log = require('../../../log').logger('sbp');
var g2 = require('../../../g2');
var sb3_commands = require('../sb3_commands');
var config = require('../../../config');
var openSBP = require('../opensbp.js');

/* SETTINGS */

// Set to Absolute coordinates
exports.SA = function(args) {
	this.absoluteMode = true;
	this.emit_gcode("G90");
	this.emit_gcode("M0");
};

exports.SC = function(args, callback) {
	try {
	switch(args[0]) {
		case 0:
			cs = "G54";
			break;
		case 1:
			cs = "G55";
			break;
		default:
			throw new Error("Invalid coordinate system specified: " + args[0])
			break;
	}
	this.emit_gcode(cs)
	this.coordinateSystem = cs;
	} catch(e) {
		return callback(e)
	}
	this.cmd_posx = null;
	this.cmd_posy = null;
	this.cmd_posz = null;
	this.cmd_posa = null;
	this.cmd_posb = null;
	this.cmd_posc = null;

	callback();
}

exports.SK = function(args, callback) {
	this.manualEnter(args[0], callback);
}

//  Set to Relative coordinates
exports.SR = function(args) {
	this.absoluteMode = false;
	this.emit_gcode("G91");
	//this.emit_gcode("M0");
};

// Set to MOVE mode
// exports.SM = function(args) {

// };

// Set to PREVIEW mode
// exports.SP = function(args) {

// };

// Set to table base coordinates
exports.ST = function(args, callback) {
	this.machine.driver.get('mpo', function(err, MPO) {
		log.debug("ST-MPO = " + JSON.stringify(MPO));
		if(err) { return callback(err); }
		var stObj = {};
		unitConv = 1.0;
		if ( this.machine.driver.status.unit === 'in' ) {  // inches
			unitConv = 0.039370079;
		}
		stObj.g55x = 0.0;
		stObj.g55y = 0.0;
		stObj.g55z = 0.0;
		stObj.g55a = 0.0;
		stObj.g55b = 0.0;
		stObj.g55c = 0.0;
		config.driver.setMany(stObj, function(err, value) {
			if(err) { return callback(err); }
			this.cmd_posx = this.posx = stObj.g55x;
			this.cmd_posy = this.posy = stObj.g55y;
			this.cmd_posz = this.posz = stObj.g55z;
			this.cmd_posa = this.posa = stObj.g55a;
			this.cmd_posb = this.posb = stObj.g55b;
			this.cmd_posc = this.posc = stObj.g55c;
			callback();
		}.bind(this));
	}.bind(this));
};

exports.SO = function(args) {
	outnum = parseInt(args[0]);
	state = parseInt(args[1]);
	if(outnum >= 1 && outnum <= 12) {
		if(state == 1 || state == 0) {
			if(outnum === 1) {
				if(state === 1) {
					this.emit_gcode('M3');
				} else {
					this.emit_gcode('M5');
				}
			} else {
				this.emit_gcode('M100 ({out' + outnum + ':' + state + '})');
			}
		} else {
			log.warn("Value passed to SO that's not a 1 or 0");
		}
	}
};

exports.SP = function(args) {
	outnum = parseInt(args[0]);
	state = parseFloat(args[1]);
	if(outnum >= 0 && outnum <= 1) {
		outnum += 11
		if(state >= 0.0 && state <= 1.0) {
			this.emit_gcode('M100 ({out' + outnum + ':' + state + '})');
		} else {
			log.warn("Value passed to SP that's not between 0 and 1");
		}
	} else {
		log.warn("PWM number passed to SP thats not 0 or 1");
	}
};

exports.SU = function(args) {
	var units = ((args[0] || 'in') + '').toLowerCase();

	switch(units) {
		case 'in':
		case 'inch':
		case 'inches':
		case '0':
				this.emit_gcode('G20');
				this.emit_gcode('G4 P0.001');
			break;
		case 'mm':
		case 'millimeter':
		case 'millimeters:':
		case '1':
				this.emit_gcode('G21');
				this.emit_gcode('G4 P0.001');
			break;
		default:
			log.warn('Unknown unit specified: ' + units);
			break;
	}
}

exports.SV = function(args, callback){
	this._saveDriverSettings(function(err, values) {
		if(err) { log.error(err); }
		this._saveConfig(function(err, values) {
			if(err) { log.error(err); }
			config.machine.set('units', this.units, function(err, data) {
				callback();
			});
		}.bind(this));
	}.bind(this));
};
