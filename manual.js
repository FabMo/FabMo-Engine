function ManualRuntime() {
	this.machine = null;
	this.driver = null;
};

ManualRuntime.prototype.connect = function(machine) {
	this.machine = machine;
	this.driver = machine.driver;

	this.state_change_handler =this._onG2StateChange.bind(this);
	this.status_handler =  this._onG2Status.bind(this);

	this.driver.on('state', this.state_change_handler);
	this.driver.on('status',this.status_handler);
}

ManualRuntime.prototype.disconnect = function() {
	this.driver.removeListener('state', this.state_change_handler);
	this.driver.removeListener('status', this.status_handler);
}


ManualRuntime.prototype._onG2StateChange = function(states) {

}

ManualRuntime.prototype._onG2Status = function(driver) {

}

ManualRuntime.prototype.stopJog = function() {
	this.driver.stopJog();
}

ManualRuntime.prototype.jog = function(direction) {
	this.driver.jog(direction);
}

exports.ManualRuntime = ManualRuntime