/*
 * dashboard/index.js
 *
 * This module defines the functions and data for managing dashboard apps
 */
app_manager = require("./app_manager");
config = require("../config");
util = require("../util");
path = require("path");

// Instantiate the app manager
// Call only once at startup
// TODO - callback really doesn't do anything here.  Look at callback behavior
exports.configure = function (callback) {
    manager = new app_manager.AppManager({
        app_directory: config.getDataDir("apps"),
        approot_directory: config.getDataDir(path.join("approot", "approot")),
    });
    exports.appManager = manager;
    setImmediate(callback, null);
};

// The rest of these functions just define the singleton app manager interface
// TODO - this could be simplified

exports.loadApps = function (callback) {
    exports.appManager.loadApps(callback);
};

exports.getAppIndex = function () {
    return exports.appManager.getAppIndex() || [];
};

exports.getAppConfig = function (id) {
    return exports.appManager.getAppConfig(id);
};

exports.setAppConfig = function (id, cfg, callback) {
    return exports.appManager.setAppConfig(id, cfg, callback);
};

exports.getAppList = function () {
    return exports.appManager.getAppList() || [];
};

exports.getAppFiles = function (id) {
    app_root = exports.appManager.getAppRoot(id);
    return util.walkDir(app_root);
};

exports.loadApp = function (pathname, options, callback) {
    return exports.appManager.loadApp(pathname, options, callback);
};

exports.installAppArchive = function (path, name, callback) {
    return exports.appManager.installAppArchive(path, name, callback);
};

exports.deleteApp = function (id, callback) {
    return exports.appManager.deleteApp(id, callback);
};

exports.reloadApp = function (id, callback) {
    return exports.appManager.reloadApp(id, callback);
};
