var path = require('path');
var util = require('util');
var PLATFORM = require('process').platform;
var exec = require('child_process').exec;
Config = require('./config').Config;
log = require('../log');
logger = log.logger('config');

// The EngineConfig object keeps track of engine-specific settings
EngineConfig = function() {
	Config.call(this, 'engine');
};
util.inherits(EngineConfig, Config);

// The engine update function is pretty basic for now, 
// but if new values provoke a reconfiguration of the application, this is where it will be done.
EngineConfig.prototype.update = function(data, callback) {
	try {
		for(var key in data) {
			console.log("engine_config: update - key = " + key + " : " + data[key]);
			this._cache[key] = data[key];
		}
	} catch (e) {
		if(callback) {
			return setImmediate(callback, e);
		}
	}
	this.save(function(err, result) {
		if(err) {
			typeof callback === 'function' && callback(e);
		} else {
			typeof callback === 'function' && callback(null, data);
		}
	});
};

EngineConfig.prototype.apply = function(callback) {
	try {
		log.setGlobalLevel(this.get('log_level'));
		callback(null, this);
	}
	catch (e) {
		callback(e);
	}
};

EngineConfig.prototype.checkWifi = function(){
	/*
	try{
		// check if the dependency is installed
		wifiscanner = require('node-simplerwifiscanner');
		// check if it's a linux distrib
		if(PLATFORM!=='linux')
			throw 'not linux';
		// check if netctl-auto is installed
		exec('netctl-auto --version',function (error, stdout, stderr) {
	    	if (error)
	    		throw error;

	    	this.set('wifi_manager', true, function(err){
			if(err) {
				logger.warn(err);
			}
		}.bind(this));
	}.bind(this));

	}catch(e){
		wifiscanner = undefined;
		this.set('wifi_manager', false);
	}
	*/
};


exports.EngineConfig = EngineConfig;
