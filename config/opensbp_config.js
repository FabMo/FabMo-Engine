/*
 * opensbp_config.js
 *
 * Configuration tree for the OpenSBP runtime.
 * TODO - There should be some kind of thought applied to how configuration tree branches
 *        that apply specifically to runtimes are created/managed. This configuration module
 *        is basically a part of the OpenSBP runtime, but lives in the configuration tree - 
 *        it is poor separation of concerns.
 */
var fs = require('fs-extra');
var path = require('path');
var util = require('util');
var extend = require('../util').extend;
var PLATFORM = require('process').platform;
var log = require('../log').logger('config');

var Config = require('./config').Config;

// The OpenSBP configuration object manages the settings related to the OpenSBP runtime.
// Importantly, it keeps a field called `variables` which is a map of variable names to values
// that correspond to the persistent (dollar-sign) variables in OpenSBP - The OpenSBP runtime
// consults this configuration whenever persistent variables are read or written - it is what 
// lends the persistence to those variables.
OpenSBPConfig = function() {
	Config.call(this, 'opensbp');
};
util.inherits(OpenSBPConfig, Config);

// Overide of Config.prototype.load removing tempVariables on load.  See config.js
// TODO:  This is duplicated code from config.js as a work around for the cache not being accesible in callbacks.
OpenSBPConfig.prototype.load = function(filename, callback) {
	this._filename = filename;
	fs.readFile(filename, 'utf8', function (err, data) {
		if (err) { return callback(err); }
		try {
			data = JSON.parse(data);
		} catch (e) {
			log.error(e);
			return callback(e);
		}
		if(data.hasOwnProperty('tempVariables')) {
			delete data['tempVariables'];
		}
log.debug("... calling config update")
		this.update(data, function(err, d) {
			callback(err, data);
		}, true);
	}.bind(this));
};

// Update the tree with the provided data.  Nothing special here.
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

// Apply this configuration.  Currently this is a NOOP
OpenSBPConfig.prototype.apply = function(callback) {
	setImmediate(callback, null);
};

// Return the value of the variable with the specified name
//   name - The variable name to retrieve the value for, with or without the dollar sign.
OpenSBPConfig.prototype.getVariable = function(name) {
	var scrubbedName = name.replace('$','');
	var variables = this._cache['variables'];
	if(variables && (scrubbedName in variables)) {
		return variables[scrubbedName];
	} else {
		throw new Error("Variable " + name + " was used but not defined.");
	}
}

// Set the variable named to the provided value.
// TODO - Sanitize the variable name (you could set super illegal dumb stuff here)
//       name - The name of the variable to set, with or without a dollar sign
//      value - The value to assign
//   callback - Called with an object mapping key to value, or error if error.
OpenSBPConfig.prototype.setVariable = function(name, value, callback) {
	var name = name.replace('$','');
	var u = {'variables' : {}}
	u.variables[name] = value;
	this.update(u, callback, true);
}

// Return true if the provided variable has been defined (with or without dollar sign)
OpenSBPConfig.prototype.hasVariable = function(name) {
	var name = name.replace('$','');
	return name in this._cache.variables;
}

// Return the value of the temp variable with the specified name
//   name - The temp variable name to retrieve the value for, with or without the ampersand.
OpenSBPConfig.prototype.getTempVariable = function(name) {
	var scrubbedName = name.replace('&','');
	var tempVariables = this._cache['tempVariables'];
	if(tempVariables && (scrubbedName in tempVariables)) {
		return tempVariables[scrubbedName];
	} else {
		throw new Error("Temp Variable " + name + " was used but not defined.");
	}
}

// Set the temp variable named to the provided value.
// TODO - Sanitize the temp variable name (you could set super illegal dumb stuff here)
//       name - The name of the variable to set, with or without a ampersand
//      value - The value to assign
//   callback - Called with an object mapping key to value, or error if error.
OpenSBPConfig.prototype.setTempVariable = function(name, value, callback) {
	var name = name.replace('&','');
	var u = {'tempVariables' : {}}
	u.tempVariables[name] = value;
	this.update(u, callback, true);
}

// Return true if the provided temp variable has been defined (with or without ampersand)
OpenSBPConfig.prototype.hasTempVariable = function(name) {
	var name = name.replace('&','');
	return name in this._cache.tempVariables;
}

exports.OpenSBPConfig = OpenSBPConfig;
