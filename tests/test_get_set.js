var machine = require('../machine')

var m = machine.connect(function(error, data) {
	if(error) {
		log.error("There was an error connecting to the tool: " + data);
		process.exit(1);
	} else {
        data.driver.get(['xsn','ysn','zsn'], function(err, result) {
            console.log(result);
        });
	}
})
