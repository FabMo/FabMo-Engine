var g2 = require('./g2');
var util = require('util');
var events = require('events');
var PLATFORM = require('process').platform
var Engine = require('tingodb')(),
    assert = require('assert');
var fs = require('fs');
var path = require('path');
var log = require('./log');

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
	this.driver.on("error", function(data) {console.log(data)});
	this.driver.connect(serial_path, function(err, data) {
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
	log.debug('Running String ' + string)
	if(this.status.state === 'idle') {
		this.driver.runString(string, function(error, data) {
			if(!error) {
				this.status.state = "running";
			}
			typeof callback === "function" && callback(error, data);
		}.bind(this));
	} else {
		typeof callback === "function" && callback(true, "Cannot run when in '" + this.status.state + "' state.");		
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

Machine.prototype._idle = function() {
	this.status.state = 'idle';
	this.status.current_file = null;
};

Machine.prototype._onG2StateChange = function(states) {
	old_state = states[0];
	new_state = states[1];
	log.info("STATE CHANGE: " + this.status.state + ' ' + states);

	switch(this.status.state) {
		case "not_ready":
			// This shouldn't happen.
			console.log("Got a state change event from G2 before ready");
			break;

		case "running":
			switch(old_state) {
				case g2.STAT_RUNNING:
					switch(new_state) {
						case g2.STAT_STOP:
						case g2.STAT_END:
							this._idle();
							this.emit('job_complete', this);
							break;
						case g2.STAT_HOLDING:
							this.status.state = "paused";
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
							this._idle();
							this.emit('job_complete', this);
							break;
						case g2.STAT_HOMING:
							this.status.state = "homing";
							break;
						case g2.STAT_PROBE:
							this.status.state = "probing";
							break;
					} // new_state
					break;

				case g2.STAT_END:
					switch(new_state) {
						case g2.STAT_HOMING:
							this.status.state = "homing";
							break;
						case g2.STAT_PROBE:
							this.status.state = "probing";
							break;
					} // new_state
					break;
				default:
					log.error('Old state was ' + old_state + ' while running.... (' +  new_state + ')'); 
			} // old_state
			break;

		case "homing":
			switch(old_state) {
				case g2.STAT_RUNNING:
				case g2.STAT_HOMING:
					switch(new_state) {
						case g2.STAT_END:
							this._idle();
							this.emit('job_complete', this);
							break;
						case g2.STAT_STOP:	
						case g2.STAT_HOLDING:
							this.status.state = "paused";
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
							this._idle();
							this.emit('job_complete', this);
							break;
					} // new_state
					break;
			} // old_state
			break;

		case "idle":
				log.info('Leaving the idle state ' + old_state + ',' + new_state)
			switch(old_state) {
				case undefined:
				case g2.STAT_STOP:
				case g2.STAT_HOLDING:
					switch(new_state) {
						case g2.STAT_RUNNING:
							this.status.state = "running";
							this.emit('job_resume', this);
							break;
						case g2.STAT_END:
							//console.log('Got an unexpected switch to END from IDLE');
							break;
						case g2.STAT_HOMING:
							this.status.state = "homing";
							break;
						case g2.STAT_PROBE:
							this.status.state = "probing";
							break;
					} // new_state
					break;
				default:
					log.error("OMG OMG OMG UNKNOWN STATE " + old_state);
					break;
			} // old_state
			break;

		case "paused":
			switch(old_state) {
				case g2.STAT_STOP:
				case g2.STAT_HOLDING:
					switch(new_state) { 
						case g2.STAT_RUNNING:
							this.status.state = "running";
							this.emit('job_resume', this);
							break;
						case g2.STAT_END:
							this._idle();
							this.emit('job_complete', this);
							break;
					} // new_state
					break;
			} // old_state
			break;

		case "manual":
			switch(old_state) {
				case g2.STAT_RUNNING:
					switch(new_state) {
						case g2.STAT_END:
							this._idle();
							break;
                        case g2.STAT_STOP:
						case g2.STAT_HOLDING:
							//this._idle();
							this.status.state = "paused";
							break;
					}
					break;

				case g2.STAT_STOP:
				case g2.STAT_HOLDING:
					switch(new_state) {
						case g2.STAT_RUNNING:
							this.status.state = "manual";
							break;
						case g2.STAT_END:
							this._idle();
							break;
					} // new_state
					break;
			} // old_state
			break;

		case "probing":
			switch(old_state) {
				case g2.STAT_RUNNING:
				case g2.STAT_PROBE:
					switch(new_state) {
						case g2.STAT_END:
							this._idle();
							this.emit('job_complete', this);
							break;
						case g2.STAT_STOP:	
						case g2.STAT_HOLDING:
							this.status.state = "paused";
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
						case g2.STAT_PROBE:
							this.status.state = "probing";
							this.emit('job_resume', this);
							break;							
						case g2.STAT_END:
							this._idle();
							this.emit('job_complete', this);
							break;
					} // new_state
					break;
			} // old_state
			break;

	} // this.status.state
	log.debug('State: ' + this.status.state)
}; // _onG2StateChange


Machine.prototype.runFile = function(filename) {
	fs.readFile(filename, 'utf8', function (err,data) {
		  if (err) {
		  	console.log('Error reading file ' + filename);
		    return console.log(err);
		  } else {
            parts = filename.split(path.sep)
            log.debug(filename);
            log.debug(parts);
		  	this.status.current_file = parts[parts.length-1]
		  	this.runString(data);
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

