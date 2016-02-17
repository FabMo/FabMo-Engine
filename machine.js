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
var IdleRuntime = require('./runtime/idle').IdleRuntime;

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
		job : null,
		info : null,
		unit : 'mm',
		line : null,
		nb_lines : null
	};

	this.driver = new g2.G2();
	this.driver.on("error", function(err) {log.error(err);});

	this.driver.connect(control_path, gcode_path, function(err, data) {
	
	    // Set the initial state based on whether or not we got a valid connection to G2
	    if(err){
	    	log.warn("Setting the disconnected state");
		    this.status.state = 'not_ready';
	    } else {
		    this.status.state = 'idle';
	    }

	    // Create runtimes for different functions/command languages
	    this.gcode_runtime = new GCodeRuntime();
	    this.sbp_runtime = new SBPRuntime();
	    this.manual_runtime = new ManualRuntime();
	    this.passthrough_runtime = new PassthroughRuntime();
	    this.idle_runtime = new IdleRuntime();

	    // Idle 
	    this.setRuntime(this.idle_runtime);

	    if(err) {
		    typeof callback === "function" && callback(err);
	    } else {
		    this.driver.requestStatusReport(function(result) {
		    	if('stat' in result) {
		    		switch(result.stat) {
		    			case g2.STAT_INTERLOCK:
		    			case g2.STAT_SHUTDOWN:
		    			case g2.STAT_PANIC:
		    				this.die('A G2 exception has occurred. You must reboot your tool.');
		    				break;
		    		}
		    	}
			    typeof callback === "function" && callback(null, this);
		    }.bind(this));
	    }

    }.bind(this));

    config.driver.on('change', function(update) {
    	['x','y','z','a','b'].forEach(function(axis) {
    		var mode = axis + 'am';
    		var pos = 'pos' + axis;
    		if(mode in update) {
    			if(update[mode] === 0) {
    				log.debug('Disabling display for ' + axis + ' axis.');
    				delete this.status[pos];
    			} else {
    				log.debug('Enabling display for ' + axis + ' axis.');
    				this.status[pos] = 0;
    			}
    		}
    	}.bind(this));
    }.bind(this));
}
util.inherits(Machine, events.EventEmitter);

Machine.prototype.die = function(err_msg) {
	this.setState(this, 'dead', {error : 'A G2 exception has occurred. You must reboot your tool.'});
	this.emit('status',this.status);
}

Machine.prototype.isConnected = function() {
	return this.status.state !== 'not_ready';
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
	this.status.job = new Job({
		name : 'OpenSBP String',
		description : 'Direct OpenSBP String Command'
	});
	this.status.job.start(function(err, result) {
		this.current_runtime.runString(string);
	}.bind(this));
};

Machine.prototype.runJob = function(job) {
	this.status.job = job;
	db.File.getByID(job.file_id,function(err, file){
		if(err) {
			// TODO deal with no file found
		} else {
			log.info("Running file " + file.path);
			this.runFile(file.path);			
		}
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
		callback(new Error("Cannot run next job: Driver is disconnected."));
	}
};

Machine.prototype.getGCodeForFile = function(filename, callback) {
	fs.readFile(filename, 'utf8', function (err,data) {
		if (err) {
			log.error('Error reading file ' + filename);
				log.error(err);
				return;
		} else {
			parts = filename.split(path.sep);
			ext = path.extname(filename).toLowerCase();

			if(ext == '.sbp') {
				if(this.status.state != 'idle') {
					return callback(new Error('Cannot generate G-Code from OpenSBP while machine is running.'));
				}
				this.setRuntime(null);
				this.sbp_runtime.simulateString(data, callback);
			} else {
				fs.readFile(filename, callback);
			}
		}
	}.bind(this));
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

			if(ext == '.sbp') {
				this.setRuntime(this.sbp_runtime);
			} else {
				this.setRuntime(this.gcode_runtime);
			}
			this.current_runtime.runString(data);
		}
	}.bind(this));
};


Machine.prototype.executeRuntimeCode = function(runtimeName, code) {
	runtime = this.getRuntime(runtimeName);
	if(runtime) {
		this.setRuntime(runtime);
		runtime.executeCode(code);
	}
}

Machine.prototype.setRuntime = function(runtime) {
	log.info("Setting runtime to " + runtime)
	if(runtime) {
		if(this.current_runtime && this.current_runtime != runtime) {
			this.current_runtime.disconnect();					
		}
		if(this.current_runtime != runtime) {
			runtime.connect(this);
			this.current_runtime = runtime;

		}
	} else {
		this.current_runtime = this.idle_runtime;
		this.current_runtime.connect(this);
	}
};

Machine.prototype.getRuntime = function(name) {
	switch(name) {
		case 'gcode':
		case 'nc':
		case 'g':
			return this.gcode_runtime;
			break;

		case 'opensbp':
		case 'sbp':
			return this.sbp_runtime;
			break;

		case 'manual':
			return this.manual_runtime;
			break;
		default:
			return null;
			break;
	}
}

Machine.prototype.setState = function(source, newstate, stateinfo) {
	if ((source === this) || (source === this.current_runtime)) {
		log.info("Got a machine state change: " + newstate)	
		this.status.state = newstate;
		if(stateinfo) {
			this.status.info = stateinfo
		} else {
			delete this.status.info
		}

		switch(this.status.state) {
			case 'idle':
				this.status.nb_lines = null;
				this.status.line = null;
				// Deliberately fall through
			case 'paused':
				this.driver.get('mpo', function(err, mpo) {
					config.instance.update({'position' : mpo});
				});
				break;
			case 'dead':
				log.error('G2 is dead!');
				break;
		}
	} else {		
		log.warn("Got a state change from a runtime that's not the current one. (" + source + ")")
	}
	this.emit('status',this.status);
};

Machine.prototype.pause = function() {
	if(this.status.state === "running") {
		if(this.current_runtime) {
			this.current_runtime.pause();
		}
	}
};

Machine.prototype.quit = function() {
	if(this.status.job) {
		this.status.job.pending_cancel = true;
	}
	if(this.current_runtime) {
		this.current_runtime.quit();
	}
};

Machine.prototype.resume = function() {
	if(this.current_runtime) {
		this.current_runtime.resume();
	}
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
	this.setRuntime(null);
};

exports.connect = connect;
