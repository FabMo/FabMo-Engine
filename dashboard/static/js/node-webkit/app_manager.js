var zip = require('adm-zip');
var path = require('path');
var os = require('os');
var ncp = require('ncp').ncp;
var fs = require('fs');
var async = require('async');
var uuid = require('node-uuid');

var APP_TMP_DIR = './tmp/app/';

// Maximum depth of a deep copy operation
ncp.limit = 16;

/**
 * Load an app and issue a callback when loaded.
 * In the case of a compressed app, this decompresses the app into a temporary directory.
 * In the case of a raw app, this copies the app to the temporary directory.
 * @param app_path The source path of the app
 * @param callback Callback (err, app_info) called returning an app info dictionary
 */
function load_app(app_path, callback){
	// Check to see if the path exists
	fs.stat(app_path,function(err,stat){
		if(err) {
			return callback(err);
		}
		if(stat.isDirectory()) {
			//console.log('Loading app as directory');
			return copy_app(app_path, callback);
		} else {
			//console.log('Loading app as a compressed archive');
			return decompress_app(app_path, callback);
		}
	});
}

/**  
 * Copies an app from the specified directory to the apps temp directory
 * @param app_dir The app directory to copy from
 * @param callback Callback (err, dir) - called when app has been successfully (or unsuccessfully) copied
 */
function copy_app(app_dir, callback) {
	try {
		var tmp_app_path = APP_TMP_DIR+path.basename(app_dir)+"/";
		var pkg_info_path = tmp_app_path + 'package.json';
		ncp(app_dir, tmp_app_path, function (err) {
			if (err) {
				return callback(err);
			} else {
				try {
					var package_info = JSON.parse(fs.readFileSync(pkg_info_path));
					var app_info = {'name':package_info.name,
									'icon_path':tmp_app_path+package_info.icon,
									'icon_background_color':package_info.icon_color,
									'icon_display':package_info.icon_display,
									'app_path':tmp_app_path,
									'app_url':'app://fabmolinker/'+path.join(tmp_app_path,package_info.main),
									'icon_url':'app://fabmolinker'+path.join('tmp', tmp_app_path,package_info.icon),
									'id':package_info.id || uuid.v1()};
					callback(null, app_info);
				} catch(e) {
					return callback(e);
				}
			}
		});
	} catch(e) {
		return callback(e);
	}
}

/**
 * Decompress the app and return the temporary link of the home page
 * @param app_path The source path for the app file (.fma)
 * @param callback Callback (err, path) to call when app has been successfully (or unsuccessfully) decompressed
 */
function decompress_app(app_path,callback){
	try{
		var tmp_app_path=APP_TMP_DIR+path.basename(app_path)+"/";
		var pkg_info_path = tmp_app_path + 'package.json';
		var app = new zip(app_path);
		app.extractAllTo(tmp_app_path, true);
		var package_info = JSON.parse(fs.readFileSync(pkg_info_path));
		var app_info = {'name':package_info.name,
						'icon_path':tmp_app_path+package_info.icon,
						'icon_background_color':package_info.icon_color,
						'icon_display':package_info.icon_display,
						'app_path':tmp_app_path,
						'app_url':'app://fabmolinker/'+path.join(tmp_app_path,package_info.main),
						'icon_url':'app://fabmolinker'+path.join('tmp', tmp_app_path,package_info.icon),
						'id':package_info.id || uuid.v1()};
		callback(false, app_info);
	}
	catch(e){
		callback(e);
	}
	
}

/**
 * Load all of the apps in the provided apps directory
 * @param apps_directory The source directory to look for apps
 * @param callback Callback (err, apps) to issue when all app info has been collected
 */
function load_apps(apps_directory, cb) {
	fs.readdir(apps_directory, function(err,files){
		files = files.map(function(file) { return apps_directory + '/' + file;});

/*
		var results =[];
		var idx=0;
		for(var index in files){
			load_app(files[index],function(err,result){
				idx++;
				if(err) {
					//return callback(null, null);
				} else {
					results.push(result);
				}
				if(idx===files.length)
				{
					cb(null,results);
				}
			});
*/

		async.mapSeries(files, 
			function(file, callback) {
				load_app(file, function(err, result) {
					// Rather than allowing errors to halt the async.map operation that is loading the apps
					// we swallow them and simply stick a 'null' in the output array (that we cull out at the end)
					if(err) {
						return callback(null, null);
					} else {
						return callback(null, result);
					}
				});
			}, 
			function(err, results) {
				results = results.filter(function(result) { return result !== null;});
				cb(err, results);
			});  
	});
}

/*
load_apps('./apps', function(err, result) {
	console.log(result);
}); */
module.exports.load_apps = load_apps;
