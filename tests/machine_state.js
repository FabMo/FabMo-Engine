var machine = require('../machine')

machine.connect(function(err, tool) {
	tool.driver.on('error', function(error) {console.log(error);});
	tool.runString('G0X0\nG1X10F120\nG0X0', function(err, result) {
		console.log('Job complete!');
	});
});
