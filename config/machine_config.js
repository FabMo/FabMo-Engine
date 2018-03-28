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

function round(number, units) {
	var decimals = units == 'mm' ? 100 : 1000;
	return Math.round(number*decimals)/decimals
}

MachineConfig.prototype.update = function(data, callback, force) {
	var current_units = this.get('units');

	try {
		u.extend(this._cache, data, force);
	} catch (e) {
		return callback(e);
	}

	if('units' in data) {
		new_units = data.units;
		if(!force && current_units && current_units != new_units) {
			var conv = (new_units == 'mm') ? 25.4 : 1/25.4;

			['xmin','xmax','ymin','ymax'].forEach(function(key) {
				this._cache.envelope[key] = round(this._cache.envelope[key]*conv, new_units);
			}.bind(this));

			['xy_speed','z_speed','xy_increment','z_increment', 'xy_min', 'xy_max', 'xy_jerk', 'z_jerk'].forEach(function(key) {
				this._cache.manual[key] = round(this._cache.manual[key]*conv, new_units);
			}.bind(this));
		}
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
	this.machine.setPreferredUnits(this.get('units'), function() {callback(); });
};

exports.MachineConfig = MachineConfig;
