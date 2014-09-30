var path = require('path');
var util = require('util');
var PLATFORM = require('process').platform;

Config = require('./config').Config
log = require('../log');

// The EngineConfig object keeps track of engine-specific settings
EngineConfig = function() {
	Config.call(this);
	this.default_config_file = './config/default/engine.json'
	this.config_file = './config/data/engine.json'
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
	callback(null, data);
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
					log.warn("the parts folder can't be found : creating a new one.");
					fs.mkdir(path.normalize(getAppRoot() + (settings.parts_dir || default_conf.parts_dir)));
				}
				isDirectory(path.normalize(getAppRoot() + (settings.db_dir || default_conf.db_dir)),function(db_dir){ //db dir
					if(!db_dir){
						// wrong db dir
						log.warn("the db folder can't be found : creating a new one.");
						fs.mkdir(path.normalize(getAppRoot() + (settings.db_dir || default_conf.db_dir)));
					}
					isDirectory(path.normalize(getAppRoot() + (settings.tmp_dir || default_conf.tmp_dir)),function(tmp_dir){ //tmp dir
						if(!tmp_dir){
							// wrong tmp dir
							log.warn("the tmp folder can't be found : creating a new one.");
							fs.mkdir(path.normalize(getAppRoot() + (settings.tmp_dir || default_conf.tmp_dir)));
						}
						isDirectory(path.normalize(getAppRoot() + (settings.log_dir || default_conf.log_dir)),function(log_dir){ //log dir
							if(!log_dir){
								// wrong log dir
								log.warn("the log folder can't be found : creating a new one.");
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
			log.error("the app's root folder is corrumpted in the app_settings.json file. please fix it before relaunching the app.");
		}	
	});
}

function isDirectory(path, callback){
	fs.stat(path,function(err,stats){
		if(err) callback(undefined);
		else callback(stats.isDirectory());
	});
}

exports.EngineConfig = EngineConfig;
