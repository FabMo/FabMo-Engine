async = require('async');
fs = require('fs');
var PLATFORM = require('process').platform;

var log = require('../log').logger('config')

// Config is the superclass from which all configuration objects descend
// Common functionality is implemented here.
Config = function(config_name) {
	this._cache = {};
	this.config_name = config_name;
	this.default_config_file = __dirname + '/default/' + config_name + '.json';
	this.config_file = Config.getDataDir('config') + '/' + config_name + '.json';	
	this._filename = null;
}

Config.prototype.get = function(k) {
	return this._cache[k];
}

Config.prototype.getMany = function(arr) {
	retval = {};
	for(var i in arr) {
		key = arr[i];
		retval[key] = this._cache[key];
	}
	return retval;
}

Config.prototype.set = function(k,v, callback) {
	return this.update({k:v}, callback);
}

Config.prototype.getData = function() {
	return this._cache;
}

// The load function retreives a configuration from disk and loads it into the configuration object
Config.prototype.load = function(filename, callback) {
	this._filename = filename;
	fs.readFile(filename, 'utf8', function (err, data) {
		if (err) { return callback(err); }
		try {
			data = JSON.parse(data);
		} catch (e) {
			return callback(e);
		}
		this.update(data, callback);
	}.bind(this));
}

Config.prototype.save = function(callback) {
	if(this._filename) {
		fs.writeFile(this._filename, JSON.stringify(this._cache, null, 4), callback);
	}
}

// The init function performs an initial load() from the configuration's settings files.
// For this to work, the Config object has to have a default_config_file and config_file member
Config.prototype.init = function(callback) {
		async.series(
		[
			function loadDefault(callback) { this.load(this.default_config_file, callback); }.bind(this),
			function loadUserConfig(callback) { this.load(this.config_file, function(err, data) {
				if(err) {
					if(err.code === "ENOENT") {
						log.warn('Configuration file ' + this.config_file + ' not found.');
						this.save(callback);
					} else {
						log.warn('Problem loading the user configuration file "' + this.config_file + '": ' + err.message)
						callback(null, this);
					}
				} else {
					callback(null, this);
				}
			}.bind(this)); }.bind(this)
		],
		function(err, results) {
			if(err) { callback(err); }
			else { callback(null, this); }
		}.bind(this)
	);
}

// "Static Methods"

Config.getDataDir = function(name) {
	switch(PLATFORM) {
		case 'win32':
		case 'win64':
			base = 'c:/fabmo';
			break;
		default:
			base = '/opt/fabmo';
	}
	if(name) {
		dir = base + '/' + name;
	} else {
		dir = base;
	}
	return dir
}

// Creates the data directory if it does not already exist
Config.createDataDirectories = function(callback) {
	var create_directory = function(dir, callback) {
		var dir = Config.getDataDir(dir);
		isDirectory(dir, function(isdir) {
			if(!isdir) {
				logger.warn('Directory "' + dir + '" does not exist.  Creating a new one.');
				fs.mkdir(dir, function(err) {
					if(!err) {
						logger.debug('Successfully created directory "' + dir + '"');
					}
					callback(err);
				});
			} else {
				callback(null);
			}
		});
	}.bind(this);
	dirs = [null, 'db', 'temp', 'log', 'files', 'config']
	async.eachSeries(dirs, create_directory, callback);
}

function isDirectory(path, callback){
	fs.stat(path,function(err,stats){
		if(err) callback(undefined);
		else callback(stats.isDirectory());
	});
}

exports.Config = Config
