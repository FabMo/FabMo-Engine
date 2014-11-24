var path = require('path');
var util = require('util');
var PLATFORM = require('process').platform;
var exec = require('child_process').exec;
Config = require('./config').Config
log = require('../log');
logger = log.logger('config');

// The EngineConfig object keeps track of engine-specific settings
EngineConfig = function() {
	Config.call(this, 'engine');
}
util.inherits(EngineConfig, Config);

// The engine update function is pretty basic for now, 
// but if new values provoke a reconfiguration of the application, this is where it will be done.
EngineConfig.prototype.update = function(data, callback) {
	try {
		for(key in data) {
			this._cache[key] = data[key];
		}
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
}

EngineConfig.prototype.apply = function(callback) {
	try {
		log.setGlobalLevel(this.get('log_level'));
		callback(null, this);
	}
	catch (e) {
		callback(e);
	}
}

EngineConfig.prototype.checkWifi = function(){
	var that = this;
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

	    	that.update({wifi_manager:true},function(err){
			if(err) {
				logger.warn(e);
			}
		});
	});

	}catch(e){
		wifiscanner = undefined;
		that.update({wifi_manager:false},function(e){
			logger.error(e);
		});
	}

}


exports.EngineConfig = EngineConfig;
