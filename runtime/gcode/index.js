var fs = require('fs');
var log = require('../../log').logger('gcode');
var config = require('../../config');
var countLineNumbers = require('../../util').countLineNumbers


function GCodeRuntime() {
	this.machine = null;
	this.driver = null;
	this.ok_to_disconnect = true;
	this.completeCallback = null;
}

GCodeRuntime.prototype.toString = function() {
	return "[GCodeRuntime]";
}
//Check if move requires auth
GCodeRuntime.prototype.needsAuth = function(s) {
	//all needs auth (check) so just return true
	return true;
}
GCodeRuntime.prototype.connect = function(machine) {
	this.machine = machine;
	this.driver = machine.driver;
	this.status_handler =  this._onDriverStatus.bind(this);
	this.status_report = {};
	this.driver.on('status',this.status_handler);
	log.info("Connected G-Code Runtime");
};

GCodeRuntime.prototype.disconnect = function() {
	if(this.ok_to_disconnect) {
		this.driver.removeListener('status', this.status_handler);
		log.info("Disconnected G-Code Runtime");
	} else {
		throw new Error("Cannot disconnect GCode Runtime")
	}
};

GCodeRuntime.prototype.pause = function() {
	this.driver.feedHold();
}

GCodeRuntime.prototype.quit = function() {
	this.driver.quit();
}

GCodeRuntime.prototype.resume = function() {
	this.driver.resume();
}

GCodeRuntime.prototype._changeState = function(newstate) {
	log.debug("Changing state to " + newstate)
	if(newstate != "idle") {
		this.ok_to_disconnect = false;
	}
	this.machine.setState(this, newstate);
};

GCodeRuntime.prototype._limit = function() {
	var er = this.driver.getLastException();
	if(er && er.st == 203) {
		var msg = er.msg.replace(/\[[^\[\]]*\]/,'');
		this.driver.clearLastException();
		this._fail(msg);
		return true;
	}
	return false;
}

GCodeRuntime.prototype._onDriverStatus = function(status) {
	// Update the machine copy of g2 status variables
	for (var key in this.machine.status) {
		if(key in status) {
			this.machine.status[key] = status[key];
		}
	}
	// Update the machine copy of g2 status variables
	for (key in status) {
		this.status_report[key] = status[key];
	}

	this.machine.emit('status',this.machine.status);
};


GCodeRuntime.prototype._die = function() {
	this.machine.status.current_file = null;
	this.machine.status.line=null;
	this.machine.status.nb_lines=null;
 	try {
 		this.machine.status.job.fail();
 	} catch(e) {}
 	finally {
		this.machine.status.job=null;
 		this.machine.setState(this, 'dead', {error : 'A G2 exception has occurred. You must reboot your tool.'});
 	}
}

GCodeRuntime.prototype._fail = function(message) {
	this.machine.status.current_file = null;
	this.machine.status.line=null;
	this.machine.status.nb_lines=null;
 	try {
 		this.machine.status.job.fail();
 	} catch(e) {}
 	finally {
		this.machine.status.job=null;
 		this.machine.setState(this, 'stopped', {error : message});
 	}
}

GCodeRuntime.prototype._idle = function() {
	this.machine.status.current_file = null;
	this.machine.status.line=null;
	this.machine.status.nb_lines=null;
	var job = this.machine.status.job;
	// Set the machine state to idle and return the units to their default configuration
	var finishUp = function() {
		this.driver.setUnits(config.machine.get('units'), function() {
			var callback = this.completeCallback || function() {};
			this.ok_to_disconnect = true;
			this.completeCallback = null;
			this.machine.setState(this, 'idle');
			callback();
		}.bind(this))
	}.bind(this);

	if(job) {
		if(job.pending_cancel) {
			this.machine.status.job.cancel(function(err, job) {
				this.machine.status.job=null;
				finishUp();
			}.bind(this));
		} else {
			this.machine.status.job.finish(function(err, job) {
				this.machine.status.job=null;
				finishUp();
			}.bind(this));
		}
	} else {
		finishUp();
	}
};

// Run the provided string
// callback runs only when execution is complete.
GCodeRuntime.prototype.runString = function(string, callback) {
	if(callback) { log.error("CALLBACK PASSED TO RUNSTRING")}

	if(this.machine.status.state === 'idle' || this.machine.status.state === 'armed') {
		var lines =  string.split('\n');
		var mode = config.driver.get('gdi') ? 'G91': 'G90';
		this.machine.status.nb_lines = lines.length;
		for (i=0;i<lines.length;i++){
			if (lines[i][0]!==undefined && lines[i][0].toUpperCase() !== 'N' ){
				lines[i]= 'N'+ (i+1) + lines[i];
			}
		}
		lines.unshift(mode);
		this.completeCallback = callback;
		this._changeState("running");
		return this.driver.runList(lines)
		.on('stat', this._handleStateChange.bind(this))
		.then(this._handleStop.bind(this));
	}
};

GCodeRuntime.prototype._handleStop = function() {
	this._idle();
}

GCodeRuntime.prototype._handleStateChange = function(stat) {
	switch(stat) {
		case this.driver.STAT_HOLDING:
			this._changeState('paused');
			break;
		case this.driver.STAT_RUNNING:
			this._changeState('running');
			break;
		default:
			break;
	}
}

// Run a file given the filename
GCodeRuntime.prototype.runFile = function(filename, callback) {
	countLineNumbers(filename, function(err, lines) {
		this.machine.status.nb_lines = lines;
		this.driver.runFile(filename, callback)
			.on('stat', this._handleStateChange.bind(this))
			.then(this._handleStop.bind(this));
	}.bind(this));
}

// Run the given string as gcode
GCodeRuntime.prototype.executeCode = function(string, callback) {
		return this.runString(string);
}

exports.GCodeRuntime = GCodeRuntime;
