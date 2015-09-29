var async = require('async');
var fs = require('fs');
var path = require('path');
var PLATFORM = require('process').platform;
var log = require('../log').logger('config');

// Config is the superclass from which all configuration objects descend
// Common functionality is implemented here.
Config = function(config_name) {
	this._cache = {};
	this.config_name = config_name;
	this.default_config_file = __dirname + '/default/' + config_name + '.json';
	this.config_file = Config.getDataDir('config') + '/' + config_name + '.json';
	this._loaded = false;
	this.userConfigLoaded = false;
};

Config.prototype.get = function(k) {
	return this._cache[k];
};

Config.prototype.getMany = function(arr) {
	retval = {};
	for(var i in arr) {
		key = arr[i];
		retval[key] = this._cache[key];
	}
	return retval;
};

Config.prototype.set = function(k,v, callback) {
	return this.update({k:v}, callback);
};

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
		this.update(data, callback, true);
	}.bind(this));
};

Config.prototype.save = function(callback) {
	if(this._loaded && this.config_file) {
		log.debug("Saving config to " + this.config_file);
		fs.open(this.config_file, 'w', function(err, fd) {
			var fd_for_sync = fd;
			if(err) {
				log.error(err);
			} else {
				fs.write(fd, JSON.stringify(this._cache, null, 4), function(err, written, string) {
					if(err) {
						log.error(err);
						callback(err);
					} else {
						fs.fsync(fd, function(err) {
							if(err) {
								log.error(err);
							}
							log.debug('fsync()ed ' + this.config_file);
							callback(err);
						}.bind(this));
					}
				}.bind(this));
			}
		}.bind(this));
		/*
		fs.writeFile(this.config_file, JSON.stringify(this._cache, null, 4), function(err, data) {
			log.debug("Config file saved.");
			callback(err, data);
		});
		*/
	} else {
		setImmediate(callback);
	}
};

// The init function performs an initial load() from the configuration's settings files.
// For this to work, the Config object has to have a default_config_file and config_file member
Config.prototype.init = function(callback) {
		async.series(
		[
			function loadDefault(callback) { this.load(this.default_config_file, callback); }.bind(this),
			function loadUserConfig(callback) { 
				this.load(this.config_file, function(err, data) {
					if(err) {
						if(err.code === "ENOENT") {
							log.warn('Configuration file ' + this.config_file + ' not found.');
							this._loaded = true;
							this.save(callback, true);
						} else {
							log.warn('Problem loading the user configuration file "' + this.config_file + '": ' + err.message);
							this._loaded = true;
							this.userConfigLoaded = true;
							this.save(callback);
						}
					} else {
						this._loaded = true;
						this.userConfigLoaded = true;
						callback(null, this);
					}
				}.bind(this)); 
			}.bind(this)
		],
		function(err, results) {
			if(err) { callback(err); }
			else { callback(null, this); }
		}.bind(this)
	);
};

// "Static Methods"

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
