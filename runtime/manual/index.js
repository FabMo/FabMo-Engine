/*
 * runtime/manual/index.js
 *
 * This module defines the ManualRuntime, which is the runtime used for interactive
 * control over the tool, such as would be used by a pendant, or interactive control app.
 */
var log = require('../../log').logger('manual');
var config = require('../../config');
var stream = require('stream');
var ManualDriver = require('./driver');

// TODO - these should probably all be taken out - I don't believe they are used
var T_RENEW = 200;
var SAFETY_FACTOR = 2.0;
var RENEW_SEGMENTS = 10;
var FIXED_MOVES_QUEUE_SIZE = 3;

// TODO - member of the instance rather than global to this file?!
var currentCmd;

// ManualRuntime constructor
function ManualRuntime() {
	this.machine = null;
	this.driver = null;
	this.fixedQueue = [];
}


ManualRuntime.prototype.toString = function() {
	return "[ManualRuntime]";
}

// Check if auth is neeeded to execute code
ManualRuntime.prototype.needsAuth = function(s) {
	//all manual needs auth (check) so just return true
	return true;
}

ManualRuntime.prototype.connect = function(machine) {
	this.machine = machine;
	this.driver = machine.driver;
	this.ok_to_disconnect = true;

	// True while the tool is known to be in motion
	this.moving = false;

	// True while the user intends (as far as we know) for the tool to continue moving
	this.keep_moving = false;

	// Set to true to exit the manual state once the current operation is completed
	this.exit_pending = false;

	// Current trajectory
	this.current_axis = null;
	this.current_speed = null;
	this.completeCallback = null;
	this.status_handler = this._onG2Status.bind(this);
	this.driver.on('status',this.status_handler);
};

// Disconnect from the machine model
ManualRuntime.prototype.disconnect = function() {
	if(this.ok_to_disconnect && !this.stream) {
		this.driver.removeListener('status', this.status_handler);

		////##
		log.info('Disconnected MANUAL runtime.')

		//this.machine.setState(this, 'idle');
	} else {
		throw new Error("Cannot disconnect while manually driving the tool.");
	}
};

// Enter the manual drive state (and thus, the machining cycle)
ManualRuntime.prototype.enter = function(mode, hideKeypad) {
	this.stream = new stream.PassThrough();

	// At a high level, this opens a stream to the driver, that subsequent commands
	// will pump commands into.  When we exit the machining cycle with an M2 or M30, 
	// we clean up and exit the manual state.
	this.driver.runStream(this.stream).then(function() {
		delete this.stream;
		delete this.helper;
		this.machine.setState(this, 'idle');
	}.bind(this));

	// Create a helper that is used to do the pumping of commands.
	this.helper = new ManualDriver(this.driver, this.stream, mode);
	this.helper.enter().then(function() {
		log.debug('** Resolving enter promise **')
////##		this.driver.quit();  ////## removed because sending a delayed kill to next routine???
                                 ////##   ... maybe not integrated with streaming right
	}.bind(this));
	this.machine.status.hideKeypad = hideKeypad;
	this.machine.setState(this, "manual");
}

// Execute a command.  Command structure follows:
// {cmd:"start",axis:"X",speed:2} - Start moving in +X direction at 2ips
// TODO: The 2-axis form of 'start' is bonkers, we should just get to specify an N-dimensional speed vector
// {cmd:"start",axis:"X",speed:2, second_axis:"Y", second_speed:2}
// {cmd:"exit"} - Exit the manual mode (return to idle)
// {cmd:"stop"} - Stop movement, but do not exit the manual mode
// {cmd:"quit"} - Quit motion (TODO - what's the diff between this and exit?)
// {cmd:"maint"} - Maintain motion along the current vector
// {cmd:"goto",move:{X:1,Y:2,Z:3}} - Go to x,y,z = 1,2,3
// {cmd:"set", move:{X:1,Y:2,Z:3}} - Set current x,y,z to 1,2,3 (No movement)
// 
////## ManualRuntime.prototype.executeCode = function(code, callback) {
ManualRuntime.prototype.executeCode = function(code) {
	currentCmd = code.cmd;
////##	this.completeCallback = callback;

	// Don't honor commands if we're not in a position to do so
	switch(this.machine.status.state) {
		case 'stopped':
			return;
	}
	log.info('CODE!!');
	log.info(JSON.stringify(code));
	switch(code.cmd) {
		case 'enter':
			this.enter(code.mode, code.hideKeypad || false);
			log.debug("fail on case enter, mode= " + code.mode)
			break;
		default:
			if(!this.helper) {
				log.warn("Can't accept command '" + code.cmd + "' - not entered.");
				this.machine.setState(this, 'idle');
				return;
			}
			switch(code.cmd) {
				case 'exit':
					log.debug('---- MANUAL DRIVE EXIT ----')
					this.helper.exit();
					break;

				case 'start':
					this.helper.startMotion(code.axis, code.speed, code.second_axis, code.second_speed);
					break;

				case 'stop':
					this.helper.stopMotion();
					break;

				case 'quit':
					this.helper.quitMove();
					break;

				case 'maint':
					this.helper.maintainMotion();
					break;
					
				case 'goto':
					this.helper.goto(code.move)
					break;

				case 'set':
					this.helper.set(code.move)
					break;

				case 'fixed':
					if(!this.helper) {
						this.enter();
					}
					this.helper.nudge(code.axis, code.speed, code.dist, code.second_axis, code.second_dist);
					break;

				case 'raw':
					this.helper.runGCode(code.code)
					break;

				default:
					log.error("Don't know what to do with '" + code.cmd + "' in manual command.");
					break;

			}
	}
}

// Commands that need to be implemented for runtime interface, but don't do anything
ManualRuntime.prototype.pause = function() {}
ManualRuntime.prototype.quit = function() {}
ManualRuntime.prototype.resume = function() {}

// Internal handler for machine status
ManualRuntime.prototype._onG2Status = function(status) {
	// Update machine copy of the system status
	for (var key in this.machine.status) {
		if(key in status) {
			this.machine.status[key] = status[key];
		}
	}
	// Update machine status further
	this.machine.status.currentCmd = currentCmd;
	// TODO - Is this needed?  isn't it done in the loop above?
	this.machine.status.stat = status.stat;

	this.machine.emit('status',this.machine.status);
};

exports.ManualRuntime = ManualRuntime;
exports.ManualDriver = ManualDriver