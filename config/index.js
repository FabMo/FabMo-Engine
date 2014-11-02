var EngineConfig = require('./engine_config').EngineConfig;
var G2Config = require('./g2_config').G2Config;
var OpenSBPConfig = require('./opensbp_config').OpenSBPConfig;

// Provide the exported functions for managing application configuration

// Configure the engine by loading the configuration from disk, and performing 
// configuration of the application based on the values loaded.
//
// Also, create `exports.engine` which is an EngineConfig object
function configure_engine(callback) {
	exports.engine = new EngineConfig();
	exports.engine.checkWifi();
	exports.engine.init(callback);
}

// Configure the driver by loading the configuration from disk and synchronizing
// it with the configuration of the actual physical driver.
//
// Also, create `exports.driver` which is a G2Config object
function configure_driver(driver, callback) {
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
function configure_opensbp(callback) {
	exports.opensbp = new OpenSBPConfig();
	exports.opensbp.init(callback);
}

exports.configure_engine = configure_engine
exports.configure_driver = configure_driver
exports.configure_opensbp = configure_opensbp
