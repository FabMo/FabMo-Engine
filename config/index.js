
var EngineConfig = require('./engine_config').EngineConfig;
var G2Config = require('./g2_config').G2Config;

function configure_engine(callback) {
	exports.engine = new EngineConfig();
	exports.engine.init(callback);
}

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

exports.configure_engine = configure_engine
exports.configure_driver = configure_driver