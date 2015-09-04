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
