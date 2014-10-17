var path = require('path');
var util = require('util');
var PLATFORM = require('process').platform;

Config = require('./config').Config
log = require('../log');

// The EngineConfig object keeps track of engine-specific settings
OpenSBPConfig = function() {
	Config.call(this);
	this.default_config_file = './config/default/opensbp.json'
	this.config_file = './config/data/opensbp.json'
}
util.inherits(OpenSBPConfig, Config);

OpenSBPConfig.prototype.update = function(data, callback) {
	try {
		for(key in data) {
			this._cache[key] = data[key];
		}
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
}

OpenSBPConfig.prototype.setMany = OpenSBPConfig.prototype.update;

OpenSBPConfig.prototype.apply = function(callback) {
	setImmediate(callback, null);
}


exports.OpenSBPConfig = OpenSBPConfig;
