/*
 * dashboard_config.js
 * 
 * This configuration object is for storing configuration related to the dashboard.
 * There really isn't anything special about it.
 */
var Config = require('./config').Config;
var log = require('../log').logger('dashboard_config');

// The DashboardConfig object keeps track of engine-specific settings
var DashboardConfig = function(driver) {
	Config.call(this, 'dashboard');
	this.driver = driver;
};
util.inherits(DashboardConfig, Config);

DashboardConfig.prototype.apply = function(callback) {
	// Ideally, nothing happens here, because this is just a data store
};

exports.DashboardConfig = DashboardConfig;
