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

IdleRuntime.prototype._onG2Status = function(status) {

	console.log("Idle runtime handling status report")
	// Update our copy of the system status
	for (var key in this.machine.status) {
		if(key in status) {
			this.machine.status[key] = status[key];
		}
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
	}
	this.machine.emit('status',this.machine.status);
};


IdleRuntime.prototype.executeCode = function(code) {}
IdleRuntime.prototype.pause = function() { /*this.driver.feedHold();*/ }
IdleRuntime.prototype.quit = function() { /*this.driver.quit();*/ }
IdleRuntime.prototype.resume = function() { /*this.driver.resume();*/ }

exports.IdleRuntime = IdleRuntime;
