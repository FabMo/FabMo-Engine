var log = require('../../../log').logger('sbp');
var g2 = require('../../../g2');
var sb3_commands = require('../sb3_commands');
var config = require('../../../config');

/* CUSTOM CUTS */

// Set to table base coordinates
exports.C6 = function(args) {
	this.emit_gcode("M4");
	this.emit_gcode("M8");
};

// Set to table base coordinates
exports.C7 = function(args) {
	this.emit_gcode("M5");
	this.emit_gcode("M9");
};