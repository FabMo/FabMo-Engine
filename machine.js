var g2 = require('./g2');
var util = require('util');
var events = require('events');
var PLATFORM = require('process').platform
var Engine = require('tingodb')(),
    assert = require('assert');
var fs = require('fs');

function connect(callback) {

	switch(PLATFORM) {

		case 'linux':
			path = '/dev/ttyACM0';
			break;

		case 'darwin':
			path = '/dev/cu.usbmodem001';
			break;

		default:
			path = null;
			break;
	}
	if(path) {
		return new Machine(path, callback);
	} else {
		typeof callback === "function" && callback(true, "No supported serial path for platform " + PLATFORM);		
		return null;
	}
}

function Machine(path, callback) {

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
	this.driver.on("error", function(data) {console.log(data)});
	this.driver.connect(path, function(err, data) {
		this.status.state = "idle";
		this.driver.on('state', this._onG2StateChange.bind(this));
		this.driver.on('status', this._onG2Status.bind(this));
		this.driver.requestStatusReport(function(err, result) {
			typeof callback === "function" && callback(false, this);
		}.bind(this));
	}.bind(this));
};
util.inherits(Machine, events.EventEmitter);

Machine.prototype.toString = function() {
    return "[Machine Model on '" + driver.path + "']";
}

// Run the provided string
// callback runs only when execution is complete.
Machine.prototype.runString = function(string, callback) {
	if(this.status.state === 'idle') {
		this.status.state = "running";
		typeof callback === "function" && this.once('job_complete', callback);
		this.driver.runString(string);		
	} else {
		typeof callback === "function" && callback(true, "Cannot run when in '" + this.state + "' state.");		
	}
}

Machine.prototype._onG2Status = function(status) {
	// Update our copy of the system status
	for (var key in this.status) {
		if(key in status) {
			this.status[key] = status[key];
		}
	}
}

Machine.prototype._onG2StateChange = function(states) {
	old_state = states[0];
	new_state = states[1];
	console.log(this.status.state + ' ' + states);

	switch(this.status.state) {
		case "not_ready":
			// This shouldn't happen.
			console.log("Got a state change event from G2 before ready");
			break;

		case "running":
			switch(old_state) {
				case g2.STAT_RUNNING:
					switch(new_state) {
						case g2.STAT_END:
							this.status.state = "idle";
							this.emit('job_complete', this);
							break;
						case g2.STAT_HOLDING:
							console.log("JOB PAUSE");
							this.status.state = "hold";
							this.emit('job_pause', this);
							break;
					}
					break;

				case g2.STAT_STOP:
				case g2.STAT_HOLDING:
					switch(new_state) {
						case g2.STAT_RUNNING:
							this.status.state = "running";
							this.emit('job_resume', this);
							break;
						case g2.STAT_END:
							this.status.state = "idle";
							this.emit('job_complete', this);
							break;
					} // new_state
					break;
			} // old_state
			break;

		case "idle":
			switch(old_state) {
				case g2.STAT_STOP:
				case g2.STAT_HOLDING:
					switch(new_state) {
						case g2.STAT_RUNNING:
							this.status.state = "running";
							this.emit('job_resume', this);
							break;
						case g2.STAT_END:
							console.log('Got an unexpected switch to END from IDLE');
							break;
					} // new_state
					break;
			} // old_state
			break;

		case "hold":
			switch(old_state) {
				case g2.STAT_STOP:
				case g2.STAT_HOLDING:
					switch(new_state) {
						case g2.STAT_RUNNING:
							this.status.state = "running";
							this.emit('job_resume', this);
							break;
						case g2.STAT_END:
							this.status.state = "idle";
							this.emit('job_complete', this);							
							break;
					} // new_state
					break;
			} // old_state
			break;
	} // this.status.state
}; // _onG2StateChange


Machine.prototype.runFile = function(filename) {
	fs.readFile(filename, 'utf8', function (err,data) {
		  if (err) {
		  	console.log('Error reading file ' + filename);
		    return console.log(err);
		  }
		  this.runString(data);
		}.bind(this));
};

Machine.prototype.jog = function(direction) {
	this.status.state = "running";
	this.driver.jog(direction);
}

Machine.prototype.stopJog = function() {
	this.driver.stopJog();
} 

Machine.prototype.pause = function() {
	console.log('Pausing');
	if(this.status.state === "running") {
		this.driver.feedHold();
	}
}

Machine.prototype.quit = function() {
	this.driver.quit();
}

Machine.prototype.resume = function() {
	console.log('Resuming');
	this.driver.resume();
}

exports.connect = connect;

