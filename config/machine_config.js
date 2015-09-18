var config = require('../config');
var Config = require('./config').Config; 
var log = require('../log').logger('machine_config');
var extend = require('../util').extend;

// The EngineConfig object keeps track of engine-specific settings
var MachineConfig = function(driver) {
	Config.call(this, 'machine');
	this.driver = driver;
};
util.inherits(MachineConfig, Config);

MachineConfig.prototype.update = function(data, callback, force) {
	try {
		extend(this._cache, data, force);
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
	try {
		if(config.driver.changeUnits) {
			var units = this.get('units');
			if(units === 'in' || units === 0) {
				log.info("Changing default units to INCH");
				config.driver.changeUnits(0, callback);
			} else if(units === 'mm' || units === 1) {
				log.info("Changing default units to MM");
				config.driver.changeUnits(1, callback);
			} else {
				log.warn('Invalid units "' + gc + '"found in machine configuration.');
				callback(null);
			}
		} else {
			callback(null);
		}

	}
	catch (e) {
		callback(e);
	}
};

exports.MachineConfig = MachineConfig;
