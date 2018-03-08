var log = require('../../log').logger('manual');
var config = require('../../config');
var stream = require('stream');
var ManualDriver = require('./driver');

var T_RENEW = 200;
var SAFETY_FACTOR = 2.0;
var RENEW_SEGMENTS = 10;
var FIXED_MOVES_QUEUE_SIZE = 3;

function ManualRuntime() {
	this.machine = null;
	this.driver = null;
	this.fixedQueue = [];
}

ManualRuntime.prototype.toString = function() {
	return "[ManualRuntime]";
}

//Check if auth is neeeded to execute code
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

ManualRuntime.prototype.disconnect = function() {
	if(this.ok_to_disconnect && !this.stream) {
		this.driver.removeListener('status', this.status_handler);
		//this.machine.setState(this, 'idle');
	} else {
		throw new Error("Cannot disconnect while manually driving the tool.");
	}
};

ManualRuntime.prototype.enter = function() {
	this.stream = new stream.PassThrough();
	this.driver.runStream(this.stream).then(function() {
		delete this.stream;
		delete this.helper;
		this.machine.setState(this, 'idle');
	}.bind(this));

	this.helper = new ManualDriver(this.driver, this.stream);
	this.helper.enter().then(function() {
		this.driver.quit();
	}.bind(this));
	this.machine.setState(this, "manual");
}


ManualRuntime.prototype.executeCode = function(code, callback) {
	this.completeCallback = callback;

	// Don't honor commands if we're not in a position to do so
	switch(this.machine.status.state) {
		case "stopped":
			return;
	}

	switch(code.cmd) {
		case 'enter':
			this.enter();
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

				default:
					log.error("Don't know what to do with '" + code.cmd + "' in manual command.");
					break;

			}
	}
}

ManualRuntime.prototype.pause = function() {}
ManualRuntime.prototype.quit = function() {}
ManualRuntime.prototype.resume = function() {}

ManualRuntime.prototype._onG2Status = function(status) {


	// Update our copy of the system status
	for (var key in this.machine.status) {
		if(key in status) {
			this.machine.status[key] = status[key];
		}
	}

	this.machine.emit('status',this.machine.status);
};

exports.ManualRuntime = ManualRuntime;
exports.ManualDriver = ManualDriver