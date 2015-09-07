var Config = require('./config').Config;
var log = require('../log').logger('machine_config');

// The EngineConfig object keeps track of engine-specific settings
var MachineConfig = function(driver) {
	Config.call(this, 'machine');
	this.driver = driver;
};
util.inherits(MachineConfig, Config);

MachineConfig.prototype.update = function(data, callback) {
	try {
		for(var key in data) {
			this._cache[key] = data[key];
		}
	} catch (e) {
		if(callback) {
			return setImmediate(callback, e);
		}
	}
	this.save(function(err, result) {
		if(err) {
			typeof callback === 'function' && callback(e);
		} else {
			typeof callback === 'function' && callback(null, data);
		}
	});
};

MachineConfig.prototype.apply = function(callback) {
	try {
		callback(null, this);
		if(this.get('units') == 'in') {
			gc = 'G20';			
		} else if(this.get('units') == 'mm') {
			gc = 'G21';
		} else {
			gc = null;
			log.warn('Invalid units "' + gc + '"found in machine configuration.');
		}
		if(gc) {
			this.driver.runString(gc);
		}
	}
	catch (e) {
		callback(e);
	}
};

exports.MachineConfig = MachineConfig;
