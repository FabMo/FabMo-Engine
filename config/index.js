var Config = require('./config').Config;
var async = require('async');
var EngineConfig = require('./engine_config').EngineConfig;
var G2Config = require('./g2_config').G2Config;
var OpenSBPConfig = require('./opensbp_config').OpenSBPConfig;
var MachineConfig = require('./machine_config').MachineConfig;
var DashboardCofnig = require('./dashboard_config').DashboardConfig;
var InstanceConfig = require('./instance_config').InstanceConfig;

var fs = require('fs');
var path = require('path');

var log = require('../log').logger('config');

// Provide the exported functions for managing application configuration

// Configure the engine by loading the configuration from disk, and performing 
// configuration of the application based on the values loaded.
//
// Also, create `exports.engine` which is an EngineConfig object
function configureEngine(callback) {
	exports.engine = new EngineConfig();
	exports.engine.init(callback);
}

// Configure the driver by loading the configuration from disk and synchronizing
// it with the configuration of the actual physical driver.
//
// Also, create `exports.driver` which is a G2Config object
function configureDriver(driver, callback) {
    if(driver) {
    	log.debug("Configuring driver...");
    	exports.driver = new G2Config(driver);
		async.series([
		function(callback) { exports.driver.init(callback); },
		function(callback) { exports.driver.configureStatusReports(callback); }
		],
		function finished(err, result) {
			log.debug('finished');
			if(err) { callback(err); }
			else {
				callback(null, exports.driver);
			}
		});
    } else {
    	log.debug("Creating dummy driver configuration...");
    	exports.driver = new Config();
    }
}

function configureOpenSBP(callback) {
	exports.opensbp = new OpenSBPConfig();
	exports.opensbp.init(callback);
}

function configureMachine(driver, callback) {
	exports.machine = new MachineConfig(driver);
	exports.machine.init(callback);
}

function configureDashboard(callback) {
	exports.dashboard = new DashboardConfig(driver);
	exports.dashboard.init(callback);
}

function configureInstance(driver, callback) {
	exports.instance = new InstanceConfig(driver);
	exports.instance.init(callback);
}

function canWriteTo(dirname) {
	try {
		test_path = path.join(dirname,'/.fabmoenginetest')
		fs.writeFileSync(test_path, '');
		fs.unlink(test_path);
		return true;
	} catch(e) {
		return false;
	}
}

function getLockFile() {
	var lockfile_name = 'fabmo-engine.lock';
	switch(process.platform) {
		case 'win32':
		case 'win64':
			return path.join(Config.getDataDir(), lockfile_name);
			break;
		default:
			lockfile_dir =  '/var/run';
			if(canWriteTo(lockfile_dir)) {
				return path.join(lockfile_dir, lockfile_name);
			} else {
				log.warn('Lockfile not in /var/run on POSIX platform')
				return path.join(Config.getDataDir(), lockfile_name);
			}
			break;
	}
}

exports.configureEngine = configureEngine;
exports.configureDriver = configureDriver;
exports.configureOpenSBP = configureOpenSBP;
exports.configureMachine = configureMachine;
exports.configureInstance = configureInstance;

exports.createDataDirectories = Config.createDataDirectories;
exports.getDataDir = Config.getDataDir;
exports.getLockFile = getLockFile;

exports.platform = require('process').platform;