var fs = require('fs');
var log = require('../log').logger('gcode');

function GCodeRuntime() {
	this.machine = null;
	this.driver = null;
}

GCodeRuntime.prototype.connect = function(machine) {
	this.machine = machine;
	this.driver = machine.driver;

	this.state_change_handler =this._onDriverStateChange.bind(this);
	this.status_handler =  this._onDriverStatus.bind(this);

	this.driver.on('state', this.state_change_handler);
	this.driver.on('status',this.status_handler);
};

GCodeRuntime.prototype.disconnect = function() {
	this.driver.removeListener('state', this.state_change_handler);
	this.driver.removeListener('status', this.status_handler);
};

GCodeRuntime.prototype._onDriverStatus = function(status) {
	// Update our copy of the system status
	for (var key in this.machine.status) {
		if(key in status) {
			this.machine.status[key] = status[key];
		}
	}
};

GCodeRuntime.prototype._idle = function() {
	this.machine.status.current_file = null;
	this.machine.status.line=null;
	this.machine.status.nb_lines=null;
	this.machine.status.job.finish(function(err, job) {
		this.machine.status.job=null;
		this.machine.setState(this, 'idle');
	}.bind(this));
};

GCodeRuntime.prototype._onDriverStateChange = function(states) {
	old_state = states[0];
	new_state = states[1];
	log.debug("State change: " + this.machine.status.state + ' -> ' + states);
	switch(this.machine.status.state) {
		case "not_ready":
			// This shouldn't happen.
			log.error("Got a state change event from Driver before ready");
			break;

		case "running":
			switch(old_state) {
				case this.driver.STAT_RUNNING:
					switch(new_state) {
						case this.driver.STAT_STOP:
						case this.driver.STAT_END:
							this._idle();
							this.machine.emit('job_complete', this);
							break;
						case this.driver.STAT_HOLDING:
							this.machine.setState(this, "paused");
							this.machine.emit('job_pause', this);
							break;
					}
					break;

				case this.driver.STAT_STOP:
				case STAT_HOLDING:
					switch(new_state) {
						case this.driver.STAT_RUNNING:
							this.machine.setState(this,"running");
							this.machine.emit('job_resume', this);
							break;
						case this.driver.STAT_END:
							this._idle();
							this.machine.emit('job_complete', this);
							break;
						case this.driver.STAT_HOMING:
							this.machine.setState(this,"homing");
							break;
						case this.driver.STAT_PROBE:
							this.machine.setState(this, "probing");
							break;
					} // new_state
					break;

				case this.driver.STAT_END:
					switch(new_state) {
						case this.driver.STAT_HOMING:
							this.machine.setState(this, "homing");
							break;
						case this.driver.STAT_PROBE:
							this.machine.setState(this, "probing");
							break;
					} // new_state
					break;
				default:
					log.error('Old state was ' + old_state + ' while running.... (' +  new_state + ')'); 
			} // old_state
			break;

		case "homing":
			switch(old_state) {
				case this.driver.STAT_RUNNING:
				case this.driver.STAT_HOMING:
					switch(new_state) {
						case this.driver.STAT_END:
							this._idle();
							this.machine.emit('job_complete', this);
							break;
						case this.driver.STAT_STOP:	
						case this.driver.STAT_HOLDING:
							this.machine.setState(this,"paused");
							this.machine.emit('job_pause', this);
							break;
					}
					break;

				case this.driver.STAT_STOP:
				case this.driver.STAT_HOLDING:
					switch(new_state) {
						case this.driver.STAT_RUNNING:
							this.machine.setState(this, "running");
							this.machine.emit('job_resume', this);
							break;
						case this.driver.STAT_END:
							this._idle();
							this.machine.emit('job_complete', this);
							break;
					} // new_state
					break;
			} // old_state
			break;

		case "idle":
			switch(old_state) {
				case undefined:
				case this.driver.STAT_STOP:
				case this.driver.STAT_HOLDING:
				case this.driver.STAT_END:
					switch(new_state) {
						case this.driver.STAT_RUNNING:
							this.machine.setState(this, "running");
							this.machine.emit('job_resume', this);
							break;
						case this.driver.STAT_END:
							//console.log('Got an unexpected switch to END from IDLE');
							break;
						case this.driver.STAT_HOMING:
							this.machine.setState(this, "homing");
							break;
						case this.driver.STAT_PROBE:
							this.machine.setState(this, "probing");
							break;
					} // new_state
					break;
				default:
					log.error("UNKNOWN STATE " + old_state);
					break;
			} // old_state
			break;

		case "paused":
			switch(old_state) {
				case this.driver.STAT_STOP:
				case this.driver.STAT_HOLDING:
					switch(new_state) { 
						case this.driver.STAT_RUNNING:
							this.machine.setState(this, "running");
							this.machine.emit('job_resume', this);
							break;
						case this.driver.STAT_END:
							this._idle();
							this.machine.emit('job_complete', this);
							break;
					} // new_state
					break;
			} // old_state
			break;

		case "manual":
			switch(old_state) {
				case this.driver.STAT_RUNNING:
					switch(new_state) {
						case this.driver.STAT_END:
							this._idle();
							break;
                        case this.driver.STAT_STOP:
						case this.driver.STAT_HOLDING:
							//this._idle();
							this.machine.setState(this, "paused");
							break;
					}
					break;

				case this.driver.STAT_STOP:
				case this.driver.STAT_HOLDING:
					switch(new_state) {
						case this.driver.STAT_RUNNING:
							this.machine.setState(this, "manual");
							break;
						case this.driver.STAT_END:
							this._idle();
							break;
					} // new_state
					break;
			} // old_state
			break;

		case "probing":
			switch(old_state) {
				case this.driver.STAT_RUNNING:
				case this.driver.STAT_PROBE:
					switch(new_state) {
						case this.driver.STAT_END:
							this._idle();
							this.machine.emit('job_complete', this);
							break;
						case this.driver.STAT_STOP:	
						case this.driver.STAT_HOLDING:
							this.machine.setState(this, "paused");
							this.machine.emit('job_pause', this);
							break;
					}
					break;

				case this.driver.STAT_STOP:
				case this.driver.STAT_HOLDING:
					switch(new_state) {
						case this.driver.STAT_RUNNING:
							this.machine.setState(this, "running");
							this.machine.emit('job_resume', this);
							break;
						case this.driver.STAT_PROBE:
							this.machine.setState(this, "probing");
							this.machine.emit('job_resume', this);
							break;
						case this.driver.STAT_END:
							this._idle();
							this.machine.emit('job_complete', this);
							break;
					} // new_state
					break;
			} // old_state
			break;

	} // this.status.state
}; // _onDriverStateChange

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
		string = lines.join("\n");
		this.driver.runString(string);
	}

};

exports.GCodeRuntime = GCodeRuntime;