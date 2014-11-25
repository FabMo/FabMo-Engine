var zip = require('adm-zip');
var path = require('path');
var os = require('os');
var ncp = require('ncp').ncp;
var fs = require('fs');
var async = require('async');
var uuid = require('node-uuid');
var log = require('../log').logger('app_manager');

// Maximum depth of a deep copy operation
ncp.limit = 16;

var AppManager = function(options) {
	this.app_directory = options.app_directory;
	this.temp_directory = options.temp_directory;
	this.apps_index = {};
	this.apps_list = {};
}

AppManager.prototype.getAppIndex = function() {
	return this.apps_index;
}

AppManager.prototype.getAppList = function() {
	return this.apps_list;
}

AppManager.prototype._setApps = function(list_of_apps) {
	apps_index = {}
	for(var i in list_of_apps) {
		apps_index[list_of_apps[i].id] = list_of_apps[i];
	}
	this.apps_index = apps_index;
	this.apps_list = list_of_apps;
}

/**
 * Load an app and issue a callback when loaded.
 * In the case of a compressed app, this decompresses the app into the temporary directory.
 * In the case of a raw app, this copies the app to the temporary directory.
 */
AppManager.prototype.loadApp = function(path, callback){
	// Check to see if the path exists
	fs.stat(path,function(err,stat){
		if(err) {
			return callback(err);
		}
		if(stat.isDirectory()) {
			return this.copyApp(path, this.temp_directory, callback);
		} else {
			return this.decompressApp(path, this.temp_directory, callback);
		}
	}.bind(this));
}

/**  
 * Copies an app from the src directory to the dest temp directory.
 * Callback with app info.
 */
AppManager.prototype.copyApp = function(src, dest, callback) {
	try {
		var name = path.basename(src);
		var tmp_app_path = dest+ "/" + name +"/";
		var pkg_info_path = tmp_app_path + 'package.json';
		log.debug('Copying app "' + tmp_app_path + '"')
		ncp(src, tmp_app_path, function (err) {
			if (err) {
				log.warn('There was a problem copying the app "' + name + '" (' + e + ')');
				return callback(err);
			} else {
				try {
					s = fs.readFileSync(pkg_info_path);
					console.log(s.toString('utf8'))
					var package_info = JSON.parse(s);
					var app_info = {'name':package_info.name,
									'icon_path':tmp_app_path+package_info.icon,
									'icon_background_color':package_info.icon_color,
									'icon_display':package_info.icon_display,
									'app_path':tmp_app_path,
									'app_url': path.join('approot', name,package_info.main),
									'icon_url': path.join('approot', name,package_info.icon),
									'id':package_info.id || uuid.v1()};
					callback(null, app_info);
				} catch(e) {
					log.warn('There was a problem copying the app "' + name + '" (' + e + ')');
					return callback(e);
				}
			}
		});
	} catch(e) {
		return callback(e);
	}
}

/**
 * Decompress the app and return app info (via callback)
 */
AppManager.prototype.decompressApp = function(src, dest,callback) {
	try{ 
		var name = path.basename(src);
		var tmp_app_path=dest+"/" + name +"/";
		var pkg_info_path = tmp_app_path + 'package.json';
		log.debug('Decompressing app "' + tmp_app_path + '"')
		
		try {
			var app = new zip(src);
			app.extractAllTo(tmp_app_path, true);
		} catch(e) {
			log.warn('There was a problem decompressing the app "' + name + '" (' + e + ')');
			return callback(e);
		}
		var package_info = JSON.parse(fs.readFileSync(pkg_info_path));
		var app_info = {'name':package_info.name,
						'icon_path':tmp_app_path+package_info.icon,
						'icon_background_color':package_info.icon_color,
						'icon_display':package_info.icon_display,
						'app_path':tmp_app_path,
						'app_url': path.join('approot',name,package_info.main),
						'icon_url': path.join('approot',name,package_info.icon),
						'id':package_info.id || uuid.v1()};
		callback(null, app_info);
	}
	catch(e){
		callback(e);
	}
}

/**
 * Load all of the apps in the provided apps directory
 */
AppManager.prototype.loadApps =  function(callback) {
	fs.readdir(this.app_directory, function(err,files){
		files = files.map(function(file) { return this.app_directory + '/' + file;}.bind(this));
		async.mapSeries(files, 
			function(file, callback) {
				this.loadApp(file, function(err, result) {
					// Rather than allowing errors to halt the async.map operation that is loading the apps
					// we swallow them and simply stick a 'null' in the output array (that we cull out at the end)
					if(err) {
						return callback(null, null);
					} else {
						return callback(null, result);
					}
				}.bind(this));
			}.bind(this), 
			function(err, results) {
				results = results.filter(function(result) { return result !== null;});
				this._setApps(results);
				callback(err, results);
			}.bind(this));
	}.bind(this));
}

module.exports.AppManager = AppManager;
