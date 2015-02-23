var zip = require('adm-zip');
var path = require('path');
var os = require('os');
var ncp = require('ncp').ncp;
var fs = require('fs-extra');
var async = require('async');
var uuid = require('node-uuid');
var log = require('../log').logger('app_manager');
var util = require('../util');

// Maximum depth of a deep copy operation
ncp.limit = 16;

var AppManager = function(options) {
	this.app_directory = options.app_directory;
	this.approot_directory = options.approot_directory;
	this.system_app_directory = path.join(__dirname, 'apps');
	this.apps_index = {};
	this.apps_list = [];
}

AppManager.prototype.readAppPackageInfo = function(app_info, callback) {
	log.debug("Reading app package info");
	log.debug(JSON.stringify(app_info));
	var pkg_info_path = path.join(app_info.app_path, 'package.json');
	var pathname = path.basename(app_info.app_archive_path);
	fs.readFile(pkg_info_path, function(err, data) {
		try {
			var package_info = JSON.parse(data);
			app_info.name = package_info.name;
			app_info.icon_path = app_info.app_path + package_info.icon;
			app_info.icon_background_color = package_info.icon_color || 'blue';
			app_info.icon_display = package_info.icon_display;
			app_info.app_url = path.join('approot', pathname, package_info.main);
			app_info.icon_url = path.join('approot', pathname, package_info.icon);
			app_info.id = package_info.id || uuid.v1();
			callback(null, app_info)
		} catch(e) {
			callback(e);
		}
	}.bind(this));
} 

AppManager.prototype.getAppRoot = function(id) {
	return this.apps_index[id].app_path;
}

AppManager.prototype.getAppIndex = function() {
	return this.apps_index;
}

AppManager.prototype.getAppList = function() {
	return this.apps_list;
}

AppManager.prototype._setApps = function(list_of_apps) {
	var apps_index = {}
	for(var i in list_of_apps) {
		apps_index[list_of_apps[i].id] = list_of_apps[i];
	}
	this.apps_index = apps_index;
	this.apps_list = list_of_apps;
}

AppManager.prototype._addApp = function(app) {
	this.apps_list.push(app);
	this.apps_index[app.id] = app;
}

/**
 * Load an app and issue a callback when loaded.
 * In the case of a compressed app, this decompresses the app into the approot directory.
 * In the case of a raw app, this copies the app to the approot directory.
 */
AppManager.prototype.loadApp = function(pathname, callback){
	// Check to see if the path exists
	fs.stat(pathname,function(err,stat){
		if(err) {
			// Error if we couldn't stat
			return callback(err);
		}
		if(stat.isDirectory()) {
			// Copy if it's a directory
			log.debug('App is a directory, so were copying')
			return this.copyApp(pathname, this.approot_directory, {}, callback);
		} else {
			log.debug('App is a file so were decompressing')
			log.debug(pathname)
			var ext = path.extname(pathname).toLowerCase()
			if(ext === '.fma' || ext === '.zip') {
				// Decompress if it's a compressed app file
				log.debug('yep');
				return this.decompressApp(pathname, this.approot_directory, {}, callback);
			} else {
				// Error if it's a file, but the wrong kind
				return callback('Not an app.')
			}
		}
	}.bind(this));
}

AppManager.prototype.deleteApp = function(id, callback) {
	app = this.apps_index[id];
	var app_id = id;
	if(app) {
		var app_path = app.app_path;
		var archive_path = app.app_archive_path;
		fs.remove(app_path, function(err) {
			if(err) {
				log.error('Problem removing the installed app: ' + err);
				callback(err);
			} else {
				fs.remove(archive_path, function(err) {
					if(err) {
						log.error('Problem removing the app archive: ' + err);
						callback(err);
					} else {
						app_info = this.apps_index[app_id];
						delete this.apps_index[app_id];
						var index = this.apps_list.indexOf(app_info);
						if (index > -1) {
							this.apps_list.splice(index, 1);
						} else {
							log.warn("Inconsistency in the app index observed when removing app " + app_id);
						}
						callback(null, app_info);
					}
				}.bind(this)); // remove app archive
			}
		}.bind(this)); // remove installed app folder
	}
}

/**  
 * Copies an app from the src directory to the dest approot directory.
 * Callback with app info.
 */
AppManager.prototype.copyApp = function(src, dest, options, callback) {
	try {
		var name = path.basename(src);
		var app_info = {
			app_path : dest + "/" + name + "/",
			app_archive_path : src
		}
		var exists = fs.existsSync(app_info.app_path);
		
		if(exists && !options.force) {
			log.debug('Not copying app "' + src + '" because it already exists.');
			this.readAppPackageInfo(app_info, function(err, info) {
				if(err) { 
					return callback(err); 
				} else {
					this._addApp(info);
					callback(null, info);
				}
			}.bind(this));
			return;
		}

		log.debug('Copying app "' + src + '"')
		ncp(app_info.app_archive_path, app_info.app_path, function (err) {
			if (err) {
				log.warn('There was a problem copying the app "' + name + '" (' + err + ')');
				return callback(err);
			} else {
				log.debug('Reading app info');
				this.readAppPackageInfo(app_info, function(err, info) {
					if(err) {
						callback(err);
					} else {
						this._addApp(info);
						callback(null, info);
					}
				}.bind(this));
			}
		}.bind(this));
	} catch(e) {
		return callback(e);
	}
}

/**
 * Decompress the app and return app info (via callback)
 */
AppManager.prototype.decompressApp = function(src, dest, options, callback) {
	try { 
		var name = path.basename(src);
		var app_info = {
			app_path : dest + "/" + name + "/",
			app_archive_path : src
		};
		var exists = fs.existsSync(app_info.app_path);
		console.log(app_info)
		if(exists && !options.force) {
			log.debug('Not decompressing app "' + src + '" because it already exists.');
			this.readAppPackageInfo(app_info, function(err, info) {
				if(err) {
					callback(err);
				} else {
					this._addApp(info);
					callback(null, info);
				}
			}.bind(this));
			return;
		}

		log.debug('Decompressing app "' + app_info.app_path + '"')

		try {
			var app = new zip(src);
			app.extractAllTo(app_info.app_path, true);
		} catch(e) {
			log.warn('There was a problem decompressing the app "' + name + '" (' + e + ')');
			return callback(e);
		}

		this.readAppPackageInfo(app_info, function(err, info) {
			if(err) {
				callback(err);
			} else {
				this._addApp(info);
				callback(null, info);
			}
		}.bind(this));
	}
	catch(e){
		log.error(e);
		callback(e);
	}
}

AppManager.prototype.getAppPaths = function(callback) {
	fs.readdir(this.app_directory, function(err, files) {
		user_files = files.map(function(file) { return path.join(this.app_directory,file);}.bind(this));
		fs.readdir(this.system_app_directory, function(err, files) {
			system_files = files.map(function(file) { return path.join(this.system_app_directory,file);}.bind(this));
			callback(null, system_files.concat(user_files));
		}.bind(this));
	}.bind(this));
}

/**
 * Load all of the apps in the provided apps directory
 */
AppManager.prototype.loadApps =  function(callback) {
	this.getAppPaths(function(err,files){
		async.mapSeries(files, 
			function(file, callback) {
				this.loadApp(file, function(err, result) {
					if(err) {
						// Rather than allowing errors to halt the async.map operation that is loading the apps
						// we swallow them and simply stick a 'null' in the output array (that we cull out at the end)
						return callback(null, null);
					} else {
						return callback(null, result);
					}
				}.bind(this));
			}.bind(this), 
			function(err, results) {
				//results = results.filter(function(result) { return result !== null;});
				//this._setApps(results);
				callback(err, results);
			}.bind(this));
	}.bind(this));
}

module.exports.AppManager = AppManager;
