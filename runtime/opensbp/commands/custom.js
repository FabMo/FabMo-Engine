var log = require('../../../log').logger('sbp');
var g2 = require('../../../g2');
var sb3_commands = require('../sb3_commands');
var config = require('../../../config');

/* CUSTOM CUTS */

// Set to table base coordinates
exports.C_POUND = function(args) {
	log.debug('GOT A C# COMMAND');
	log.debug(args);
};
