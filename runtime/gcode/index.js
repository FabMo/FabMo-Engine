var fs = require('fs');
var log = require('../../log').logger('gcode');

function GCodeRuntime() {
	this.machine = null;
	this.driver = null;
}

GCodeRuntime.prototype.connect = function(machine) {
	this.machine = machine;
	this.driver = machine.driver;

	this.status_handler =  this._onDriverStatus.bind(this);

	this.driver.on('status',this.status_handler);
};

GCodeRuntime.prototype.disconnect = function() {
	this.driver.removeListener('status', this.status_handler);
};

GCodeRuntime.prototype._changeState = function(newstate) {
	this.machine.setState(this, newstate);
}

GCodeRuntime.prototype._onDriverStatus = function(status) {

	// Update the machine copy of g2 status variables
	for (var key in this.machine.status) {
		if(key in status) {
			this.machine.status[key] = status[key];
		}
	}

	switch(this.machine.status.state) {
		case "not_ready":
			// This shouldn't happen.
			log.error("WAT.");
			break;

		case "running":
			if(status.stat === this.driver.STAT_HOLDING && status.stat === 0) {
				this._changeState("paused");
				this.machine.emit('job_pause', this);
				break;
			}

			if(status.stat === this.driver.STAT_STOP || status.stat === this.driver.STAT_END) {
				this._idle();
				this.machine.emit('job_complete', this);
				break;
			}
			break;

		case "paused":
			if(status.stat === this.driver.STAT_RUNNING) {
				this._changeState("running");
				this.machine.emit('job_resume', this);
				break;
			}
			if(status.stat === this.driver.STAT_STOP || status.stat === this.driver.STAT_END) {
				this._idle();
			}
			break;

		case "idle":
			if(status.stat === this.driver.STAT_RUNNING) {
				this._changeState("running");
				this.machine.emit('job_resume', this);
				break;
			}
			break;
	}
}

GCodeRuntime.prototype._idle = function() {
	//console.log(this.machine.driver.gcode_queue.getContents())
	this.machine.status.current_file = null;
	this.machine.status.line=null;
	this.machine.status.nb_lines=null;
	if(this.machine.status.job) {
		this.machine.status.job.finish(function(err, job) {
			this.machine.status.job=null;
			this.machine.setState(this, 'idle');
		}.bind(this));
	} else {
		this.machine.setState(this, 'idle');
	}
};

// Run the provided string
// callback runs only when execution is complete.
GCodeRuntime.prototype.runString = function(string, callback) {
	//log.debug('Running String ' + string)
	if(this.machine.status.state === 'idle') {
		var lines =  string.split('\n');
		this.machine.status.nb_lines = lines.length;
		for (i=0;i<lines.length;i++){
			if (lines[i][0]!==undefined && lines[i][0].toUpperCase() !== 'N' ){
				lines[i]= 'N'+ (i+1) + lines[i];
			}
		}
		lines.push('M30\n');
		string = lines.join("\n");
		this.driver.gcodeWrite(string);
		//this.driver.runString(string,this.machine.status);
	}

};

exports.GCodeRuntime = GCodeRuntime;
