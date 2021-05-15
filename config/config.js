/*
 * config.js
 *
 * Defines the superclass for all configuration objects, along with a number of 
 * functions that support configuration in the FabMo system.
 *
 * A Config object is essentially a JSON object wrapped up with some functions for saving and loading.
 * Methods are provided for updating keys/values in the object easily, in such a way that configuration changes
 * coming from a client or from files on disk can be easily merged into an active configuration.
 *
 * Subclasses of the Config object are topic-specific configuration implementations.  In addition to keeping
 * track of the data that is their charge, they are responsible for applying those configurations to the 
 * systems they manage.  One example of this is g2_config.js, which keeps its config values synchronized with
 * the G2 motion systems, updating them when they change.
 */

var async = require('async');
var fs = require('fs-extra');
var path = require('path');
var PLATFORM = require('process').platform;
var log = require('../log').logger('config');
var EventEmitter = require('events').EventEmitter;
var util = require('util');

// Config is the superclass from which all configuration objects descend
//   config_name - All configuration objects have a name, which among other things,
//                 determines the filename for the stored configuration.
var Config = function(config_name) {
	this._cache = {};
	this.config_name = config_name;
	this._loaded = false;
	this.userConfigLoaded = false;
	EventEmitter.call(this);
};
util.inherits(Config,EventEmitter);

// Get a named value
//   k - The key for which to retrieve a value
Config.prototype.get = function(k) {
	return this._cache[k];
};

// Return true if this configuration object has the provided value
//   k - key to check
Config.prototype.has = function(k) {
	return this._cache.hasOwnProperty(k);
}

// Get the values for the provided array of keys.
// Returns an object mapping keys to values.
//   arr - list of keys
Config.prototype.getMany = function(arr) {
	retval = {};
	for(var i in arr) {
		key = arr[i];
		retval[key] = this._cache[key];
	}
	return retval;
};

// Set the configuration value for the provided key.
// This causes the configuration to be saved to disk
// This function calls `update()` internally, which is provided by subclasses
//          k - The key value
//          v - The new values
//   callback - Called once the config is updated (which might take some time)
Config.prototype.set = function(k,v, callback) {
	var u = {}
	u[k] = v;
	this.setMany(u, callback);
};

// Set the key value pairs supplied by `data` on this config object
// This causes the configuration to be saved to disk.
//       data - Object containing the keys/values to update
//   callback - Called with updated values on success or with error if error
Config.prototype.setMany = function(data, callback) {
	log.debug("==> call Set Many with:  ", data, callback)  ////##
	this.update(data, function(err, result) {
		if(callback && typeof callback === 'function') {
			callback(err, result);
		} else {
			log.warn("No callback passed to setMany");
		}
		this.emit('change', data);
	}.bind(this));
}

// Delete all of the provided keys from this configuration object
//   keys - List of keys to remove
Config.prototype.deleteMany = function(keys, callback) {
	keys.forEach(function(k) {
		if(k in this._cache) {
			delete this._cache[k]
		}
	}.bind(this));
	this.save(callback);
}

// Delete the provided key from this configuration object
//   key - The key to delete
Config.prototype.delete = function(k, callback) {
	this.deleteMany([k], callback);
}

// Get an object that represents the entirety of this coniguration object
// Careful, this returns the actual cache (TODO maybe do a deep clone of this data)
Config.prototype.getData = function() {
	return this._cache;
};

// The load function retreives a configuration from disk and loads it into the configuration object
//  filename - Full path to the file to load (JSON)
//  callback - called when complete with the loaded data (or error)
Config.prototype.load = function(filename, callback) {
	this._filename = filename;
	fs.readFile(filename, 'utf8', function (err, data) {
		if (err) { return callback(err); }
		try {
			data = JSON.parse(data);
		} catch (e) {
			log.error(e);
			return callback(e);
		}
		this.update(data, function(err, d) {
			callback(err, data);
		}, true);
	}.bind(this));
};

// Write this configuration object to disk
//   callback - Called with null once the configuration is saved (or with error if error)
Config.prototype.save = function(callback) {
	var config_file = this.getConfigFile();
	//log.stack(); ////## maybe use this to get at logic for config reporting after some file runs
	if(this._loaded && config_file) {
		log.debug("Saving config to " + config_file);
		fs.open(config_file, 'w', function(err, fd) {
			if(err) {
				log.error(err);
				callback(err);
			} else {
				var cfg = new Buffer(JSON.stringify(this._cache, null, 4));
				fs.write(fd, cfg, 0, cfg.length, 0, function(err, written, string) {
					if(err) {
						log.error(err);
						callback(err);
					} else {
						fs.fsync(fd, function(err) {
							if(err) {
								log.error(err);
							}
							fs.closeSync(fd);
							log.debug('fsync()ed ' + config_file);
							log.debug("===> state the error for save function") ////##
							callback(err);
						}.bind(this));
					}
				}.bind(this));
			}
		}.bind(this));
	} else {
		setImmediate(callback);
	}
};

// The init function performs an initial load() from the configuration's settings files.
// For this to work, the Config object has to have a default_config_file and config_file member
Config.prototype.init = function(callback) {
		var default_count;
        var user_count;
        var default_config_file = this.getDefaultConfigFile();
        var profile_config_file = this.getProfileConfigFile();
        var config_file = this.getConfigFile();
        async.series(
		[
			function loadDefault(callback) { this.load(default_config_file, callback); }.bind(this),
			function saveDefaultCount(callback) {
				default_count = Object.keys(this._cache).length;
				callback();
			}.bind(this),
			function loadUserConfig(callback) {
				this.load(config_file, function(err, data) {
					if(err) {
						if(err.code === "ENOENT") {
							log.warn('Configuration file ' + config_file + ' not found.');
                            this._loaded = true;
							this.save(callback, true);
						} else {
							log.warn('Problem loading the user configuration file "' + config_file + '": ' + err.message);
							this._loaded = true;
							this.userConfigLoaded = true;
							this.save(callback);
						}
					} else {
						this._loaded = true;
						this.userConfigLoaded = true;
						user_count = Object.keys(data).length;
						callback(null, this);
					}
				}.bind(this));
			}.bind(this),
			function saveIfNeeded(callback) {
				if(default_count != user_count) {
					this.save(callback);
				} else {
					callback();
				}
			}.bind(this)
		],
		function(err, results) {
			if(err) { callback(err); }
			else { callback(null, this); }
		}.bind(this)
	);
};

// Return the path to the file containing the default values for this configuration
Config.prototype.getDefaultConfigFile = function() {
	return Config.getDefaultProfileDir('config') + this.config_name + '.json';
}

// TODO I think this function is a relic from an earlier version of profiles.
Config.prototype.getProfileConfigFile = function() {
	return Config.getProfileDir('config') + this.config_name + '.json';
}

// Return the path to the file where this configuration stores its data
Config.prototype.getConfigFile = function() {
	return Config.getDataDir('config') + '/' + this.config_name + '.json';
}

// "Static Methods"

// TODO - Probably factor out, old profile
Config.getProfileDir = function(d) {
	var profile = Config.getCurrentProfile() || 'default';
	return __dirname + '/../profiles/' + profile + '/' + (d ? (d + '/') : '');
}

// TODO - Probably factor out, old profile stuff
Config.getDefaultProfileDir = function(d) {
	return __dirname + '/../profiles/default/' + (d ? (d + '/') : '');
}

// Get the mutable data directory for FabMo
// On unix-like systems, this is /opt/fabmo
Config.getDataDir = function(name) {
	switch(PLATFORM) {
		case 'win32':
		case 'win64':
			base = 'c:\\fabmo';
			break;
		default:
			base = '/opt/fabmo';
	}
	if(name) {
		dir = base + path.sep + name;
	} else {
		dir = base;
	}
	return dir;
};

// TODO probably not needed anymore
Config.getCurrentProfile = function() {
	var cfg = require('./index');
	return cfg.engine.get('profile');
}

// Delete all macros
// TODO - Should this just be in the macros module?
// TODO this removeSync pattern is bad, should we do this with proper asynchronous calls?
Config.deleteUserMacros = function(callback) {
	var installedMacrosDir = Config.getDataDir('macros');
	fs.readdir(installedMacrosDir, function(err, files) {
		if(err) { return callback(err); }
	  	try {  		
		  	files.forEach(function(file) {
		  		var to_delete = path.join(installedMacrosDir, file);
		  		fs.removeSync(to_delete);
		  	});
	  		callback();
	  	} catch(e) {
	  		log.error(e);
	  		callback(e);
	  	}
	})
}

// Delete all user configuration files, except for auth_secret and engine/updater.json
// TODO this removeSync pattern is bad, should we do this with proper asynchronous calls?
Config.deleteUserConfig = function(callback) {
	var config_dir = Config.getDataDir('config');
	fs.readdir(config_dir, function(err, files) {
		if(err) { return callback(err); }
	  	try {  		
		  	files.forEach(function(file) {
		  		if(file.search(/auth_secret|engine\.json|updater\.json$/i) === -1) { 
					var p = path.join(config_dir, file);
			  		fs.removeSync(p);
		  		}
		  	});
	  		callback();
	  	} catch(e) {
	  		log.error(e);
	  		callback(e);
	  	}
	})
}

// Clear configura
Config.deleteProfileData = function(callback) {
	Config.deleteUserConfig(function(err, data) {
		if(err) { log.error(err); }
		Config.deleteUserMacros(callback);
	});
}

// Creates the data directory and subdirectories if they do not already exist
Config.createDataDirectories = function(callback) {
	var create_directory = function(dir, callback) {
		dir = Config.getDataDir(dir);
		isDirectory(dir, function(isdir) {
			if(!isdir) {
				log.warn('Directory "' + dir + '" does not exist.  Creating a new one.');
				fs.mkdir(dir, function(err) {
					if(!err) {
						log.info('Successfully created directory "' + dir + '"');
					}
					callback(err);
				});
			} else {
				callback(null);
			}
		});
	}.bind(this);
	dirs = [null, 'debug', 'backup', 'db', 'log', 'files', 'config', 'apps', 'macros', 'profiles', 'approot', path.join('approot','approot')];
	async.eachSeries(dirs, create_directory, callback);
};

// Convenience function for determining if path is a directory
// TODO - util.js?  Necessary?
function isDirectory(path, callback){
	fs.stat(path,function(err,stats){
		if(err) callback(undefined);
		else callback(stats.isDirectory());
	});
}

exports.Config = Config;
