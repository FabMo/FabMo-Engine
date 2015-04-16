var g2 = require('./g2');
var util = require('util');
var events = require('events');
var PLATFORM = require('process').platform;
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var db = require('./db');
var log = require('./log').logger('machine');
var config = require('./config');

var GCodeRuntime = require('./runtime/gcode').GCodeRuntime;
var SBPRuntime = require('./runtime/opensbp').SBPRuntime;
var ManualRuntime = require('./runtime/manual').ManualRuntime;
var PassthroughRuntime = require('./runtime/passthrough').PassthroughRuntime;


function connect(callback) {

	switch(PLATFORM) {

		case 'linux':
			control_path = config.engine.get('control_port_linux');
			gcode_path = config.engine.get('data_port_linux');
			break;

		case 'darwin':
			control_path = config.engine.get('control_port_osx');
			gcode_path = config.engine.get('data_port_osx');
			break;

		case 'win32':
		case 'win64':
			control_path = config.engine.get('control_port_windows');
			gcode_path = config.engine.get('data_port_windows');
			break;

		default:
			control_path = null;
			gcode_path = null;
			break;
	}
	if(control_path && gcode_path) {
		exports.machine = new Machine(control_path, gcode_path, callback);
		callback(null, exports.machine);
	} else {
		typeof callback === "function" && callback('No supported serial path for platform "' + PLATFORM + '"');
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
		posz : 0.0, 
		in1 : 1,
		in2 : 1,
		in3 : 1,
		in4 : 1,
		in5 : 1,
		in6 : 1,
		in7 : 1,
		in8 : 1,
		job : null
	};

	this.driver = new g2.G2();
	this.driver.on("error", function(data) {log.error(data);});
	this.driver.connect(control_path, gcode_path, function(err, data) {
	
	    // Configure logging for errors with serial driver
	    this.driver.on("error", function(data) {
		    log.error(data);
	    });
		    // Set the initial state based on whether or not we got a valid connection to G2
		    if(err){
		    	log.debug("Setting the disconnected state");
			    //this.status.state = "disconnected";
		    } else {
			    this.status.state = "idle";
		    }

		    // Create runtimes for different functions/command languages
		    this.gcode_runtime = new GCodeRuntime();
		    this.sbp_runtime = new SBPRuntime();
		    this.manual_runtime = new ManualRuntime();
		    this.passthrough_runtime = new PassthroughRuntime();

		    // GCode is the default runtime
		    this.setRuntime(this.gcode_runtime);

		    if(err) {
			    typeof callback === "function" && callback(err);
		    } else {
			    this.driver.requestStatusReport(function(err, result) {
				    typeof callback === "function" && callback(null, this);
			    }.bind(this));
		    }

    }.bind(this));
}
util.inherits(Machine, events.EventEmitter);

Machine.prototype.isConnected = function() {
	return this.status.state !== 'disconnected';
};

Machine.prototype.disconnect = function(callback) {
	this.driver.disconnect(callback);
};

Machine.prototype.toString = function() {
	return "[Machine Model on '" + this.driver.path + "']";
};

Machine.prototype.gcode = function(string) {
	this.setRuntime(this.gcode_runtime);
	this.current_runtime.runString(string);
};

Machine.prototype.sbp = function(string) {
	this.setRuntime(this.sbp_runtime);
	this.current_runtime.runString(string);
};

Machine.prototype.runJob = function(job) {
	this.status.job = job;
	db.File.getByID(job.file_id,function(file){
		// TODO deal with no file found
		log.info("Running file " + file.path);
		this.runFile(file.path);
	}.bind(this));	
};

Machine.prototype.runNextJob = function(callback) {
	if(this.isConnected()) {

	log.info("Running next job");
		db.Job.dequeue(function(err, result) {
			log.info(result);
			if(err) {
				log.error(err);
				callback(err, null);
			} else {
				log.info('Running job ' + JSON.stringify(result));
				this.runJob(result);
				callback(null, result);
			}
		}.bind(this));
	}
	else {
		callback("Cannot run next job: Driver is disconnected.");
	}
};

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
	log.debug('machine jog');
	if((this.status.state === "idle") || (this.status.state === "manual")) {
		this.setRuntime(this.manual_runtime);
		this.current_runtime.jog(direction);

	} else {
		typeof callback === "function" && callback(true, "Cannot jog when in '" + this.status.state + "' state.");
	}

};

Machine.prototype.fixed_move = function(direction,step, callback) {
	if((this.status.state === "idle") || (this.status.state === "manual")) {
		this.setRuntime(this.manual_runtime);
		this.current_runtime.fixed_move(direction,step);

	} else {
		typeof callback === "function" && callback(true, "Cannot move by step when in '" + this.status.state + "' state.");
	}

};



Machine.prototype.setRuntime = function(runtime) {
	if(this.current_runtime != runtime) {
		try {
			this.current_runtime.disconnect();
		} catch (e) {

		} finally {
			this.current_runtime = runtime;
			if(runtime) {
				runtime.connect(this);
			}
		}
	}
};

Machine.prototype.setState = function(source, newstate) {
	if ((source === this) || (source === this.current_runtime)) {
		this.status.state = newstate;
		log.info("Got a machine state change: " + newstate)		
	} else {		
		log.warn("Got a state change from a runtime that's not the current one. (" + source + ")")
	}
};

Machine.prototype.stopJog = function() {
	this.current_runtime.stopJog();
};

Machine.prototype.pause = function() {
	if(this.status.state === "running") {
		this.current_runtime.pause();
	}
};

Machine.prototype.quit = function() {
	if(this.status.job) {
		this.status.job.pending_cancel = true;
	}
	this.current_runtime.quit();
};

Machine.prototype.resume = function() {
	this.driver.resume();
};

Machine.prototype.enable_passthrough = function(callback) {
	log.info("enable passthrough");
	if(this.status.state === "idle"){
		this.setState("passthrough");
		this.setRuntime(this.passthrough_runtime);
		typeof callback === "function" && callback(false);
	}
	else{
		typeof callback === "function" && callback(true, "Cannot jog when in '" + this.status.state + "' state.");
	}
};

Machine.prototype.disable_passthrough = function(string) {
	log.info("disable passthrough");
	this.setRuntime(this.gcode_runtime);
};

exports.connect = connect;
