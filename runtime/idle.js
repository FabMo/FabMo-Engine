/*
 * runtime/idle.js
 *
 * This module defines the IdleRuntime which is the default runtime for the machine model.
 * It essentially does nothing, and is just a placeholder, there to be a runtime when the machine isn't doing anything else.
 */
var log = require('../log').logger('idle');

// IdleRuntime constructor
function IdleRuntime() {
	this.machine = null;
	this.driver = null;
}

IdleRuntime.prototype.toString = function() {
	return "[IdleRuntime]";
}

// Connect to the machine.  When this happens, the runtime has singular control of the machine.
// The idle runtime can be disconnected (eg by the machine) at any time.  This happens usually to replace
// the idle runtime with a more interesting one.
//   machine - The machine model to connect this runtime to
IdleRuntime.prototype.connect = function(machine) {
    this.machine = machine;
	this.driver = machine.driver;
	this.ok_to_disconnect = true;
	this.status_report = {};
	this.status_handler =  this._onG2Status.bind(this);
	this.driver.on('status',this.status_handler);
};

// Disconnect from the machine.
IdleRuntime.prototype.disconnect = function() {
	this.driver.removeListener('status', this.status_handler);
};

// Set the machine state to newstate
//   newstate - The state to change to
IdleRuntime.prototype._changeState = function(newstate) {
	this.machine.setState(this, newstate);
};

// This function is called internally when G2 hits a software limit.
// TODO - There is work to be done here.  I wouldn't trust anything here.
IdleRuntime.prototype._limit = function() {
	var er = this.driver.getLastException();
	if(er && er.st == 203) {
		var msg = er.msg.replace(/\[[^\[\]]*\]/,'');
		this.driver.clearLastException();
		this.machine.setState(this, 'stopped', {'error' : msg});
		return true;
	}
	return false;
}

// Internal handler for the G2 status report
IdleRuntime.prototype._onG2Status = function(status) {

	// Update the machine copy of g2 status variables
	for (var key in this.machine.status) {
		if(key in status) {
			this.machine.status[key] = status[key];
		}
	}

	// Update our copy of the system status
	for (key in status) {
		this.status_report[key] = status[key];
	}

	switch(this.status_report.stat) {
		case this.driver.STAT_INTERLOCK:
		case this.driver.STAT_SHUTDOWN:
		case this.driver.STAT_PANIC:
			// If any of these states are seen, it's curtains.  Go into the unrecoverable error state.
			return this._die();
			break;
		case this.driver.STAT_ALARM:
			// Do the limit handling if this was because of a limit.  Otherwise, carry on.
			if(this._limit()) { return; }
			break;
	}


	switch(this.machine.status.state) {
		case "not_ready":
			// This shouldn't happen.
			log.error(new Error("Unexpectedly encountered the 'not ready' state in IdleRuntime"));
			break;

		case "manual":
			// Handle transitions out of the manual state
			if(status.stat === this.driver.STAT_HOLDING && status.stat === 0) {
				this._changeState("paused");
				break;
			}
			if((status.stat === this.driver.STAT_STOP || status.stat === this.driver.STAT_END) && status.hold === 0) {
				this._changeState("idle");
				break;
			}
			break;

		case "stopped":
		case "paused":
			// Handle transitions out of a stopped state
			if((status.stat === this.driver.STAT_STOP || status.stat === this.driver.STAT_END) && status.hold === 0) {
				this._changeState("idle");
				break;
			}
			break;

		case "idle":
			// Handle transition out of the idle state
			// This probably shouldn't happen, because if we're transitioning to the running state, we're probably
			// doing it because a runtime (not this runtime) requested that we do it. 
			if(status.stat === this.driver.STAT_RUNNING) {
				this._changeState("running");
				break;
			}
			break;

		case "running":
			// Handle transition out of running, back to idle
			if(status.stat === this.driver.STAT_END) {
				this._changeState("idle");
			}		
			break;
	}
	this.machine.emit('status',this.machine.status);
};


IdleRuntime.prototype.executeCode = function(code) {}
IdleRuntime.prototype.pause = function() { /*this.driver.feedHold();*/ }
IdleRuntime.prototype.quit = function() { this.driver.quit(); }
IdleRuntime.prototype.resume = function() { /*this.driver.resume();*/ }

exports.IdleRuntime = IdleRuntime;
