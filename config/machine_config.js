var config = require('../config');
var Config = require('./config').Config;
var log = require('../log').logger('machine_config');
var u = require('../util');

// The EngineConfig object keeps track of engine-specific settings
var MachineConfig = function() {
	Config.call(this, 'machine');
};
util.inherits(MachineConfig, Config);

MachineConfig.prototype.init = function(machine, callback) {
	this.machine = machine;
	Config.prototype.init.call(this, callback);
}

MachineConfig.prototype.update = function(data, callback, force) {
	try {
		u.extend(this._cache, data, force);
	} catch (e) {
		return callback(e);
	}
	this.save(function(err, result) {
		if(err) {
			callback(err);
		} else {
			callback(null, data);
		}
	});
};

MachineConfig.prototype.apply = function(callback) {
	if(this.get('auth_timeout') === 0) {
		this.machine.authorize();
	} else {
		this.machine.deauthorize();
	}
	this.machine.setPreferredUnits(this.get('units'), callback);
};

exports.MachineConfig = MachineConfig;
