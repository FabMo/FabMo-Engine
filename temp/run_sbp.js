
machine = require('../machine');
process = require('process');
fs = require('fs');

filename = process.argv[2];
// Connect to G2
var m = machine.connect(function(error, data) {
	if(error) {
		log.error("There was an error connecting to the tool: " + data);
		process.exit(1);
	} else {

		fs.readFile(filename, 'utf8', function (err,data) {
			if (err) {
				console.log('Error reading file ' + filename);
				log.error(err);
				return;
			} else {
				m.runFile(filename);
			}
		});
	}
});
