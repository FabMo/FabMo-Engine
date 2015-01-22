var log = require('../log').logger('manual');

function ManualRuntime() {
	this.machine = null;
	this.driver = null;
}

ManualRuntime.prototype.connect = function(machine) {
	this.machine = machine;
	this.driver = machine.driver;
	this.machine.setState(this, "manual");

	this.state_change_handler =this._onG2StateChange.bind(this);
	this.status_handler =  this._onG2Status.bind(this);

	this.driver.on('state', this.state_change_handler);
	this.driver.on('status',this.status_handler);
};

ManualRuntime.prototype.disconnect = function() {
	this.driver.removeListener('state', this.state_change_handler);
	this.driver.removeListener('status', this.status_handler);
	this.machine.setState(this, "idle");
};


ManualRuntime.prototype._onG2StateChange = function(states) {
	var from = states[0];
	var to = states[1];
	log.debug("Manual runtime got a state change from " + from + " to " + to);
	if(to === 4 || to === 3) {
		this.machine.setState(this, "idle");
	}
};

ManualRuntime.prototype._onG2Status = function(status) {
	// Update our copy of the system status
	for (var key in this.machine.status) {
		if(key in status) {
			this.machine.status[key] = status[key];
		}
	}
};

ManualRuntime.prototype.stopJog = function() {
	log.info('Stopping jog.');
	this.driver.stopJog();
};

ManualRuntime.prototype.jog = function(direction) {
	log.info('Starting jog in ' + direction + ' direction.');
	this.machine.setState(this, "manual");
	this.driver.jog(direction);
};

ManualRuntime.prototype.fixed_move = function(direction, step) {
	log.info('Starting fixed move in ' + direction + ' direction.');
	this.machine.setState(this, "manual");
	this.driver.fixed_move(direction,step);
};


exports.ManualRuntime = ManualRuntime;
