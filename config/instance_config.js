Config = require('./config').Config;
var log = require('../log');
var logger = log.logger('config');

// The InstanceConfig object keeps track of runtime settings - they aren't set by the user and are used for things like positional memory, etc.
InstanceConfig = function(driver) {
	Config.call(this, 'instance');
	this.driver = driver;
};
util.inherits(InstanceConfig, Config);

// The instance update function is pretty basic for now, 
// but if new values provoke a reconfiguration of the application, this is where it will be done.
InstanceConfig.prototype.update = function(data, callback) {
	console.log("Updating instance config: " + JSON.stringify(data))
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

InstanceConfig.prototype.apply = function(callback) {
	try {
		var position = this.get('position');
		this.driver.setMachinePosition(position, callback);
	}
	catch (e) {
		callback(e);
	}
};


exports.InstanceConfig = InstanceConfig;
