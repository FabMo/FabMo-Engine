var path = require('path');
var util = require('util');
var PLATFORM = require('process').platform;
var exec = require('child_process').exec;
Config = require('./config').Config
log = require('../log');
logger = log.logger('config');

// The EngineConfig object keeps track of engine-specific settings
EngineConfig = function() {
	Config.call(this);
	this.default_config_file = __dirname + '/default/engine.json'
	this.config_file = __dirname + '/data/engine.json'
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

EngineConfig.prototype.getDataDir = function() { return path.normalize(getRoot() + this.get('data_dir')); }
EngineConfig.prototype.getDBDir = function() { return path.join(this.getDataDir(), 'db'); }
EngineConfig.prototype.getTempDir = function() { return path.join(this.getDataDir(), 'tmp'); }
EngineConfig.prototype.getLogDir = function() { return path.join(this.getDataDir(), 'log'); }
EngineConfig.prototype.getPartsDir = function() { return path.join(this.getDataDir(), 'parts'); }


function getRoot() {
	switch(PLATFORM) {
		case 'win32':
		case 'win64':
			return 'c:/';
		default:
			return '/';
	}
}

function correct_app_tree(callback){
	isDirectory(getAppRoot(),function(app_root_dir){ // app root dir
		if(app_root_dir){
			isDirectory(path.normalize(getAppRoot() + (settings.parts_dir || default_conf.parts_dir)),function(parts_dir){ // parts dir
				if(!parts_dir){
					// wrong parts dir
					logger.warn("the parts folder can't be found : creating a new one.");
					fs.mkdir(path.normalize(getAppRoot() + (settings.parts_dir || default_conf.parts_dir)));
				}
				isDirectory(path.normalize(getAppRoot() + (settings.db_dir || default_conf.db_dir)),function(db_dir){ //db dir
					if(!db_dir){
						// wrong db dir
						logger.warn("the db folder can't be found : creating a new one.");
						fs.mkdir(path.normalize(getAppRoot() + (settings.db_dir || default_conf.db_dir)));
					}
					isDirectory(path.normalize(getAppRoot() + (settings.tmp_dir || default_conf.tmp_dir)),function(tmp_dir){ //tmp dir
						if(!tmp_dir){
							// wrong tmp dir
							logger.warn("the tmp folder can't be found : creating a new one.");
							fs.mkdir(path.normalize(getAppRoot() + (settings.tmp_dir || default_conf.tmp_dir)));
						}
						isDirectory(path.normalize(getAppRoot() + (settings.log_dir || default_conf.log_dir)),function(log_dir){ //log dir
							if(!log_dir){
								// wrong log dir
								logger.warn("the log folder can't be found : creating a new one.");
								fs.mkdir(path.normalize(getAppRoot() + (settings.log_dir || default_conf.log_dir)));
							}
							callback(true);
						});
					});
				});
			});
		}
		else{
			// wrong app root dir
			logger.error("the app's root folder is corrupted in the app_settings.json file. please fix it before relaunching the app.");
		}	
	});
}

function isDirectory(path, callback){
	fs.stat(path,function(err,stats){
		if(err) callback(undefined);
		else callback(stats.isDirectory());
	});
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

	    	that.update({wifi_manager:true},function(e){
			logger.error(e);
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
