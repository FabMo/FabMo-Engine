app_manager = require('./app_manager');
config = require('../config');
util = require('../util');

exports.configure = function(callback) {
	manager = new app_manager.AppManager({
		app_directory : config.getDataDir('apps'),
		temp_directory : config.getDataDir('temp/approot')
	});
	exports.appManager = manager;
	setImmediate(callback, null);
}

exports.loadApps = function(callback) {
	exports.appManager.loadApps(callback);
}

exports.getAppIndex = function() {
	return exports.appManager.getAppIndex() || [];
}

exports.getAppList = function() {
	return exports.appManager.getAppList() || [];
}

exports.getAppFiles = function(id) {
	app_root = exports.appManager.getAppRoot(id);
	console.log('Dashboard is getting the directory tree under ' + app_root);
	return util.walkDir(app_root);
}