var log = require('../../../log').logger('sbp');
var g2 = require('../../../g2');
var sb3_commands = require('../sb3_commands');
var config = require('../../../config');
var openSBP = require('../opensbp.js');

/* SETTINGS */

// Set to Absolute coordinates
exports.SA = function(args) {
	this.emit_gcode("G90");
};

//  Set to Relative coordinates
exports.SR = function(args) {
	this.emit_gcode("G91");
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
	if(outnum === 1) {
		switch(state) {
			case 1:
				this.emit_gcode("M4");
				this.emit_gcode("M8");
				break;
			case 0:
				this.emit_gcode("M5");
				this.emit_gcode("M9");
				break;
		}
	}
};

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
