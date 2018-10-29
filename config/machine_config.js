/*
 * machine_config.js
 *
 * Covers "machine" settings.  Separate from engine settings, which are settings related to how
 * the server software works specifically, the machine configuration stores information about the tool
 * as a CNC machine - settings related to speeds, tool dimensions, how things are setup.
 */
var config = require('../config');
var Config = require('./config').Config;
var log = require('../log').logger('machine_config');
var u = require('../util');

var MachineConfig = function() {
	Config.call(this, 'machine');
};
util.inherits(MachineConfig, Config);

MachineConfig.prototype.init = function(machine, callback) {
	this.machine = machine;
	Config.prototype.init.call(this, callback);
}

// Convenience function that rounds a number to the appropriate number of decimals for the current unit type.
function round(number, units) {
	var decimals = units == 'mm' ? 100 : 1000;
	return Math.round(number*decimals)/decimals
}

// 
MachineConfig.prototype.update = function(data, callback, force) {
	var current_units = this.get('units');

	try {
		u.extend(this._cache, data, force);
	} catch (e) {
		return callback(e);
	}

	// Convert internal values that are in length units back and forth between the two unit
	// systems if the unit systems has changed.
	if('units' in data) {
		new_units = data.units;
		if(!force && current_units && current_units != new_units) {
			var conv = (new_units == 'mm') ? 25.4 : 1/25.4;

			['xmin','xmax','ymin','ymax'].forEach(function(key) {
				this._cache.envelope[key] = round(this._cache.envelope[key]*conv, new_units);
			}.bind(this));

			['xy_speed',
			 'z_speed',
			 'xy_increment',
			 'z_increment', 
			 'xy_min', 
			 'xy_max', 
			 'xy_jerk', 
			 'z_jerk'].forEach(function(key) {
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

// Apply this configuration.
//   callback - Called once everything has been applied, or with error.
MachineConfig.prototype.apply = function(callback) {

	// If we disable authorization, authorize indefinitely.  If we enabled it, revoke it.
	if(this.get('auth_timeout') === 0) {
		this.machine.authorize();
	} else {
		this.machine.deauthorize();
	}

	// Apply units (The machine will only apply these if there was an actual change)
	this.machine.setPreferredUnits(this.get('units'), function() {callback(); });
};

exports.MachineConfig = MachineConfig;
