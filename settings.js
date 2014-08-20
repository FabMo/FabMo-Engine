var PLATFORM = require('process').platform;
var settings;
try{settings= require('./app_settings');}catch(ex){settings= undefined;};
var fs = require('fs');
var util = require('util');
var path=require('path');

var log_conf = require('./log')
var log = log_conf.logger('settings');
var settings_filename = "app_settings.json";

var default_conf = {
	"server_port" : 8080,
	"driver" : "g2",
	"debug_lvl" : "info", // info level
	"install_dir": "/opt/shopbot/",
	"parts_dir" : "./parts/",
	"db_dir" : "./db/",
	"log_dir":"./log",
	"tmp_dir":"./tmp"
};



if (!settings)
{
	fs.writeFile(settings_filename, JSON.stringify(default_conf, null, 4), function(err){
		if (err) throw err;
  		log.info('settings file created');
  		settings = require('./app_settings');
  		correct_app_tree(function(correct){
  			if(correct)
	  		{
	  			set_export();
	  			log_conf.setGlobalLevel(exports.debug_lvl);
	  		}
  		});
  		

	});
}
else
{
	correct_app_tree(function(correct){
		log.info('correctly read the settings file');
  		if(correct)
  		{
  			set_export();
  			log_conf.setGlobalLevel(exports.debug_lvl);
  		}
  	});
}


function set_export(){
	exports.server_port = settings.server_port || default_conf.server_port;
	exports.driver = settings.driver || default_conf.driver;
	exports.debug_lvl = (settings.debug_lvl === undefined)? default_conf.debug_lvl : settings.debug_lvl;
	exports.app_root_dir = getAppRoot();
	exports.upload_dir = path.normalize( getAppRoot() + (settings.parts_dir || default_conf.parts_dir));
	exports.db_dir = path.normalize( getAppRoot()+ (settings.db_dir || default_conf.db_dir) );

}

function getRoot() {
	switch(PLATFORM) {
		case 'win32':
		case 'win64':
			return 'c:/';
		case 'linux':
		case 'darwin':
		default:
			return '/';
	}
}

function getAppRoot() {
	return path.normalize(getRoot() + (settings.install_dir || default_conf.install_dir));
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


