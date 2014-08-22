var parser = require('../parser')
var process = require('process')
var fs = require('fs')

filename = process.argv[2];

fs.readFile(filename, 'utf8', function (err,data) {
	if (err) {
		console.log('Error reading file ' + filename);
		log.error(err);
		return;
	} else {
		program = parser.parse(data);
		for(i=0; i<program.length; i++) {
			console.log(program[i])
		}
	}
});
