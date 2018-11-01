/*
 * runtime/passthrough/index.js
 *
 * This module defines the PassthroughRuntime which is a short-lived
 * attempt to pass G2 commands directly through the machine model to G2, to allow for things
 * like chilipeppr, etc to speak with the motion controller directly.  It plays havoc with FabMo's 
 * internal sense of state, though, and thus has been deprecated.
 *
 * TODO - remove this module
 */
var log = require('../../log').logger('passthrough');

function PassthroughRuntime() {
	this.machine = null;
	this.driver = null;
}

PassthroughRuntime.prototype.toString = function() {
	return "[PassthroughRuntime]";
}

PassthroughRuntime.prototype.connect = function(machine) {
	this.machine = machine;
	this.driver = machine.driver;

	this.raw_data_handler =this._onDriverRawData.bind(this);
	this.state_change_handler =this._onDriverStateChange.bind(this);
	this.status_handler =  this._onDriverStatus.bind(this);

	this.driver.on('raw_data', this.raw_data_handler);
	this.driver.on('state', this.state_change_handler);
	this.driver.on('status',this.status_handler);

	this.machine.setState(this, "passthrough");
};

PassthroughRuntime.prototype.disconnect = function() {
	this.driver.removeListener('raw_data', this.raw_data_handler);
	this.driver.removeListener('state', this.state_change_handler);
	this.driver.removeListener('status',this.status_handler);
	this.machine.quit();
	this.machine.setState(this, "idle");
};


PassthroughRuntime.prototype._onDriverStateChange = function(states) {

};

PassthroughRuntime.prototype._onDriverStatus = function(status) {
	// Update our copy of the system status
	for (var key in this.machine.status) {
		if(key in status) {
			this.machine.status[key] = status[key];
		}
	}
};

PassthroughRuntime.prototype._onDriverRawData = function(raw_data) {
	this.machine.emit("raw_data",raw_data.toString());
};

PassthroughRuntime.prototype.sendRawData = function(data) {
	this.driver.write(data);
};

exports.PassthroughRuntime = PassthroughRuntime;