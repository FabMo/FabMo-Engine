var machine = require('../machine')

machine.driver.on('connect', function(err, data) {
	machine.driver.jog('x');
	setTimeout(function() {machine.driver.jog('x');}, 2000); // Two-shot, I guess
});
