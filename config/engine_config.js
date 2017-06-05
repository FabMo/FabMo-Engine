var path = require('path');
var util = require('util');
var PLATFORM = require('process').platform;
var exec = require('child_process').exec;
Config = require('./config').Config;
var log = require('../log');
var logger = log.logger('config');

// The EngineConfig object keeps track of engine-specific settings
EngineConfig = function() {
	Config.call(this, 'engine');
};
util.inherits(EngineConfig, Config);

// The engine update function is pretty basic for now, 
// but if new values provoke a reconfiguration of the application, this is where it will be done.
EngineConfig.prototype.update = function(data, callback) {
	var profile_changed = false;
	try {
		for(var key in data) {
			if(
				(key === 'profile') && 
				(key in this._cache) && 
				(data[key] != this._cache[key]) &&
				(this.userConfigLoaded)) {
				
				profile_changed = true;
			}
			this._cache[key] = data[key];
		}
	} catch (e) {
		if(callback) {
			return setImmediate(callback, e);
		}
	}
	var that = this;
	function save(callback) {
		that.save(function(err, result) {
			if(err) {
				typeof callback === 'function' && callback(e);
			} else {
				typeof callback === 'function' && callback(null, data);
			}
		});
	};
	if(profile_changed) {
		logger.warn('Engine profile changed - engine should be restarted.')
		Config.deleteProfileData(function(err) {
			save(function(err) {
				if(err) { return callback(err); }
				process.exit(1);
				//callback();
			})
		});
	} else {
		save(callback);
	}
};

EngineConfig.prototype.apply = function(callback) {
	try {
		log.setGlobalLevel(this.get('log_level'));
		callback(null, this);
	}
	catch (e) {
		callback(e);
	}
};


exports.EngineConfig = EngineConfig;
