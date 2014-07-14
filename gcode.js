var fs = require('fs');
var log = require('./log');
var g2 = require('./g2')

function GCodeRuntime() {
	this.machine = null;
	this.driver = null;
};

GCodeRuntime.prototype.connect = function(machine) {
	this.machine = machine;
	this.driver = machine.driver;
	
	this.driver.on('state', this._onG2StateChange.bind(this));
	this.driver.on('status', this._onG2Status.bind(this));
}


GCodeRuntime.prototype._onG2Status = function(status) {
	// Update our copy of the system status
	for (var key in this.machine.status) {
		if(key in status) {
			this.machine.status[key] = status[key];
		}
	}
}

GCodeRuntime.prototype._idle = function() {
	this.machine.status.state = 'idle';
	this.machine.status.current_file = null;
};

GCodeRuntime.prototype._onG2StateChange = function(states) {
	old_state = states[0];
	new_state = states[1];
	log.info("STATE CHANGE: " + this.machine.status.state + ' ' + states);

	switch(this.machine.status.state) {
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
							this.machine.emit('job_complete', this);
							break;
						case g2.STAT_HOLDING:
							this.machine.status.state = "paused";
							this.machine.emit('job_pause', this);
							break;
					}
					break;

				case g2.STAT_STOP:
				case g2.STAT_HOLDING:
					switch(new_state) {
						case g2.STAT_RUNNING:
							this.machine.status.state = "running";
							this.machine.emit('job_resume', this);
							break;
						case g2.STAT_END:
							this._idle();
							this.machine.emit('job_complete', this);
							break;
						case g2.STAT_HOMING:
							this.machine.status.state = "homing";
							break;
						case g2.STAT_PROBE:
							this.machine.status.state = "probing";
							break;
					} // new_state
					break;

				case g2.STAT_END:
					switch(new_state) {
						case g2.STAT_HOMING:
							this.machine.status.state = "homing";
							break;
						case g2.STAT_PROBE:
							this.machine.status.state = "probing";
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
							this.machine.emit('job_complete', this);
							break;
						case g2.STAT_STOP:	
						case g2.STAT_HOLDING:
							this.machine.status.state = "paused";
							this.machine.emit('job_pause', this);
							break;
					}
					break;

				case g2.STAT_STOP:
				case g2.STAT_HOLDING:
					switch(new_state) {
						case g2.STAT_RUNNING:
							this.machine.status.state = "running";
							this.machine.emit('job_resume', this);
							break;
						case g2.STAT_END:
							this._idle();
							this.machine.emit('job_complete', this);
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
							this.machine.status.state = "running";
							this.machine.emit('job_resume', this);
							break;
						case g2.STAT_END:
							//console.log('Got an unexpected switch to END from IDLE');
							break;
						case g2.STAT_HOMING:
							this.machine.status.state = "homing";
							break;
						case g2.STAT_PROBE:
							this.machine.status.state = "probing";
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
							this.machine.status.state = "running";
							this.machine.emit('job_resume', this);
							break;
						case g2.STAT_END:
							this._idle();
							this.machine.emit('job_complete', this);
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
							this.machine.status.state = "paused";
							break;
					}
					break;

				case g2.STAT_STOP:
				case g2.STAT_HOLDING:
					switch(new_state) {
						case g2.STAT_RUNNING:
							this.machine.status.state = "manual";
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
							this.machine.emit('job_complete', this);
							break;
						case g2.STAT_STOP:	
						case g2.STAT_HOLDING:
							this.machine.status.state = "paused";
							this.machine.emit('job_pause', this);
							break;
					}
					break;

				case g2.STAT_STOP:
				case g2.STAT_HOLDING:
					switch(new_state) {
						case g2.STAT_RUNNING:
							this.machine.status.state = "running";
							this.machine.emit('job_resume', this);
							break;
						case g2.STAT_PROBE:
							this.machine.status.state = "probing";
							this.machine.emit('job_resume', this);
							break;
						case g2.STAT_END:
							this._idle();
							this.machine.emit('job_complete', this);
							break;
					} // new_state
					break;
			} // old_state
			break;

	} // this.status.state
	log.debug('State: ' + this.machine.status.state)
}; // _onG2StateChange

// Run the provided string
// callback runs only when execution is complete.
GCodeRuntime.prototype.runString = function(string, callback) {
	//log.debug('Running String ' + string)
	if(this.machine.status.state === 'idle') {
		this.driver.runString(string, function(error, data) {
			if(!error) {
				this.machine.status.state = "running";
			}
			typeof callback === "function" && callback(error, data);
		}.bind(this));
	} else {
		typeof callback === "function" && callback(true, "Cannot run when in '" + this.machine.status.state + "' state.");		
	}
}

exports.GCodeRuntime = GCodeRuntime