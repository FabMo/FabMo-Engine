var path = require('path');
var util = require('util');
var extend = require('../util').extend;
var PLATFORM = require('process').platform;

var Config = require('./config').Config;

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

OpenSBPConfig.prototype.getVariable = function(name) {
	var name = name.replace('$','');
	var variables = this._cache['variables'];
	if(variables && (name in variables)) {
		return variables[name];
	} else {
		return undefined;
	}
}

OpenSBPConfig.prototype.setVariable = function(name, value, callback) {
	var name = name.replace('$','');
	var u = {'variables' : {}}
	u.variables[name] = value;
	console.log(u)
	this.update(u, callback, true);
}

exports.OpenSBPConfig = OpenSBPConfig;
