var log = require('../../../log').logger('sbp');
var g2 = require('../../../g2');
var sb3_commands = require('../sb3_commands');
var config = require('../../../config');

// Note that jogs don't need to be stack breakers, they only are to be consistent with sb3 behavior
// and to improve performance by breaking up large files.  Down the road, if the sender is improved, these
// should be made back into inline commands.

// Jog (rapid) the X axis
exports.PX = function(args, callback) {
	console.log(this)
	var driver = this.machine.driver;
	console.log(args);
	var cmd = {}
	var inputName = 'di' + args[0] + 'fn';
	cmd[inputName] = 4
	var distance = args[1];
	var speed = args[2]*60.0;

	driver.waitForState([driver.STAT_PROBE]).then(function(state) {
		return driver.waitForState([driver.STAT_STOP]);
	}).then(function(state) {
		callback();
	});
	
	console.log(this.emit_gcode);
	this.emit_gcode('M100(' + JSON.stringify(cmd) + ')');
	this.emit_gcode('G38.2 X' + distance.toFixed(5) + ' F' + speed.toFixed(3));
};
