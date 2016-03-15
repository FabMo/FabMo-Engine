var fs = require('fs');
var log = require('../../log').logger('gcode');
var config = require('../../config');

function GCodeRuntime() {
	this.machine = null;
	this.driver = null;
	this.ok_to_disconnect = true;
}

GCodeRuntime.prototype.toString = function() {
	return "[GCodeRuntime]";
}
GCodeRuntime.prototype.connect = function(machine) {
	this.machine = machine;
	this.driver = machine.driver;
	this.status_handler =  this._onDriverStatus.bind(this);
	this.status_report = {};
	this.driver.on('status',this.status_handler);
};

GCodeRuntime.prototype.disconnect = function() {
	if(this.ok_to_disconnect) {
		this.driver.removeListener('status', this.status_handler);
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
	if(newstate === "idle") {
		this.ok_to_disconnect = true;
	} else {
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

	switch(this.status_report.stat) {
		case this.driver.STAT_INTERLOCK:
		case this.driver.STAT_SHUTDOWN:
		case this.driver.STAT_PANIC:
			return this._die();
			break;
		case this.driver.STAT_ALARM:
			if(this._limit()) { return; }
			break;
	}


	switch(this.machine.status.state) {
		case "not_ready":
			// This shouldn't happen.
			log.error("WAT.");
			break;

		case "running":
			switch(this.status_report.stat) {
				case this.driver.STAT_HOLDING:
					this._changeState("paused");
					this.machine.emit('job_pause', this);
					break;
				case this.driver.STAT_STOP:			
				case this.driver.STAT_END:
					this._idle();
					this.machine.emit('job_complete', this);
					break;
			}
			break;

		case "paused":
			if(this.status_report.stat === this.driver.STAT_RUNNING) {
				this._changeState("running");
				this.machine.emit('job_resume', this);
				break;
			}
			if(this.status_report.stat === this.driver.STAT_STOP || this.status_report.stat === this.driver.STAT_END) {
				this._idle();
			}
			break;

		case "armed":
		case "idle":
			if(this.status_report.stat === this.driver.STAT_RUNNING) {
				this._changeState("running");
				this.machine.emit('job_resume', this);
				break;
			}
			break;

		case "stopped":
			switch(this.status_report.stat) {
				case this.driver.STAT_STOP:			
				case this.driver.STAT_END:
					this._idle();
					this.machine.emit('job_complete', this);
					break;
			}
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
			this.ok_to_disconnect = true;
			this.machine.setState(this, 'idle');
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
		lines.push('M30\n');
		// TODO no need to stitch this string back together, it's just going to be split again in the driver
		string = lines.join("\n");
		this.driver.runString(string,this.machine.status);
	}

};

GCodeRuntime.prototype.executeCode = function(string, callback) {
	this.runString(string, callback);
}

exports.GCodeRuntime = GCodeRuntime;
