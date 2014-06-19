var machine = require('../machine')

machine.driver.on('connect', function(err, data) {
	machine.driver.gcode('g90\ng0x0');
});
