/* eslint-disable no-undef */
/* eslint-disable no-unused-vars */
/*
 * config/index.js
 *
 * Configuration module definitions.  This file defines the main API of the FabMo configuration module.
 *
 * Mainly, this exports the functions and objects that are important to system configuration.
 * It is also the container for the actual instance of the configuration tree and all its branches,
 * which are setup using the configureXXX functions (configureEngine, configureDriver, etc..)
 */
var async = require("async");
var fs = require("fs");
var path = require("path");

var Config = require("./config").Config;
var EngineConfig = require("./engine_config").EngineConfig;
var UserConfig = require("./user_config").UserConfig;
var G2Config = require("./g2_config").G2Config;
var OpenSBPConfig = require("./opensbp_config").OpenSBPConfig;
var MachineConfig = require("./machine_config").MachineConfig;
var DashboardCofnig = require("./dashboard_config").DashboardConfig;
var InstanceConfig = require("./instance_config").InstanceConfig;
var ProfileConfig = require("./profile_config").ProfileConfig;

var log = require("../log").logger("config");

// Provide the exported functions for managing application configuration

// Configure the engine by loading the configuration from disk, and performing
// configuration of the application based on the values loaded.
//
// Also, create `exports.engine` which is an EngineConfig object
function configureEngine(callback) {
    exports.engine = new EngineConfig();
    exports.engine.init(function () {
        callback();
    });
}

// These functions initialize the various branches of the configuration tree.
// Generally, this means loading the configuration from disk, applying it, and
// assigning it as an export of this package (config.driver, config.opensbp, etc.)
function configureOpenSBP(callback) {
    exports.opensbp = new OpenSBPConfig();
    exports.opensbp.init(callback);
}

function configureDashboard(callback) {
    exports.dashboard = new DashboardConfig(driver);
    exports.dashboard.init(callback);
}

function configureInstance(driver, callback) {
    exports.instance = new InstanceConfig(driver);
    exports.instance.init(callback);
}

// The machine configuration was instantiated when this module was initialized
// TODO why is that the case for config.machine but not the others (config.opensbp, etc.)
function configureMachine(machine, callback) {
    exports.machine.init(machine, callback);
}

// Configure the user data
// If no user data exists, set up the first (admin) user
function configureUser(callback) {
    exports.user = new UserConfig();
    var userFile = exports.user.getConfigFile();
    exports.user.load(userFile, function (err, data) {
        if (err) {
            if (err.code === "ENOENT") {
                log.warn(
                    "Configuration file " +
                        userFile +
                        " not found. Setting up first user"
                );
                exports.user.setUpFile(function (err) {
                    if (err) {
                        log.error(err);
                    } else {
                        configureUser(callback);
                    }
                });
            } else {
                log.warn(
                    'Problem loading the user configuration file INDEX "' +
                        userFile +
                        '": ' +
                        err.message
                );
            }
        } else {
            exports.user.initUsers(data, function (msg) {
                log.info(" user message -  " + msg);
                callback();
            });
        }
    });
}

// Configure the driver by loading the configuration from disk and synchronizing
// it with the configuration of the actual physical driver.
// Also, create `exports.driver` which is a G2Config object
//   driver - An instance of the driver, which will be used to synchronize configuration
function configureDriver(driver, callback) {
    if (driver) {
        log.info("Configuring G2 Driver...");
        //exports.driver = new G2Config(driver);
        async.series(
            [
                function (callback) {
                    exports.driver.init(driver, callback);
                },
                function (callback) {
                    exports.driver.configureStatusReports(callback);
                },
            ],
            function finished(err, result) {
                if (err) {
                    callback(err);
                } else {
                    callback(null, exports.driver);
                }
            }
        );
    } else {
        log.info("Creating dummy driver configuration...");
        exports.driver = new Config();
    }
}

// Check a directory to see if it is writable
// (do this by writing a file there)
//   dirname - The pathname of the directory to check
function canWriteTo(dirname) {
    try {
        test_path = path.join(dirname, "/.fabmoenginetest");
        fs.writeFileSync(test_path, "");
        fs.unlink(test_path);
        return true;
    } catch (e) {
        return false;
    }
}

// Get a "lockfile"
// The idea behind the lock file is that a running instance creates it, but it is
// destroyed when the instance exits.  You can check for a lockfile on startup
// and refuse to start if there's an already running instance of the engine.
// On POSIX systems this lives in /var/run like you would expect,
// but on windows, it goes in the configuration data directory
// TODO - This appears no longer to be used, can probably be culled.
function getLockFile() {
    var lockfile_name = "fabmo-engine.lock";
    switch (process.platform) {
        case "win32":
        case "win64":
            return path.join(Config.getDataDir(), lockfile_name);
        default:
            lockfile_dir = "/var/run";
            if (canWriteTo(lockfile_dir)) {
                return path.join(lockfile_dir, lockfile_name);
            } else {
                log.warn("Lockfile not in /var/run on POSIX platform");
                return path.join(Config.getDataDir(), lockfile_name);
            }
    }
}

// Delete the approot directory
// This is the directory where apps are hosted from
// having been copied out of app and system app storage)
function clearAppRoot(callback) {
    util.doshell("rm -rf " + Config.getDataDir("approot"), callback);
}

// These are created on module initialization
// TODO: Why?  Why not create them above like the others?  (Or why not creat them down here?)
exports.machine = new MachineConfig();
exports.driver = new G2Config();
exports.profiles = new ProfileConfig();

// Individual startup configuration commands
exports.configureEngine = configureEngine;
exports.configureDriver = configureDriver;
exports.configureOpenSBP = configureOpenSBP;
exports.configureMachine = configureMachine;
exports.configureInstance = configureInstance;
exports.configureUser = configureUser;

// Util type functions
exports.createDataDirectories = Config.createDataDirectories;
exports.getDataDir = Config.getDataDir;
exports.getProfileDir = Config.getProfileDir;
exports.getLockFile = getLockFile;
exports.clearAppRoot = clearAppRoot;

// TODO Silly?
exports.platform = require("process").platform;
