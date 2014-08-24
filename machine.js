var g2 = require('./g2');
var util = require('util');
var events = require('events');
var PLATFORM = require('process').platform;
var Engine = require('tingodb')();
var assert = require('assert');
var fs = require('fs');
var path = require('path');

var log = require('./log').logger('machine');
var GCodeRuntime = require('./gcode').GCodeRuntime
var SBPRuntime = require('./opensbp').SBPRuntime
var ManualRuntime = require('./manual').ManualRuntime



function connect(callback) {

	switch(PLATFORM) {

		case 'linux':
			control_path = '/dev/ttyACM0';
			gcode_path = '/dev/ttyACM1';
			break;

		case 'darwin':
			control_path = '/dev/cu.usbmodem001';
			gcode_path = '/dev/cu.usbmodem003';
			break;

		case 'win32':
			control_path = 'COM1';
			gcode_path = 'COM2';
			break;
				
		case 'win64':
			control_path = 'COM1';
			gcode_path = 'COM2';
			break;

		default:
			control_path = null;
			gcode_path = null;
			break;
	}
	if(control_path && gcode_path) {
		return new Machine(control_path, gcode_path, callback);
	} else {
		typeof callback === "function" && callback(true, "No supported serial path for platform " + PLATFORM);		
		return null;
	}
}

function Machine(control_path, gcode_path, callback) {

	// Handle Inheritance
	events.EventEmitter.call(this);

	// Instantiate driver and connect to G2
	this.status = {
		state : "not_ready",
		posx : 0.0,
		posy : 0.0,
		posz : 0.0
	};

	this.driver = new g2.G2();
	this.driver.on("error", function(data) {log.error(data)});

	this.driver.connect(control_path, gcode_path, function(err, data) {
		this.status.state = "idle";

		this.gcode_runtime = new GCodeRuntime();
		this.sbp_runtime = new SBPRuntime();
		this.manual_runtime = new ManualRuntime();

		this.setRuntime(this.gcode_runtime);

		this.driver.requestStatusReport(function(err, result) {
			typeof callback === "function" && callback(false, this);
		}.bind(this));
	}.bind(this));
};
util.inherits(Machine, events.EventEmitter);

Machine.prototype.toString = function() {
    return "[Machine Model on '" + driver.control_path + "," + driver.gcode_path + "']";
}

Machine.prototype.gcode = function(string) {
	this.setRuntime(this.gcode_runtime);
	this.current_runtime.runString(string);
}

Machine.prototype.sbp = function(string) {
	this.setRuntime(this.sbp_runtime);
	this.current_runtime.runString(string);
}

Machine.prototype.runFile = function(filename) {
	fs.readFile(filename, 'utf8', function (err,data) {
		if (err) {
			log.error('Error reading file ' + filename);
		    	log.error(err);
		    	return;
		} else {
            		parts = filename.split(path.sep);
        		ext = path.extname(filename).toLowerCase();
            		log.debug(filename);
            		log.debug(parts);
		  	this.status.current_file = parts[parts.length-1];

		  	if(ext == '.sbp') {
		  		this.setRuntime(this.sbp_runtime);
		  	} else {
				this.setRuntime(this.gcode_runtime);
		  	}
			this.current_runtime.runString(data);
		}
	}.bind(this));
};

Machine.prototype.jog = function(direction, callback) {
	log.info('machine jog');
	if((this.status.state === "idle") || (this.status.state === "manual")) {
		this.setState("manual");
		this.setRuntime(this.manual_runtime);
		this.current_runtime.jog(direction);

	} else {
		typeof callback === "function" && callback(true, "Cannot jog when in '" + this.status.state + "' state.");
	}

}

Machine.prototype.setRuntime = function(runtime) {
	if(this.current_runtime != runtime) {
		try {
			this.current_runtime.disconnect();
		} catch (e) {

		} finally {
			this.current_runtime = runtime;
			runtime.connect(this);
		}
	}
}
Machine.prototype.setState = function(source, newstate) {
	if ((source === this) || (source === this.current_runtime)) {
		this.status.state = newstate;
		log.info("Got a machine state change: " + newstate)
	} else {
		log.warn("Got a state change from a runtime that's not the current one.")
	}
}


Machine.prototype.stopJog = function() {
	this.current_runtime.stopJog();
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
