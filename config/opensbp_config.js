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
		// extend(this._cache, data, force);
		this._cache = Object.assign(this._cache, data);
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

// OpenSBPConfig.prototype.setMany = OpenSBPConfig.prototype.update;

OpenSBPConfig.prototype.apply = function(callback) {
	setImmediate(callback, null);
};

OpenSBPConfig.prototype.getVariable = function(name) {
	var scrubbedName = name.replace('$','');
	var variables = this._cache['variables'];
	if(variables && (scrubbedName in variables)) {
		return variables[scrubbedName];
	} else {
		throw new Error("Variable " + name + " was used but not defined.");
	}
}

OpenSBPConfig.prototype.setVariable = function(name, value, callback) {
	var name = name.replace('$','');
	var u = {'variables' : {}}
	u.variables[name] = value;
	this.update(u, callback, true);
}

OpenSBPConfig.prototype.hasVariable = function(name) {
	var name = name.replace('$','');
	return name in this._cache.variables;
}

exports.OpenSBPConfig = OpenSBPConfig;
