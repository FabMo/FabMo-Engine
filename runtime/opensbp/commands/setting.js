var log = require('../../../log').logger('sbp');
var g2 = require('../../../g2');
var sb3_commands = require('../sb3_commands');
var config = require('../../../config');

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
exports.SM = function(args) {
	
};

// Set to PREVIEW mode
exports.SP = function(args) {
	
};

// Set to table base coordinates
exports.ST = function(args) {
	this.emit_gcode("G54");
};

exports.SO = function(args) {
	outnum = parseInt(args[0])
	state = parseInt(args[1])
	if(outnum === 1) {
		switch(state) {
			case 1:
				this.emit_gcode("M4");
				this.emit_gcode("M8");
				break;
			case 0:
				this.emit_gcode("M5");
				this.emit_gcode("M9");
			}
		}
	}
}

