/*
 * opensbp_config.js
 *
 * Configuration tree for the OpenSBP runtime.
 * TODO - There should be some kind of thought applied to how configuration tree branches
 *        that apply specifically to runtimes are created/managed. This configuration module
 *        is basically a part of the OpenSBP runtime, but lives in the configuration tree - 
 *        it is poor separation of concerns.
 */
var path = require('path');
var util = require('util');
var extend = require('../util').extend;
var PLATFORM = require('process').platform;

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

exports.OpenSBPConfig = OpenSBPConfig;
