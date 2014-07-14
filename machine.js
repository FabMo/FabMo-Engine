var g2 = require('./g2');
var util = require('util');
var events = require('events');
var PLATFORM = require('process').platform
var Engine = require('tingodb')(),
    assert = require('assert');
var fs = require('fs');
var path = require('path');
var log = require('./log');
var GCodeRuntime = require('./gcode').GCodeRuntime
var SBPRuntime = require('./opensbp').SBPRuntime


function connect(callback) {

	switch(PLATFORM) {

		case 'linux':
			serial_path = '/dev/ttyACM0';
			break;

		case 'darwin':
			serial_path = '/dev/cu.usbmodem001';
			break;

		default:
			serial_path = null;
			break;
	}
	if(serial_path) {
		return new Machine(serial_path, callback);
	} else {
		typeof callback === "function" && callback(true, "No supported serial path for platform " + PLATFORM);		
		return null;
	}
}

function Machine(serial_path, callback) {

	// Handle Inheritance
	events.EventEmitter.call(this);

	// Instantiate driver and connect to G2
	this.status = {
		state : "not_ready",
		posx : 0.0,
		posy : 0.0,
		posz : 0.0
	}

	this.driver = new g2.G2();
	this.driver.on("error", function(data) {log.error(data)});

	this.driver.connect(serial_path, function(err, data) {
		this.status.state = "idle";

		this.gcode_runtime = new GCodeRuntime();
		this.gcode_runtime.connect(this);
		
		this.sbp_runtime = new SBPRuntime();
		this.sbp_runtime.connect(this);

		this.driver.requestStatusReport(function(err, result) {
			typeof callback === "function" && callback(false, this);
		}.bind(this));
	}.bind(this));
};
util.inherits(Machine, events.EventEmitter);

Machine.prototype.toString = function() {
    return "[Machine Model on '" + driver.path + "']";
}

Machine.prototype.gcode = function(string) {
	this.driver.runString(string);
}
Machine.prototype.runFile = function(filename) {
	fs.readFile(filename, 'utf8', function (err,data) {
		  if (err) {
		  	console.log('Error reading file ' + filename);
		    return console.log(err);
		  } else {
            parts = filename.split(path.sep)
        	ext = path.extname(filename).toLowerCase();
            log.debug(filename);
            log.debug(parts);
		  	this.status.current_file = parts[parts.length-1]

		  	if(ext == '.sbp') {
		  		this.current_runtime = this.sbp_runtime;
		  	} else {
		  		this.current_runtime = this.gcode_runtime;
		  	}

		  	this.current_runtime.runString(data);

		  }
		}.bind(this));
};

Machine.prototype.jog = function(direction, callback) {
	if(this.status.state === "idle" || this.status.state === "manual") {
		this.status.state = "manual";
		this.driver.jog(direction);

	} else {
		typeof callback === "function" && callback(true, "Cannot jog when in '" + this.status.state + "' state.");
	}

}

Machine.prototype.stopJog = function() {
	this.driver.stopJog();
} 

Machine.prototype.pause = function() {
	if(this.status.state === "running") {
		this.driver.feedHold();
	}
}

Machine.prototype.quit = function() {
	this.driver.quit();
}

Machine.prototype.resume = function() {
	this.driver.resume();
}

exports.connect = connect;

