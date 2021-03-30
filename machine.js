/*
 * machine.js
 *
 * Defines the "machine model" which is an abstraction of the physical machine that lives
 * sort of one layer up from the G2 driver.  It maintains a "machine state" that is similar to, but
 * not the same as G2s internal state, and provides functions for high level machine operations.
 *
 * The machine model includes the important concept of runtimes, which are individual software components
 * that get control of the machine for performing certain actions.  Runtimes are important for compartmentalizing
 * different ways of controlling the machine.  Manually driving the machine with a pendant, for example is
 * a very different sort of activity from running a g-code file, so those two activities are implemented 
 * by two separate runtimes that each get a chance to take control of the machine when it is time to perform
 * their respective tasks.
 * 
 * This module also sort of "meta manages" the motion systems state.  An example
 * of this is that G2 has digital inputs defined, and can specify their input mode and basic function, but the 
 * machine model might layer some additional function on top of them, such as their higher-level application
 * - perhaps acting as a door interlock, a tool release button, etc.
 *
 * The machine model is a singleton.  There is only ever one of them, which is instantiated by the connect() method.
 */
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
var canQuit = false;
var canResume = false;
var clickDisabled = false;
var interlockBypass = false;

// Load up all the runtimes that are currently defined
// TODO - One day, a folder-scan and auto-registration process might be nice here, this is all sort of hand-rolled.
var GCodeRuntime = require('./runtime/gcode').GCodeRuntime;
var SBPRuntime = require('./runtime/opensbp').SBPRuntime;
var ManualRuntime = require('./runtime/manual').ManualRuntime;
var PassthroughRuntime = require('./runtime/passthrough').PassthroughRuntime;
var IdleRuntime = require('./runtime/idle').IdleRuntime;

// Instantiate a machine, connecting to the serial port specified in the engine configuration.
// TODO: We probably don't need special keys in the config for each platform anymore.  Since the engine
//       does its first-time config platform-detecting magic (See engine.js) these ports are likely to
//       be filled with sensible defaults
function connect(callback) {

	// TODO: These are hardwired for a time when there were two USB channels - there is only one, now.
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
		// TODO - I dunno, this is sort of a weird pattern
		exports.machine = new Machine(control_path, callback);
	} else {
		typeof callback === "function" && callback('No supported serial path for platform "' + PLATFORM + '"');
	}
}

function Machine(control_path, callback) {

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
		in9 : 1,
		in10 : 1,
		in11 : 1,
		in12 : 1,
		spc : 0,
		out1 :0,
		out2 :0,
		out3 :0,
		out4 :0,
		out5 :0,
		out6 :0,
		out7 :0,
		out8 :0,
		out9 :0,
		out10 :0,
		out11 :0,
		out12 :0,
		job : null,
		info : null,
		unit : 'mm',
		line : null,
		nb_lines : null,
		auth : false,
		hideKeypad : false
	};

	this.fireButtonDebounce = false;
	this.APCollapseTimer = null;
	this.quit_pressed = 0;
	this.fireButtonPressed =0; 
	this.info_id = 0;
	this.action = null;
	this.interlock_action = null;
	this.pauseTimer = false;
	
	// Instantiate and connect to the G2 driver using the port specified in the constructor
	this.driver = new g2.G2();
	this.driver.on("error", function(err) {log.error(err);});

	this.driver.connect(control_path, function(err, data) {
		// Most of the setup of the machine happens here, AFTER we've successfully connected to G2
	    if(err){
			log.error(JSON.stringify(err));
	    	log.warn("Setting the disconnected state");
	    	this.die("An internal error has occurred. You must reboot your tool.")  // RealBad (tm) Error
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

	    // The machine only has one "active" runtime at a time.  When it's not doing anything else
	    // the active runtime is the IdleRuntime (setRuntime(null) sets the IdleRuntime)
	    this.setRuntime(null, function(err) {
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

	// If any of the axes in G2s configuration become enabled or disabled, we want to show or hide
	// them accordingly.  These change events happen even during the initial configuration load, so
	// right from the beginning, we will be displaying the correct axes.
	// TODO - I think it's good to used named callbacks, to make the code more self-documenting
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

    // This handler deals with inputs that are selected for special functions (authorize, ok, quit, etc)
    this.driver.on('status', function(stat) {
		var auth_input = 'in' + config.machine.get('auth_input');
		var quit_input = 'in' + config.machine.get('quit_input');
		var ap_input = 'in' + config.machine.get('ap_input');
		var interlock_input = 'in' + config.machine.get('interlock_input');
		
		// If you press a button to pause, you're not allowed to resume or quit for at least a second
		// (To eliminate the chance of a double-tap doing something you didn't intend.)
		if(this.status.state === "paused"){
			setTimeout(function(){
				 canQuit = true;
				 canResume = true;
			}, 1000);
		} else {
			canQuit = false;
			canResume = false;
		}

		// Handle okay and cancel buttons.
		// Auth = OK
		// Quit = Cancel
		// If okay/cancel 
		if(auth_input === quit_input){
			this.handleOkayCancelDual(stat, auth_input)
		}else {
			this.handleOkayButton(stat, auth_input);
			this.handleCancelButton(stat, quit_input);
			
		}

		// Other functions
		this.handleFireButton(stat, auth_input);
		this.handleAPCollapseButton(stat, ap_input);
		
    }.bind(this));
}
util.inherits(Machine, events.EventEmitter);

// Given the status report provided and the specified input, perform the AP Mode Collapse behavior if necessary
// The AP mode collapse is a network failsafe.  In the case that a tool gets "lost" on a network, it can be 
// provoked back into AP mode by holding down a specific button for some time.  Both the input to use for the
// button and the hold-down duration are specified in the machine settings
Machine.prototype.handleAPCollapseButton = function(stat, ap_input) {

	// If the button has been pressed
	if(stat[ap_input]) {
		var ap_collapse_time = config.machine.get('ap_time');
		// For the first time
		if(!this.APCollapseTimer) {
			// Do an AP collapse in ap_collapse_time seconds, if the button is never released
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

// Given the status report and specified input, process the okay/cancel behavior
// This function is called only when the ok button (authorize) and cancel button (quit)
// are assigned to the same input.  The behavior in that case is slightly 
// different than if they were separate. (see below)
Machine.prototype.handleOkayCancelDual = function(stat, quit_input) {

	//this may be changed to user select wether to continue or to cancel
	if(!stat[quit_input] && this.status.state === 'paused' && canQuit && this.quit_pressed) {
		log.info("Cancel hit!")
		this.quit(function(err, msg){
			if(err){
				log.error(err);
			} else {
				log.info(msg);
			}
		});
	} else if(this.status.state === 'interlock' && this.quit_pressed) {
		log.info("Okay hit, resuming from interlock")
		this.resume(function(err, msg){
			if(err){
				log.error(err);
			} else {
				log.info(msg);
			}
		});
	}
	this.quit_pressed = stat[quit_input];
}

// Given the status report and specified input, process the "fire" behavior
// The machine has a state of being "armed" - either with an action, or when preparing to 
// go into an authorized state.  Pressing "fire" while armed either executes the action, or
// puts the system in an authorized state for the authorization period.
Machine.prototype.handleFireButton = function(stat, auth_input) {
	if(this.fireButtonPressed && !stat[auth_input] && this.status.state === 'armed') {
		log.info("Fire button hit!")
		this.fire();
	}
	this.fireButtonPressed = stat[auth_input]
}

// Given the status report and specified input process the "okay" behavior
// Hitting the "okay" button on the machine essentially causes it to behave as if you had
// hit the okay/resume in the dashboard UI.  It is a convenience that prevents you from 
// having to return to the dashboard just to confirm an action at the tool.
Machine.prototype.handleOkayButton = function(stat, auth_input){
	
	if(stat[auth_input]){
		
		if (clickDisabled){
			log.info("Can't hit okay now");
			return
		}

		if(this.status.state === 'paused' && canResume) {
			log.info("Okay hit, resuming from pause")
			this.resume(function(err, msg){
				if(err){
					log.error(err);
				} else {
					log.info(msg);
				}
			});
			clickDisabled = true;
			setTimeout(function(){clickDisabled = false;}, 2000);
		} else if(this.status.state === 'interlock') {
			log.info("Okay hit, resuming from interlock")
			this.resume(function(err, msg){
				if(err){
					log.error(err);
				} else {
					log.info(msg);
				}
			});
		}

	}
}

Machine.prototype.handleCancelButton = function(stat, quit_input){

	if(stat[quit_input] && this.status.state === 'paused' && canQuit) {
		log.info("Cancel hit!")
		this.quit(function(err, msg){
			if(err){
				log.error(err);
			} else {
				log.info(msg);
			}
		});
	}

 }

/*
 * State Functions
 */
Machine.prototype.die = function(err_msg) {
	this.setState(this, 'dead', {error : err_msg || 'A G2 exception has occurred. You must reboot your tool.'});
	this.emit('status',this.status);
}

// This function restores the driver configuration to what is stored in the g2 configuration on disk
// It is typically used after, for instance, a running file has altered the configuration in memory.
// This is used to ensure that when the machine returns to idle the driver is in a "known" configuration
Machine.prototype.restoreDriverState = function(callback) {
	callback = callback || function() {};
	this.driver.setUnits(config.machine.get('units'), function() {
		this.driver.requestStatusReport(function(status) {
			for (var key in this.status) {
				if(key in status) {
					this.status[key] = status[key];
				}
			}			
			config.driver.restore(function() {
				callback();
			});			
		}.bind(this));
	}.bind(this));
}

// "Arm" the machine with the specified action. The armed state is abandoned after the timeout expires.  
//   action - The action to execute when fire() is called.  Can be null. 
//            If null, the action will be to "authorize" the tool for subsequent actions for the authorization
//            period which is specified in the settings.
//   timeout - The number of seconds that the system should remain armed
Machine.prototype.arm = function(action, timeout) {

	// It's a real finesse job to get authorize to play nice with interlock, etc.
	var requireAuth = config.machine.get('auth_required');
	switch(this.status.state) {
		case 'idle':
			this.interlock_action = action;
		break;
		case 'interlock':
			requireAuth = false;
			action = this.interlock_action || action;
		break;
		case 'manual':
			if(action == null || (action.type == 'runtimeCode' && action.payload.name == 'manual')) {
				break;
			}
			throw new Error('Cannot arm machine for ' + action.type + 'from the manual state')
			break;
		case 'paused':
		case 'stopped':
			if(action.type != 'resume') {
				log.debug("===>In machine at case stopped, over-ride here???")
				throw new Error('Cannot arm the machine for ' + action.type + ' when ' + this.status.state);
			}
			break;
		default:
		throw new Error("Cannot arm the machine from the " + this.status.state + " state.");
		break;
	}

	// The info object contains any dialogs that are displayed in the dash.
	delete this.status.info

	// Set the action to be executed when fire() is called
	this.action = action;

	// Check to see if interlock is required
	var interlockRequired = config.machine.get('interlock_required');
	var interlockInput = 'in' + config.machine.get('interlock_input');
	if(this.action && this.action.payload && this.action.payload.name === 'manual' || interlockBypass) {
		interlockRequired = false;
	}

	// Refuse the action if the interlock is required and tripped
	if(this.action) {
		if(interlockRequired && this.driver.status[interlockInput]) {
			this.setState(this, 'interlock')
			return;			
		}
	} 

	// Otherwise, arm the machine and set the timer to the provided value
	log.info("Arming the machine" + (action ? (' for ' + action.type) : '(No action)'));
	//log.error(new Error())
	if(this._armTimer) { clearTimeout(this._armTimer);}
	this._armTimer = setTimeout(function() {
		log.info('Arm timeout (' + timeout + 's) expired.');
		this.disarm();
	}.bind(this), timeout*1000);

	// Record the state we were in before arming, so we can fall back to it if the timer runs out
	this.preArmedState = this.status.state;
	// TODO - we trashed this info above - worth looking at why this is here
	this.preArmedInfo = this.status.info;

	// Actions related to the manual state get fired immediately
	if(action.payload)  {
		if(action.payload.name === "manual"){
			var cmd = action.payload.code.cmd;
			switch(cmd) {
				case 'set':
				case 'exit':
				case 'start':
				case 'fixed':
				case 'stop':
				case 'goto':
					this.fire(true);
					return;
					break;
			}
		}
	}

	if(!requireAuth) {
		log.info("Firing automatically since authorization is disabled.");
		this.fire(true);
	} else {
		this.setState(this, 'armed');
		this.emit('status', this.status);
	}
}

// Collapse out of the armed state.  Happens when the user hits cancel in the authorize dialog.
Machine.prototype.disarm = function() {
	log.stack();
	if(this._armTimer) { clearTimeout(this._armTimer);}
	this.action = null;
	this.fireButtonDebounce = false;
	if(this.status.state === 'armed') {
		this.setState(this, this.preArmedState || 'idle', this.preArmedInfo);
	}
}

// Execute the action in the chamber (the one passed to the arm() method)
Machine.prototype.fire = function(force) {
	if(this.fireButtonDebounce & !force) {
		log.debug("Fire button debounce reject.");
		log.debug("debounce: " + this.fireButtonDebounce + " force: " + force);
		return;
	}
	this.fireButtonDebounce = true;

	// Clear the timers related to authorization 
	// (since we're either going to execute this thing or bounce, those will need to be reset)
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

	// We deauthorize the machine as soon as we're executing an action
	// that way, when the action is concluded, the user has to reauthorize again.
	// TODO - re-evaluate this decision.  The idea here is that once an action is kicked off, once it's 
	//        completed there's a good chance that the user might not be close to the machine anymore.
	//        many actions take less than the authorization timeout, though, so in those cases, this causes
	//        incessant authorization prompts.
	this.deauthorize();
	
	var action = this.action;
	this.action = null;

	// Actually execute the action (finally!)
	switch(action.type) {
		case 'nextJob':
			this._runNextJob(force, function() {});
			break;

		case 'runtimeCode':
			var name = action.payload.name
			var code = action.payload.code
			this._executeRuntimeCode(name, code);
			break;

		case 'runFile':
			var filename = action.payload.filename
			this._runFile(filename);
			break;

		case 'resume':
			this._resume(action.input);
			break;
	}
}

// Authorize the machine for the specified period of time (or the default time if unspecified)
Machine.prototype.authorize = function(timeout) {
	var timeout = timeout || config.machine.get('auth_timeout');

	// 
	if(config.machine.get('auth_required') && timeout) {
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

	// Once authorized, clear info (which contains the auth message)
	if(this.status.info && this.status.info.auth) {
		delete this.status.info;
	}

	// Report status back to the host (since the auth state has changed)
	this.emit('status', this.status);
}

// Clear the authorized state (forbid action without a reauthorize)
Machine.prototype.deauthorize = function() {
	if(!config.machine.get('auth_timeout')) { return; }
	if(this._authTimer) {
		clearTimeout(this._authTimer);
	}
	log.info('Machine is deauthorized.');
	this.status.auth = false;
	// Not needed and causes back to back pauses to behave irregularly.
	// this.emit('status', this.status);
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

// Run the provided Job object (see db.js)
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

// Set the preferred units to the provided value ('in' or 'mm')
// Changing the preferred units is a heavy duty operation. See below.
Machine.prototype.setPreferredUnits = function(units, callback) {
	try {
		if(config.driver.changeUnits) {
			units = u.unitType(units); // Normalize units
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

// Retrieve the G-Code output for a specific file ID.
// If the file is a g-code file, just return its contents.
// If the file is a shopbot file, instantiate a SBPRuntime, run it in simulation, and return the result
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
				/*
				if(this.status.state != 'idle') {
					return callback(new Error('Cannot generate G-Code from OpenSBP while machine is running.'));
				}*/ 

				//this.setRuntime(null, function() {});

				(new SBPRuntime()).simulateString(data, callback);
			} else {
				fs.readFile(filename, callback);
			}
		}
	}.bind(this));
}

// Run a file given a filename on disk.  Choose the runtime that is appropriate for that file.
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

// Set the active runtime
// If the selected runtime is different than the current one,
// disconnect the current one, and connect the new one.
Machine.prototype.setRuntime = function(runtime, callback) {
	runtime = runtime || this.idle_runtime;
	try {
		if(runtime) {
			if(this.current_runtime != runtime) {
				if(this.current_runtime) {
					this.current_runtime.disconnect();
				}
				this.current_runtime = runtime;
				runtime.connect(this);
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

// Return a runtime object given a name
// TODO - these names should be properties of the runtimes themselves, and we should look-up that way
//        (cleaner and better compartmentalized)
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

// Change the overall machine state
// source - The runtime requesting the change
// newstate - The state to transition to
// stateinfo - The contents of the 'info' field of the status report, if needed.
Machine.prototype.setState = function(source, newstate, stateinfo) {
	this.fireButtonDebounce = false ;
	
	if ((source === this) || (source === this.current_runtime)) {
		log.info("Got a machine state change: " + newstate)
	
		// Set the info field
		// status.info.id is the info field id - it helps the dash with display of dialogs
		if(stateinfo) {
			this.status.info = stateinfo
			this.info_id += 1;
			this.status.info.id = this.info_id;
		} else {
			// If the info field is unspecified, we clear the one that's currently in place
			delete this.status.info
		}

		switch(newstate) {
			case 'idle':
				if(this.status.state != 'idle') {
					this.driver.command({"out4":0}); // Permissive relay
					// A switch to the 'idle' state means we change to the idle runtime
					if(this.current_runtime != this.idle_runtime) {
						this.setRuntime(null, function() {});
					}	
				}
				// Clear the fields that describe a running job
				this.status.nb_lines = null;
				this.status.line = null;

				// TODO - What's going on here?
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

				// If we're changing from a non-idle state to the idle state
				// Go ahead and request the current machine position and write it to disk.  This 
				// is done regularly, so that if the machine is powered down it retains the current position
				if(this.status.state != newstate) {
                    this.driver.get('mpo', function(err, mpo) {
					    if(config.instance) {
						    config.instance.update({'position' : mpo});
					    }
				    });
                }
				break;
			case 'paused':
                if(this.status.state != newstate) {
                	//set driver in paused state
                	// log.debug('paused state: pause_hold is:  ' + this.driver.pause_hold);
                	this.driver.pause_hold = true;
                	// log.debug('paused state: pause_hold set to:  ' + this.driver.pause_hold);

                	// Save the position to the instance configuration.  See note above.
                    this.driver.get('mpo', function(err, mpo) {
					    if(config.instance) {
						    config.instance.update({'position' : mpo});
					    }
				    });
				    // Check the interlock and switch to the interlock state if it's engaged
				    var interlockRequired = config.machine.get('interlock_required');
					var interlockInput = 'in' + config.machine.get('interlock_input');
					
				    if(interlockRequired && this.driver.status[interlockInput] && !interlockBypass) {
						log.stack();
						this.interlock_action = null;
						this.setState(this, 'interlock')		
						return
					}
                } 
				break;
			case 'dead':
				// Sadness
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
	if (this.status.info && this.status.info['timer']){
		this.pauseTimer = setTimeout(function() {
	        this.resume(function(err, msg){
				if(err){
					log.error(err);
				} else {
					log.info(msg);
				}
			});
			this.pauseTimer = false;
	    }.bind(this), this.status.info['timer'] * 1000);
	};
};

// Pause the machine
// This is pretty much passed through to whatever runtime is currently in control
Machine.prototype.pause = function(callback) {
		if(this.status.state === "running") {
			if(this.current_runtime) {
				this.current_runtime.pause();
				callback(null, 'paused');
			} else {
				callback("Not pausing because no runtime provided");
			}
		} else {
			callback("Not pausing because machine is not running");
		}
};

// Quit 
Machine.prototype.quit = function(callback) {
		// Release Pause hold if present
		this.driver.pause_hold = false;
		this.disarm();

		// Quitting from the idle state dismisses the 'info' data
		switch(this.status.state) {

			case "idle":
				delete this.status.info;
				this.emit('status', this.status);
				break;

			case "interlock":
				this.action = null;
				this.setState(this, 'idle');
				break;
		}
	
		// Cancel the currently running job, if there is one
		if(this.status.job) {
			this.status.job.pending_cancel = true;
		}
		if(this.current_runtime) {
			log.info("Quitting the current runtime...")
			this.current_runtime.quit();
			callback(null, 'quit');
			alreadyQuiting = false;
		} else {
			log.warn("No current runtime!")
			callback("Not quiting because no current runtime")
		}    
};

// Resume from the paused state.
Machine.prototype.resume = function(callback, input=false) {
	if (this.driver.pause_hold) {
		//Release driver pause hold
		// log.debug("Resume from pause: pause_hold is:  " + this.driver.pause_hold);
		this.driver.pause_hold = false;
		// log.debug("Resume from pause: pause_hold set to:  " + this.driver.pause_hold);
	}
	if (this.current_runtime && this.current_runtime.inFeedHold){
		this._resume();
	} else {
		//clear any timed pause
		if (this.pauseTimer) {
			clearTimeout(this.pauseTimer);
			this.pauseTimer = false;
		}
		this.arm({
			'type' : 'resume',
			'input' : input
		}, config.machine.get('auth_timeout'));
    	callback(null, 'resumed');
	}
}

// Run a file from disk
// filename - full path to the file to run
Machine.prototype.runFile = function(filename, bypassInterlock) {
	interlockBypass = bypassInterlock;
	if(!bypassInterlock){
		interlockBypass = false;		
	}
	this.arm({
		type : 'runFile',
		payload : {
			filename : filename
		}
	}, config.machine.get('auth_timeout'));
}

// Run the next job in the queue
// callback is called when the tool is armed for the run, NOT when the job is complete.
Machine.prototype.runNextJob = function(callback) {
	interlockBypass = false;
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

// Executes a "code" on a specific runtime.
// runtimeName - the name of a valid runtime
//        code - can be anything, it is runtime specific.
//               example: if you pass gcode to the gcode runtime, it runs g-code.
Machine.prototype.executeRuntimeCode = function(runtimeName, code) {
	interlockBypass = false;
	runtime = this.getRuntime(runtimeName);
	var needsAuth = runtime.needsAuth(code);
	if (needsAuth){
		if(this.status.auth) {
			return this._executeRuntimeCode(runtimeName, code);
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

// Just run this SBP code immediately
// string - the code to run
Machine.prototype.sbp = function(string) {
	this.executeRuntimeCode('sbp', string);

}

// Just run this gcode immediately
// string - the gcode to run
Machine.prototype.gcode = function(string) {
	this.executeRuntimeCode('gcode', string);
}

/*
 * ----------------------------------------------
 * Functions below require authorization to run
 * Don't call them unless the tool is authorized!
 * ----------------------------------------------
 *
 * For documentation of these functions, see their corresponding "public" methods above.
 */

Machine.prototype._executeRuntimeCode = function(runtimeName, code, callback) {
	runtime = this.getRuntime(runtimeName);
	if(runtime) {
		if(this.current_runtime == this.idle_runtime) {
			this.setRuntime(runtime, function(err, runtime) {
				if(err) {
					log.error(err);
				} else {
					runtime.executeCode(code);
				}
			}.bind(this));
		} else {
			this.current_runtime.executeCode(code);
		}
	}
}

Machine.prototype._resume = function(input) {
	switch(this.status.state) {
		case 'interlock':
			if(this.interlock_action) {
				this.arm(this.interlock_action);
				this.interlock_action = null;
				return;
			}
		break;
	}
	if(this.current_runtime) {
		this.current_runtime.resume(input)
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
