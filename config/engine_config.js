/*
 * engine_config.js
 * 
 * This file defines the configuration for the engine.
 *
 * When the profile is changed, the new profile is applied as needed.
 * When the log level changes, apply that change immediately to the logging system.
 */
var path = require('path');
var util = require('util');
var fs = require('fs-extra');
var PLATFORM = require('process').platform;
var G2 = require('../g2.js');
var exec = require('child_process').exec;
var Config = require('./config').Config;
var log = require('../log');
var logger = log.logger('config');
var profiles = require('../profiles');

// The EngineConfig object keeps track of engine-specific settings
EngineConfig = function() {
	Config.call(this, 'engine');
};
util.inherits(EngineConfig, Config);

// The update function
// Nothing special here EXCEPT:
// If the value passed in for the profile is different than the current profile, we write
// the configuration to disk and exit the engine altogether.  It is assumed that systemd (or whoever launched the engine)
// will pick up and restart the engine after the abort.
EngineConfig.prototype.update = function(data, callback) {
	var profile_changed = false;
	try {
		for(var key in data) {
			if((key === 'profile')) {
				var newProfile = data[key];
				// Make note if the profile changed.  If so, we want to apply the new profile
				// (Which will probably make a bunch of sweeping configuration changes)
				if((key in this._cache) && (data[key] != this._cache[key])) {
					try { logger.info("Profile changed from " + this._cache[key] + ' to ' + data[key]); }
					catch(err) {}
					profile_changed = true;
				} else {
					logger.info('Profile is unchanged.');
				}
			}
			this._cache[key] = data[key];				
		}
	} catch (e) {
		if(callback) {
			return setImmediate(callback, e);
		}
	}

	// TODO - fix the that=this pattern - it's obnoxious.  Bind, or eventually arrow function
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
	// If the profile changed above, we apply it, and if that was successful, we abort the process.
	if(profile_changed) {
		logger.warn('Engine profile changed - engine will be restarted.')
		profiles.apply(newProfile, function(err, data) {
			if(err) {
				console.log(err);
				callback(err);
			} else {
				console.log('shutting down');
				console.log(process.exit());
				process.exit(1);
			}
		});
	} else {
		save(callback);
	}
};

// Apply the engine settings
//   callback - Called when settings have been applied or with error if error
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
