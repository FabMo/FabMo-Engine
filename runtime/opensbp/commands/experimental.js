var log = require('../../../log').logger('sbp');
var g2 = require('../../../g2');
var sb3_commands = require('../sb3_commands');
var config = require('../../../config');

exports.EP = function(args) {
	this.emit_gcode("G38.2 Z" + args[0]);
};
