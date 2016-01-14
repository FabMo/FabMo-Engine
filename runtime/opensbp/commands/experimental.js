var log = require('../../../log').logger('sbp');
var g2 = require('../../../g2');
var sb3_commands = require('../sb3_commands');
var config = require('../../../config');

exports.EX = function(args, callback) {
	log.info("Breaking the stack for an EX command.  (Experimental Stack Break)");
	callback();
}