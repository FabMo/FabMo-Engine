var fs = require('fs');
var log = require('../../log').logger('gcode');
var config = require('../../config');

function GCodeRuntime() {
	this.machine = null;
	this.driver = null;
}

GCodeRuntime.prototype.connect = function(machine) {
	this.machine = machine;
	this.driver = machine.driver;
	this.status_handler =  this._onDriverStatus.bind(this);
	this.status_report = {};
	this.driver.on('status',this.status_handler);
};

GCodeRuntime.prototype.disconnect = function() {
	this.driver.removeListener('status', this.status_handler);
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
	this.machine.setState(this, newstate);
};

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

	switch(this.machine.status.state) {
		case "not_ready":
			// This shouldn't happen.
			log.error("WAT.");
			break;

		case "running":
			if(this.status_report.stat === this.driver.STAT_HOLDING /*&& this.status_report.stat === 0*/) {
				this._changeState("paused");
				this.machine.emit('job_pause', this);
				break;
			}
			if(this.status_report.stat === this.driver.STAT_STOP || this.status_report.stat === this.driver.STAT_END) {
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

		case "idle":
			if(this.status_report.stat === this.driver.STAT_RUNNING) {
				this._changeState("running");
				this.machine.emit('job_resume', this);
				break;
			}
			break;
	}
	this.machine.emit('status',this.machine.status);

};

GCodeRuntime.prototype._idle = function() {
	//console.log(this.machine.driver.gcode_queue.getContents())
	this.machine.status.current_file = null;
	this.machine.status.line=null;
	this.machine.status.nb_lines=null;
	var job = this.machine.status.job;
	
	// Set the machine state to idle and return the units to their default configuration
	var finishUp = function() {
		this.driver.setUnits(config.machine.get('units'), function() {
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
	if(this.machine.status.state === 'idle') {
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
		string = lines.join("\n");
		this.driver.runString(string,this.machine.status);
	}

};

exports.GCodeRuntime = GCodeRuntime;
