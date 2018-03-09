var Config = require('./config').Config;
var log = require('../log').logger('dashboard_config');

// The DashboardConfig object keeps track of engine-specific settings
var DashboardConfig = function(driver) {
	Config.call(this, 'dashboard');
	this.driver = driver;
};
util.inherits(DashboardConfig, Config);

DashboardConfig.prototype.update = function(data, callback) {
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

DashboardConfig.prototype.apply = function(callback) {
	// Ideally, nothing happens here, because this is just a data store
};

exports.DashboardConfig = DashboardConfig;
