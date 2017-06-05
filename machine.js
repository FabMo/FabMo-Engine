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
var updater = require('./updater');
var u = require('./util');
var async = require('async');

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
	if(control_path) {
		exports.machine = new Machine(control_path, callback);
	} else {
		typeof callback === "function" && callback('No supported serial path for platform "' + PLATFORM + '"');
	}
}

function Machine(control_path, callback) {

	// Handle Inheritance
	events.EventEmitter.call(this);

	this.fireButtonDebounce = false;
	this.APCollapseTimer = null;

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
		out1 :0,
		out2 :0,
		out3 :0,
		out4 :0,
		out5 :0,
		out6 :0,
		out7 :0,
		out8 :0,
		job : null,
		info : null,
		unit : 'mm',
		line : null,
		nb_lines : null,
		auth : false
	};

	this.info_id = 0;

	this.driver = new g2.G2();
	this.driver.on("error", function(err) {log.error(err);});

	this.driver.connect(control_path, function(err, data) {
	    // Set the initial state based on whether or not we got a valid connection to G2
	    if(err){
				log.error(JSON.stringify(err));
	    	log.warn("Setting the disconnected state");
	    	this.die("A real bad error has occurred.")
		    if(typeof callback === "function") {
		    	return callback(new Error('No connection to G2'));
		    } else {
		    	return;
		    }
	    } else {
		    this.status.state = 'idle';
	    }

	    // Create runtimes for different functions/command languages
	    this.gcode_runtime = new GCodeRuntime();
	    this.sbp_runtime = new SBPRuntime();
	    this.manual_runtime = new ManualRuntime();
	    this.passthrough_runtime = new PassthroughRuntime();
	    this.idle_runtime = new IdleRuntime();

			this.runtimes = [
				this.gcode_runtime,
				this.sbp_runtime,
				this.manual_runtime,
				this.passthrough_runtime,
				this.idle_runtime
			]

	    // Idle
	    this.setRuntime(null, function() {
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

    this.driver.on('status', function(stat) {
    	this.handleFireButton(stat);
    	this.handleAPCollapseButton(stat);
			this.handleOkayButton(stat);
		this.handleCancelButton(stat);
    }.bind(this));
}
util.inherits(Machine, events.EventEmitter);

Machine.prototype.handleAPCollapseButton = function(stat) {
	var n =  config.machine.get('ap_input');
	if(n == 0) { return; }
	var ap_input = 'in' + n;

	// If the button has been pressed
	if(stat[ap_input]) {
		var ap_collapse_time = config.machine.get('ap_time');
		// For the first time
		if(!this.APCollapseTimer) {
			// Do an AP collapse in 10 seconds, if the button is never released
			log.debug('Starting a timer for AP mode collapse (AP button was pressed)')
			this.APCollapseTimer = setTimeout(function APCollapse() {
				log.info("AP Collapse button held for " + ap_collapse_time + " seconds.  Triggering AP collapse.");
				this.APCollapseTimer = null;
				updater.APModeCollapse();
			}.bind(this), ap_collapse_time*1000);
		}
	}
	// Otherwise
	else {
		// Cancel an AP collapse that is pending, if there is one.
		if(this.APCollapseTimer) {
			log.debug('Cancelling AP collapse (AP button was released)')
			clearTimeout(this.APCollapseTimer);
			this.APCollapseTimer = null;
		}
	}
}

Machine.prototype.handleFireButton = function(stat) {
	var auth_input = 'in' + config.machine.get('auth_input');
	if(stat[auth_input] && this.status.state === 'armed') {
		log.info("Fire button hit!")
		this.fire();
	}
}

Machine.prototype.handleOkayButton = function(stat){
	var auth_input = 'in' + config.machine.get('auth_input');
	if(stat[auth_input] && this.status.state === 'paused') {
		log.info("Okay hit!")
		this.resume();
	}
}

Machine.prototype.handleCancelButton = function(stat){
	var quit_input = 'in' + config.machine.get('quit_input');
	if(stat[quit_input] && this.status.state === 'paused') {
		log.info("Cancel hit!")
		this.quit();
	}

 }

/*
 * State Functions
 */
Machine.prototype.die = function(err_msg) {
	this.setState(this, 'dead', {error : err_msg || 'A G2 exception has occurred. You must reboot your tool.'});
	this.emit('status',this.status);
}

Machine.prototype.restoreDriverState = function(callback) {
	callback = callback || function() {};
	this.driver.setUnits(config.machine.get('units'), function() {
		config.driver.restore(callback);
	}.bind(this));
}

Machine.prototype.arm = function(action, timeout) {
	console.log(action)
	switch(this.status.state) {
		case 'idle':
		break;

		case 'paused':
		case 'stopped':
			if(action.type != 'resume') {
				throw new Error('Cannot arm the machine for ' + action.type + ' when ' + this.status.state);
			}
			break;
		default:
		throw new Error("Cannot arm the machine from the " + this.status.state + " state.");
		break;
	}

	delete this.status.info
	this.action = action;
	log.info("Arming the machine" + (action ? (' for ' + action.type) : '(No action)'));
	//log.error(new Error())
	if(this._armTimer) { clearTimeout(this._armTimer);}
	this._armTimer = setTimeout(function() {
		log.info('Arm timeout (' + timeout + 's) expired.');
		this.disarm();
	}.bind(this), timeout*1000);

	this.preArmedState = this.status.state;
	this.preArmedInfo = this.status.info;

	var requireAuth = config.machine.get('auth_required');

	if(!requireAuth) {
		log.info("Firing automatically since authorization is disabled.");
		this.fire(true);
	} else {
		this.setState(this, 'armed');
		this.emit('status', this.status);
	}
}

Machine.prototype.disarm = function() {
	if(this._armTimer) { clearTimeout(this._armTimer);}
	this.action = null;
	this.fireButtonDebounce = false;
	if(this.status.state === 'armed') {
		this.setState(this, this.preArmedState || 'idle', this.preArmedInfo);
	}
}

Machine.prototype.fire = function(force) {
	if(this.fireButtonDebounce & !force) {
		log.debug("Fire button debounce reject.");
		return;
	}

	this.fireButtonDebounce = true;

	if(this._armTimer) { clearTimeout(this._armTimer);}
	if(this._authTimer) { clearTimeout(this._authTimer);}

	if(this.status.state != 'armed' && !force) {
		throw new Error("Cannot fire: Not armed.");
	}

	// If no action, we're just authorizing for the next auth timeout
	if(!this.action) {
		this.authorize(config.machine.get('auth_timeout'));
		this.setState(this, 'idle');
		return;
	}

	this.deauthorize();
	var action = this.action;
	this.action = null;
	switch(action.type) {
		case 'nextJob':
			log.debug("Firing a nextJob")
			this._runNextJob(force, function() {});
			break;

		case 'runtimeCode':
			log.debug("Firing a runtimeCode")
			var name = action.payload.name
			var code = action.payload.code
			this._executeRuntimeCode(name, code);
			break;

		case 'runFile':
			log.debug("Firing a runFile")
			var filename = action.payload.filename
			this._runFile(filename);
			break;
		case 'resume':
			log.debug("Firing a resume")
			this._resume();
			break;
	}
}

Machine.prototype.authorize = function(timeout) {
	var timeout = timeout || config.machine.get('auth_timeout');
	if(timeout) {
		log.info("Machine is authorized for the next " + timeout + " seconds.");
		if(this._authTimer) { clearTimeout(this._authTimer);}
		this._authTimer = setTimeout(function() {
			log.info('Authorization timeout (' + timeout + 's) expired.');
			this.deauthorize();
		}.bind(this), timeout*1000);
	} else {
		if(!this.status.auth) {
			log.info("Machine is authorized indefinitely.");
		}
	}
	this.status.auth = true;
	//this.setState(this, 'idle');
	if(this.status.info && this.status.info.auth) {
		delete this.status.info;
	}
	this.emit('status', this.status);
}

Machine.prototype.deauthorize = function() {
	if(!config.machine.get('auth_timeout')) { return; }
	if(this._authTimer) {
		clearTimeout(this._authTimer);
	}
	log.info('Machine is deauthorized.');
	this.status.auth = false;
	this.emit('status', this.status);
}

Machine.prototype.isConnected = function() {
	return this.status.state !== 'not_ready' && this.status.state !== 'dead';
};

Machine.prototype.disconnect = function(callback) {
	this.driver.disconnect(callback);
};

Machine.prototype.toString = function() {
	return "[Machine Model on '" + this.driver.path + "']";
};

Machine.prototype.runJob = function(job) {
	db.File.getByID(job.file_id,function(err, file){
		if(err) {
			// TODO deal with no file found
		} else {
			log.info("Running file " + file.path);
			this.status.job = job;
			this._runFile(file.path);
		}
	}.bind(this));
};


Machine.prototype.setPreferredUnits = function(units, callback) {
	try {
		if(config.driver.changeUnits) {
			units = u.unitType(units);
			var uv = null;
 			switch(units) {
				case 'in':
					log.info("Changing default units to INCH");
					uv = 0;
					break;

				case 'mm':
					log.info("Changing default units to MM");
					uv = 1;
				break;

				default:
					log.warn('Invalid units "' + gc + '"found in machine configuration.');
				break;
			}
			if(uv !== null) {

				// Change units on the driver
				config.driver.changeUnits(uv, function(err, data) {
					log.info("Done setting driver units")
					// Change units on each runtime in turn
					async.eachSeries(this.runtimes, function runtime_set_units(item, callback) {
						log.info("Setting preferred units for " + item)
						if(item.setPreferredUnits) {
							return item.setPreferredUnits(uv, callback);
						}
						callback();
					}.bind(this), callback);
				}.bind(this));
			}
		} else {
			return callback(null);
		}
	}
	catch (e) {
		log.warn("Couldn't access driver configuration...");
		log.error(e)
		try {
			this.driver.setUnits(uv);
		} catch(e) {
			callback(e);
		}
	}
}

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
				this.setRuntime(null, function() {});
				this.sbp_runtime.simulateString(data, callback);
			} else {
				fs.readFile(filename, callback);
			}
		}
	}.bind(this));
}

Machine.prototype._runFile = function(filename) {
	var parts = filename.split(path.sep);
	var ext = path.extname(filename).toLowerCase();

	// Choose the appropriate runtime based on the file extension
	var runtime = this.gcode_runtime;
	if(ext === '.sbp') {
		runtime = this.sbp_runtime;
	}

	// Set the appropriate runtime
	this.setRuntime(runtime, function(err, runtime) {
		if(err) {
			return log.error(err);
		}
		runtime.runFile(filename);
	});
};

Machine.prototype.setRuntime = function(runtime, callback) {
	try {
		if(runtime) {
			if(this.current_runtime != runtime) {
				if(this.current_runtime) {
					this.current_runtime.disconnect();
				}
				runtime.connect(this);
				this.current_runtime = runtime;
			}
		} else {
			this.current_runtime = this.idle_runtime;
			this.current_runtime.connect(this);
		}

	} catch(e) {
		log.error(e)
		setImmediate(callback, e);
	}
	setImmediate(callback,null, runtime);
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
	this.fireButtonDebounce = false ;
	if ((source === this) || (source === this.current_runtime)) {
		log.info("Got a machine state change: " + newstate)

		if(stateinfo) {
			this.status.info = stateinfo
			this.info_id += 1;
			this.status.info.id = this.info_id;
		} else {
			delete this.status.info
		}

		switch(newstate) {
			case 'idle':
				if(this.status.state != 'idle') {
					//this.driver.command({"out4":0});
					//if(this.runtime != this.idle_runtime) {
					//	this.setRuntime(null, function() {});
					//}
				}
				this.status.nb_lines = null;
				this.status.line = null;
				if(this.action) {
					switch(this.action.type) {
						case 'nextJob':
						break;
						default:
							this.authorize();
							break;
					}
				}
				this.action = null;
				// Deliberately fall through
			case 'paused':
                if(this.status.state != newstate) {
                    this.driver.get('mpo', function(err, mpo) {
					    if(config.instance) {
						    config.instance.update({'position' : mpo});
					    }
				    });
                }
				break;
			case 'dead':
				log.error('G2 is dead!');
				break;
			default:
                //this.driver.command({"out4":1});
				break;
		}

		this.status.state = newstate;
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
	console.log("QUITTING AT THE MACHINE LEVEL")
    this.disarm();
	// Quitting from the idle state dismisses the 'info' data
	if(this.status.state === "idle") {
		delete this.status.info;
		this.emit('status', this.status);
	}

	// Cancel the currently running job, if there is one
	if(this.status.job) {
		this.status.job.pending_cancel = true;
	}
	if(this.current_runtime) {
		log.info("Quitting the current runtime...")
		this.current_runtime.quit();
	} else {
		log.warn("No current runtime!")
	}
};

Machine.prototype.resume = function() {
	this.arm({
		type : 'resume'
	}, config.machine.get('auth_timeout'));
}

Machine.prototype.runFile = function(filename) {
	this.arm({
		type : 'runFile',
		payload : {
			filename : filename
		}
	}, config.machine.get('auth_timeout'));
}

Machine.prototype.runNextJob = function(callback) {
	db.Job.getPending(function(err, pendingJobs) {
		if(err) {
			return callback(err);
		}
		if(pendingJobs.length > 0) {
			this.arm({
				type : 'nextJob'
			}, config.machine.get('auth_timeout'));
			callback();
		} else {
			callback(new Error('No pending jobs.'));
		}
	}.bind(this));
}

Machine.prototype.executeRuntimeCode = function(runtimeName, code) {
	runtime = this.getRuntime(runtimeName);
	var needsAuth = runtime.needsAuth(code);
	if (needsAuth){
		if(this.status.auth) {
			return this._executeRuntimeCode(runtimeName, code);
		}
		if(runtimeName === 'manual') {
			this.arm(null, config.machine.get('auth_timeout'));
			return;
		} else {
			this.arm({
				type : 'runtimeCode',
				payload : {
					name : runtimeName,
					code : code
				}
			}, config.machine.get('auth_timeout'));
		}
	} else {
		this._executeRuntimeCode(runtimeName, code);
	}
}

Machine.prototype.sbp = function(string) {
	this.executeRuntimeCode('sbp', string);

}

Machine.prototype.gcode = function(string) {
	this.executeRuntimeCode('gcode', string);
}

/*
 * Functions below require authorization to run
 * Don't call them unless the tool is authorized!
 */
Machine.prototype._executeRuntimeCode = function(runtimeName, code, callback) {
	runtime = this.getRuntime(runtimeName);
	if(runtime) {
		this.setRuntime(runtime, function(err, runtime) {
			if(err) {
				log.error(err);
			} else {
				runtime.executeCode(code);
			}
		}.bind(this));
	}
}

Machine.prototype._resume = function() {
	if(this.current_runtime) {
		this.current_runtime.resume();
	}
};

Machine.prototype._runNextJob = function(force, callback) {
	if(this.isConnected()) {
		if(this.status.state === 'armed' || force) {
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
		} else {
			callback(new Error("Cannot run next job: Machine not idle"));
		}
	} else {
		callback(new Error("Cannot run next job: Driver is disconnected."));
	}
};

exports.connect = connect;
