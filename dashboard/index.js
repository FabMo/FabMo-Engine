app_manager = require('./app_manager');
config = require('../config');

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