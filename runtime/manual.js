var log = require('../log').logger('manual');

function ManualRuntime() {
	this.machine = null;
	this.driver = null;
}

ManualRuntime.prototype.connect = function(machine) {
	this.machine = machine;
	this.driver = machine.driver;
	this.machine.setState(this, "manual");

	this.status_handler =  this._onG2Status.bind(this);
	this.driver.on('status',this.status_handler);
};

ManualRuntime.prototype.disconnect = function() {
	this.driver.removeListener('status', this.status_handler);
	this._changeState("idle");
};

ManualRuntime.prototype._changeState = function(newstate) {
	this.machine.setState(this, newstate);
};

ManualRuntime.prototype._onG2Status = function(status) {
	// Update our copy of the system status
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

		case "manual":
			if(status.stat === this.driver.STAT_HOLDING && status.stat === 0) {
				this._changeState("paused");
				break;
			}

			if(status.stat === this.driver.STAT_STOP || status.stat === this.driver.STAT_END) {
				this._changeState("idle");
				break;
			}
			break;

		case "paused":
			if(status.stat === this.driver.STAT_STOP || status.stat === this.driver.STAT_END) {
				this._changeState("idle");
				break;
			}
			break;

		case "idle":
			if(status.stat === this.driver.STAT_RUNNING) {
				this._changeState("manual");
				break;
			}
			break;
	}
	this.machine.emit('status',this.machine.status);
};

ManualRuntime.prototype.stopJog = function() {
	this.driver.stopJog();
};

ManualRuntime.prototype.jog = function(direction) {
	this.driver.jog(direction);
};

ManualRuntime.prototype.fixed_move = function(direction, step, speed) {
	if(this.machine.status.state != "manual") {
		this.driver.command("G20");
	}
	this.driver.fixed_move(direction,step,speed);
};

ManualRuntime.prototype.pause = function() {
	this.driver.feedHold();
}

ManualRuntime.prototype.quit = function() {
	this.driver.quit();
}

exports.ManualRuntime = ManualRuntime;
