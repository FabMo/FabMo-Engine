var async = require('async');
var fs = require('fs-extra');
var path = require('path');
var PLATFORM = require('process').platform;
var log = require('../log').logger('config');
var EventEmitter = require('events').EventEmitter;
var util = require('util');

// Config is the superclass from which all configuration objects descend
var Config = function(config_name) {
	this._cache = {};
	this.config_name = config_name;
	this._loaded = false;
	this.userConfigLoaded = false;
	EventEmitter.call(this);
};
util.inherits(Config,EventEmitter);

Config.prototype.get = function(k) {
	return this._cache[k];
};

Config.prototype.has = function(k) {
	return this._cache.hasOwnProperty(k);
}

Config.prototype.getMany = function(arr) {
	retval = {};
	for(var i in arr) {
		key = arr[i];
		retval[key] = this._cache[key];
	}
	return retval;
};

Config.prototype.set = function(k,v, callback) {
	var u = {}
	u[k] = v;
	this.setMany(u, callback);
};

Config.prototype.setMany = function(data, callback) {
	this.update(data, function(err, result) {
		if(callback && typeof callback === 'function') {
			callback(err, result);
		} else {
			log.warn("No callback passed to setMany");
		}
		this.emit('change', data);
	}.bind(this));
}

Config.prototype.deleteMany = function(keys, callback) {
	keys.forEach(function(k) {
		if(k in this._cache) {
			delete this._cache[k]
		}
	}.bind(this));
	this.save(callback);
}

Config.prototype.delete = function(k, callback) {
	this.deleteMany([k], callback);
}

Config.prototype.getData = function() {
	return this._cache;
};

// The load function retreives a configuration from disk and loads it into the configuration object
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

Config.prototype.save = function(callback) {
	var config_file = this.getConfigFile();
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
			function loadProfile(callback) { this.load(profile_config_file, callback); }.bind(this),
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

Config.prototype.getDefaultConfigFile = function() {
	return Config.getDefaultProfileDir('config') + this.config_name + '.json';
}

Config.prototype.getProfileConfigFile = function() {
	return Config.getProfileDir('config') + this.config_name + '.json';
}

Config.prototype.getConfigFile = function() {
	return Config.getDataDir('config') + '/' + this.config_name + '.json';
}

// "Static Methods"

Config.getProfileDir = function(d) {
	var profile = Config.getCurrentProfile() || 'default';
	return __dirname + '/../profiles/' + profile + '/' + (d ? (d + '/') : '');
}

Config.getDefaultProfileDir = function(d) {
	return __dirname + '/../profiles/default/' + (d ? (d + '/') : '');
}

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

Config.getCurrentProfile = function() {
	var cfg = require('./index');
	return cfg.engine.get('profile');
}

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

Config.deleteProfileData = function(callback) {
	Config.deleteUserConfig(function(err, data) {
		if(err) { log.error(err); }
		Config.deleteUserMacros(callback);
	});
}
// Creates the data directory if it does not already exist
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
	dirs = [null, 'debug', 'db', 'log', 'files', 'config', 'apps', 'macros', 'approot', path.join('approot','approot')];
	async.eachSeries(dirs, create_directory, callback);
};

function isDirectory(path, callback){
	fs.stat(path,function(err,stats){
		if(err) callback(undefined);
		else callback(stats.isDirectory());
	});
}

exports.Config = Config;
