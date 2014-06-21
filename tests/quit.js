var machine = require('../machine')

machine.driver.on('connect', function(err, data) {

	// Print any state changes
	machine.driver.on('state', function(data) {
		console.log('State Change: ' + data[0] + ' --> ' + data[1]);
		//console.log(machine.driver.status);
	});

	// Return to zero
	machine.driver.gcode('G0X0');

	// Kick off a long move, but stop it
	setTimeout(function() {
		machine.driver.write('G0X16\n');
		setTimeout(function() {
			machine.driver.quit();
			setTimeout(function() {

					//machine.driver.runString('G0X16');
					machine.driver.writeAndDrain('G0X16\n', function() {
					console.log('SENT');
					//machine.driver.requestStatusUpdate();
				});
			},3000) // Time to dwell before resuming after stop
		}, 1000); // Time to move before stopping
	}, 10000); // Time to return to zero
});
