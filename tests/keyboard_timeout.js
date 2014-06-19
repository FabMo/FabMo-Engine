var machine = require('../machine')

machine.driver.on('connect', function(err, data) {
	keyhold = setInterval(function() {
		machine.driver.jog('+x');
	}, 100);

	setTimeout(function() {
		clearTimeout(keyhold); 
		//machine.driver.jog(null);
	}, 2000);

	setTimeout(function() {
		machine.driver.jog(null);
	},10000);

});