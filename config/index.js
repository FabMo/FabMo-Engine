var Config = require('./config').Config;
var async = require('async');
var EngineConfig = require('./engine_config').EngineConfig;
var UserConfig = require('./user_config').UserConfig;
var G2Config = require('./g2_config').G2Config;
var OpenSBPConfig = require('./opensbp_config').OpenSBPConfig;
var MachineConfig = require('./machine_config').MachineConfig;
var DashboardCofnig = require('./dashboard_config').DashboardConfig;
var InstanceConfig = require('./instance_config').InstanceConfig;
var ProfileConfig = require('./profile_config').ProfileConfig;

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
	exports.engine.init(function() {
		callback();
	});
}

// Configure the driver by loading the configuration from disk and synchronizing
// it with the configuration of the actual physical driver.
//
// Also, create `exports.driver` which is a G2Config object
function configureDriver(driver, callback) {
    if(driver) {
    	log.info("Configuring G2 Driver...");
    	//exports.driver = new G2Config(driver);
		async.series([
		function(callback) { exports.driver.init(driver, callback); },
		function(callback) { exports.driver.configureStatusReports(callback); }
		],
		function finished(err, result) {
			if(err) { callback(err); }
			else {
				callback(null, exports.driver);
			}
		});
    } else {
    	log.info("Creating dummy driver configuration...");
    	exports.driver = new Config();
    }
}

function configureOpenSBP(callback) {
	exports.opensbp = new OpenSBPConfig();
	exports.opensbp.init(callback);
}

function configureMachine(machine, callback) {
	exports.machine.init(machine, callback);
}

function configureDashboard(callback) {
	exports.dashboard = new DashboardConfig(driver);
	exports.dashboard.init(callback);
}

function configureInstance(driver, callback) {
	exports.instance = new InstanceConfig(driver);
	exports.instance.init(callback);
}

function configureUser(callback){
	exports.user = new UserConfig();
	var userFile = exports.user.getConfigFile();
	exports.user.load(userFile, function(err, data) {
		if(err) {
			if(err.code === "ENOENT") {
				log.warn('Configuration file ' + userFile + ' not found. Setting up first user');
				exports.user.setUpFile(function(err){
					if(err) {
						console.log(err);
					} else {
						configureUser(callback);
					}
				});
			} else {
				log.warn('Problem loading the user configuration file "' + userFile + '": ' + err.message);
			}
		} else {
			exports.user.initUsers(data, function(msg){
				log.info(msg);
				callback();
			});	
		}
	});

	// exports.user.getConfigFile(function(err, data){
	// 	console.log(err);
	// 	console.log(data);
	// 	if (!err) {

	// 	} else {
	// 		console.log('oh man I still have an error');
	// 		
	// 	}
	// });
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

function clearAppRoot(callback) {
    util.doshell('rm -rf ' + Config.getDataDir('approot'), callback);
}

exports.machine = new MachineConfig();
exports.driver = new G2Config();

exports.configureEngine = configureEngine;
exports.configureDriver = configureDriver;
exports.configureOpenSBP = configureOpenSBP;
exports.configureMachine = configureMachine;
exports.configureInstance = configureInstance;
exports.configureUser = configureUser;

exports.createDataDirectories = Config.createDataDirectories;
exports.getDataDir = Config.getDataDir;
exports.getProfileDir = Config.getProfileDir;
exports.getLockFile = getLockFile;

exports.clearAppRoot = clearAppRoot
exports.platform = require('process').platform;

exports.profiles = new ProfileConfig();