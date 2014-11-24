var process = require('process');
var serialport = require("serialport");
var fs = require('fs');

filename = process.argv[2]

data = fs.readFileSync(filename) + '\n';
console.log(data);
port = new serialport.SerialPort('/dev/cu.usbmodem1411', false);	

port.open( function(error) {
	if(error) {
		console.log(error);
	} else {
		port.write(data);
	}
});
