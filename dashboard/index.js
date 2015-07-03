app_manager = require('./app_manager');
config = require('../config');
util = require('../util');
path = require('path');

exports.configure = function(callback) {
	manager = new app_manager.AppManager({
		app_directory : config.getDataDir('apps'),
		approot_directory : config.getDataDir(path.join('approot', 'approot'))
	});
	exports.appManager = manager;
	setImmediate(callback, null);
};

exports.loadApps = function(callback) {
	exports.appManager.loadApps(callback);
};

exports.getAppIndex = function() {
	return exports.appManager.getAppIndex() || [];
};

exports.getAppList = function() {
	return exports.appManager.getAppList() || [];
};

exports.getAppFiles = function(id) {
	app_root = exports.appManager.getAppRoot(id);
	return util.walkDir(app_root);
};

exports.loadApp = function(pathname, options, callback) {
	return exports.appManager.loadApp(pathname, options, callback);
};

exports.deleteApp = function(id, callback) {
	return exports.appManager.deleteApp(id, callback);
};

exports.reloadApp = function(id, callback) {
	return exports.appManager.reloadApp(id, callback);
}