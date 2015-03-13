var Config = require('./config').Config;
var async = require('async');
var EngineConfig = require('./engine_config').EngineConfig;
var G2Config = require('./g2_config').G2Config;
var OpenSBPConfig = require('./opensbp_config').OpenSBPConfig;
var log = require('../log').logger('g2_config');

// Provide the exported functions for managing application configuration

// Configure the engine by loading the configuration from disk, and performing 
// configuration of the application based on the values loaded.
//
// Also, create `exports.engine` which is an EngineConfig object
function configureEngine(callback) {
	exports.engine = new EngineConfig();
	exports.engine.checkWifi();
	exports.engine.init(callback);
}

// Configure the driver by loading the configuration from disk and synchronizing
// it with the configuration of the actual physical driver.
//
// Also, create `exports.driver` which is a G2Config object
function configureDriver(driver, callback) {
    log.debug("Configuring driver...");
	exports.driver = new G2Config(driver);
	async.series([
		function(callback) { exports.driver.init(callback); },
		function(callback) { exports.driver.configureStatusReports(callback); }
		],
		function finished(err, result) {
			if(err) { callback(err); }
			else {
				callback(null, exports.driver);
			}
		});
}

// Configure OpenSBP by loading the configuration from disk so it is available for the runtime
//
function configureOpenSBP(callback) {
	exports.opensbp = new OpenSBPConfig();
	exports.opensbp.init(callback);
}

exports.configureEngine = configureEngine;
exports.configureDriver = configureDriver;
exports.configureOpenSBP = configureOpenSBP;
exports.createDataDirectories = Config.createDataDirectories;
exports.getDataDir = Config.getDataDir;
