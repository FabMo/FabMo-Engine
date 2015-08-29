var path = require('path');
var util = require('util');
var extend = require('../util').extend;
var PLATFORM = require('process').platform;

Config = require('./config').Config;
log = require('../log');

// The EngineConfig object keeps track of engine-specific settings
OpenSBPConfig = function() {
	Config.call(this, 'opensbp');
};
util.inherits(OpenSBPConfig, Config);

OpenSBPConfig.prototype.update = function(data, callback, force) {
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

OpenSBPConfig.prototype.setMany = OpenSBPConfig.prototype.update;

OpenSBPConfig.prototype.apply = function(callback) {
	setImmediate(callback, null);
};


exports.OpenSBPConfig = OpenSBPConfig;
