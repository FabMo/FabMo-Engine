var machine = require('../machine')


machine.machine = machine.connect(function(error, machine) {
	if(error) {
		console.log("There was an error connecting to the tool: " + data)
	} else {
	console.log('kicking off g0x0');
	// Return to zero
	machine.runString('G0X0');

	// Kick off a long move, but stop it
	setTimeout(function() {
		machine.runString('G0X16');
		setTimeout(function() {
			machine.quit();
			setTimeout(function() {
					//machine.driver.runString('G0X16');
					machine.runString('G0X16');
			},3000) // Time to dwell before resuming after stop
		}, 1000); // Time to move before stopping
	}, 10000); // Time to return to zero
	}
});
