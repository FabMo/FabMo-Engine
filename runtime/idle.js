var log = require('../log').logger('idle');

function IdleRuntime() {
	this.machine = null;
	this.driver = null;
}

IdleRuntime.prototype.toString = function() {
	return "[IdleRuntime]";
}

IdleRuntime.prototype.connect = function(machine) {
    this.machine = machine;
	this.driver = machine.driver;
	this.ok_to_disconnect = true;
	this.status_report = {};
	this.machine.setState(this, "idle");
	this.status_handler =  this._onG2Status.bind(this);
	this.driver.on('status',this.status_handler);
};

IdleRuntime.prototype.disconnect = function() {
	this.driver.removeListener('status', this.status_handler);
	this._changeState("idle");
};

IdleRuntime.prototype._changeState = function(newstate) {
	this.machine.setState(this, newstate);
};

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

IdleRuntime.prototype._onG2Status = function(status) {

	// Update our copy of the system status
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
			log.error(new Error("WAT."));
			break;

		case "manual":
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
			if((status.stat === this.driver.STAT_STOP || status.stat === this.driver.STAT_END) && status.hold === 0) {
				this._changeState("idle");
				break;
			}
			break;

		case "idle":
			if(status.stat === this.driver.STAT_RUNNING) {
				this._changeState("running");
				break;
			}
			break;

		case "running":
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
