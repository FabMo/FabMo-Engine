/* eslint-disable no-undef */
/* eslint-disable no-unused-vars */
/* eslint-disable no-prototype-builtins */
/*
 * config.js
 *
 * Defines the superclass for all configuration objects, along with a number of
 * functions that support configuration in the FabMo system.
 *
 * Directory Structure:
 * - Profiles Directory: /opt/fabmo/profiles/
 *   - Default Profile: /opt/fabmo/profiles/default/
 *   - User Profiles: /opt/fabmo/profiles/<profile_name>/
 * - Working Config Directory: /opt/fabmo/config/
 * - Backup Config Directory: /opt/fabmo_backup/config/
 *
 * Configuration Loading Priority:
 * 1. Load from backup directory (/opt/fabmo_backup/config/)
 * 2. Rebuild from working repository of profiles (/opt/fabmo/profiles/)
 *    - Load default profile first, then update with user profile
 * 3. Fallback to original profiles in installation directory (/fabmo/profiles/)
 *
 * A Config object is essentially a JSON object wrapped up with some functions for saving and loading.
 * Methods are provided for updating keys/values in the object easily, in such a way that configuration changes
 * coming from a client or from files on disk can be easily merged into an active configuration.
 *
 * Subclasses of the Config object are topic-specific configuration implementations.  In addition to keeping
 * track of the data that is their charge, they are responsible for applying those configurations to the
 * systems they manage.  One example of this is g2_config.js, which keeps its config values synchronized with
 * the G2 motion systems, updating them when they change.
 */

var async = require("async");
var fs = require("fs-extra");
var path = require("path");
var PLATFORM = require("process").platform;
var log = require("../log").logger("config");
var EventEmitter = require("events").EventEmitter;
var util = require("util");

// Config is the superclass from which all configuration objects descend
//   config_name - All configuration objects have a name, which among other things,
//                 determines the filename for the stored configuration.
var Config = function (config_name) {
    this._cache = {};
    this.config_name = config_name;
    this._loaded = false;
    this.userConfigLoaded = false;
    EventEmitter.call(this);
};
util.inherits(Config, EventEmitter);

// Get a named value
//   k - The key for which to retrieve a value
Config.prototype.get = function (k) {
    return this._cache[k];
};

// Return true if this configuration object has the provided value
//   k - key to check
Config.prototype.has = function (k) {
    return this._cache.hasOwnProperty(k);
};

// Get the values for the provided array of keys.
// Returns an object mapping keys to values.
//   arr - list of keys
Config.prototype.getMany = function (arr) {
    var retval = {};
    for (var i in arr) {
        var key = arr[i];
        retval[key] = this._cache[key];
    }
    return retval;
};

// Set the configuration value for the provided key.
// This causes the configuration to be saved to disk
// This function calls `update()` internally, which is provided by subclasses
//          k - The key value
//          v - The new values
//   callback - Called once the config is updated (which might take some time)
Config.prototype.set = function (k, v, callback) {
    var u = {};
    u[k] = v;
    this.setMany(u, callback);
};

// Typical update function for a config object
Config.prototype.update = function (data, callback) {
    try {
        for (var key in data) {
            this._cache[key] = data[key];
        }
    } catch (e) {
        if (callback) {
            return setImmediate(callback, e);
        }
    }
    this.save(function (err, result) {
        if (err) {
            typeof callback === "function" && callback(e);
        } else {
            typeof callback === "function" && callback(null, data);
        }
    });
};

// Set the key value pairs supplied by `data` on this config object
// This causes the configuration to be saved to disk.
//       data - Object containing the keys/values to update
//   callback - Called with updated values on success or with error if error
Config.prototype.setMany = function (data, callback) {
    this.update(
        data,
        function (err, result) {
            if (callback && typeof callback === "function") {
                callback(err, result);
            } else {
                log.warn("No callback passed to setMany");
            }
            this.emit("change", data);
        }.bind(this)
    );
};

// Promise wrapper to allow async/await
Config.prototype.setManyWrapper = async function (input) {
    return await new Promise((resolve, reject) => {
        this.setMany(input, function (err, result) {
            if (err) {
                reject(err);
            } else {
                resolve(result);
            }
        });
    });
};

// Delete all of the provided keys from this configuration object
//   keys - List of keys to remove
Config.prototype.deleteMany = function (keys, callback) {
    keys.forEach(
        function (k) {
            if (k in this._cache) {
                delete this._cache[k];
            }
        }.bind(this)
    );
    this.save(callback);
};

// Delete the provided key from this configuration object
//   key - The key to delete
Config.prototype.delete = function (k, callback) {
    this.deleteMany([k], callback);
};

// Get an object that represents the entirety of this coniguration object
// Careful, this returns the actual cache (TODO maybe do a deep clone of this data)
Config.prototype.getData = function () {
    return this._cache;
};

// The load function retreives a configuration from disk and loads it into the configuration object
//  filename - Full path to the file to load (JSON)
//  callback - called when complete with the loaded data (or error)
Config.prototype.load = function (filename, callback) {
    this._filename = filename;

    const backupDir = "/opt/fabmo_backup/config/";
    const workingProfileDir = "/opt/fabmo/profiles/";
    const originalProfileDir = __dirname + "/../profiles/";

    if (!filename) {
        log.error("Filename is undefined");
        return callback(new Error("Filename is undefined"));
    }

    const backupFile = path.join(backupDir, path.basename(filename));
    const defaultProfileFile = path.join(workingProfileDir, "default/config/", path.basename(filename));
    const currentProfile = Config.getCurrentProfile() || "default";
    const userProfileFile = path.join(workingProfileDir, currentProfile, "config/", path.basename(filename));
    const originalDefaultProfileFile = path.join(originalProfileDir, "default/config/", path.basename(filename));
    const originalUserProfileFile = path.join(originalProfileDir, currentProfile, "config/", path.basename(filename));

    //log.info(`Loading configuration from: ${filename}`);
    //log.info(`Backup file path: ${backupFile}`);
    //log.info(`Default profile file path: ${defaultProfileFile}`);
    //log.info(`User profile file path: ${userProfileFile}`);
    //log.info(`Original default profile file path: ${originalDefaultProfileFile}`);
    //log.info(`Original user profile file path: ${originalUserProfileFile}`);

    const tryLoadFile = (filePath, next) => {
        fs.readFile(filePath, "utf8", (err, data) => {
            if (err) {
                return next(err);
            }
            try {
                data = JSON.parse(data);
                this.update(
                    data,
                    (err, d) => {
                        if (err) {
                            return next(err);
                        }
                        callback(null, data);
                    },
                    true
                );
            } catch (e) {
                log.error(e);
                next(e);
            }
        });
    };

    const loadFromBackup = (next) => {
        log.info(`Attempting to load from backup: ${backupFile}`);
        tryLoadFile(backupFile, next);
    };

    const loadFromWorkingProfile = (next) => {
        log.info(`Attempting to rebuild from working profile: ${defaultProfileFile} and ${userProfileFile}`);
        async.series([(cb) => tryLoadFile(defaultProfileFile, cb), (cb) => tryLoadFile(userProfileFile, cb)], next);
    };

    const loadFromOriginalProfile = (next) => {
        log.info(
            `Attempting to rebuild from original profile: ${originalDefaultProfileFile} and ${originalUserProfileFile}`
        );
        async.series(
            [(cb) => tryLoadFile(originalDefaultProfileFile, cb), (cb) => tryLoadFile(originalUserProfileFile, cb)],
            next
        );
    };

    async.series(
        [
            (next) =>
                tryLoadFile(filename, (err) => {
                    if (err) {
                        log.warn(`Failed to load config file: ${filename}, trying backup.`);
                        return loadFromBackup(next);
                    }
                    callback(null);
                }),
            (next) =>
                loadFromWorkingProfile((err) => {
                    if (err) {
                        log.warn(`Failed to load from working profile, trying original profile.`);
                        return loadFromOriginalProfile(next);
                    }
                    callback(null);
                }),
        ],
        (err) => {
            if (err) {
                log.error(`Failed to load configuration from all sources: ${err.message}`);
                callback(err);
            } else {
                callback(null);
            }
        }
    );
};

// Write this configuration object to disk
//   callback - Called with null once the configuration is saved (or with error if error)
Config.prototype.save = function (callback) {
    ////## for further debugging of start and save sequencing and timing!!
    //log.debug("Entering save function for " + this.config_name);
    //log.stack();
    var config_file = this.getConfigFile();
    if (this._loaded && config_file) {
        log.debug("Saving config to " + config_file);
        fs.open(
            config_file,
            "w",
            function (err, fd) {
                if (err) {
                    log.error(err);
                    callback(err);
                } else {
                    ////##
                    // If there is a units key in the 'opensbp' cache, we want to delete it
                    // ... to avoid reduncancy in saved data with 'machine' cache
                    if (this.config_name === "opensbp" && this._cache.hasOwnProperty("units")) {
                        delete this._cache.units;
                    }
                    var cfg = Buffer.from(JSON.stringify(this._cache, null, 4));
                    fs.write(
                        fd,
                        cfg,
                        0,
                        cfg.length,
                        0,
                        function (err, written, string) {
                            if (err) {
                                log.info("config write failed");
                                log.error(err);
                                fs.closeSync(fd); // no error reporting
                                callback(err);
                            } else {
                                fs.fsync(
                                    fd,
                                    function (err) {
                                        if (err) {
                                            log.info("config sync failed");
                                            log.error(err);
                                        } else {
                                            log.info("config fsync succeeded: " + config_file);
                                        }
                                        fs.closeSync(fd); // no error reporting
                                        log.debug("  fsync done " + config_file);
                                        callback(err);
                                    }.bind(this)
                                );
                            }
                        }.bind(this)
                    );
                }
            }.bind(this)
        );
    } else {
        setImmediate(callback);
    }
};

// The init function performs an initial load() from the configuration's settings files.
// For this to work, the Config object has to have a default_config_file and config_file member
Config.prototype.init = function (callback) {
    var default_count;
    var user_count;
    var default_config_file = this.getDefaultConfigFile();
    var profile_config_file = this.getProfileConfigFile();
    var config_file = this.getConfigFile();
    async.series(
        [
            function loadDefault(callback) {
                this.load(default_config_file, callback);
            }.bind(this),
            function saveDefaultCount(callback) {
                default_count = Object.keys(this._cache).length;
                callback();
            }.bind(this),
            function loadUserConfig(callback) {
                this.load(
                    config_file,
                    function (err, data) {
                        if (err) {
                            if (err.code === "ENOENT") {
                                log.warn("Configuration file " + config_file + " not found.");
                                this._loaded = true;
                                this.save(callback, true);
                            } else {
                                log.warn(
                                    'Problem loading the user configuration file CONFIG "' +
                                        config_file +
                                        '": ' +
                                        err.message
                                );
                                this._loaded = true;
                                this.userConfigLoaded = true;
                                this.save(callback);
                            }
                        } else {
                            this._loaded = true;
                            this.userConfigLoaded = true;
                            user_count = Object.keys(data).length;
                            callback(null, this);
                        }
                    }.bind(this)
                );
            }.bind(this),
            function saveIfNeeded(callback) {
                if (default_count != user_count) {
                    this.save(callback);
                } else {
                    callback();
                }
            }.bind(this),
        ],
        function (err, results) {
            if (err) {
                callback(err);
            } else {
                callback(null, this);
            }
        }.bind(this)
    );
};

// Return the path to the file containing the default values for this configuration
Config.prototype.getDefaultConfigFile = function () {
    return Config.getDefaultProfileDir("config") + this.config_name + ".json";
};

// Return the path to the file containing the profile-specific values for this configuration
Config.prototype.getProfileConfigFile = function () {
    return Config.getProfileDir("config") + this.config_name + ".json";
};

// Return the path to the file where this configuration stores its data
Config.prototype.getConfigFile = function () {
    return Config.getDataDir("config") + "/" + this.config_name + ".json";
};

// "Static Methods"

// Get the directory for the current profile
Config.getProfileDir = function (d) {
    var profile = Config.getCurrentProfile() || "default";
    return "/opt/fabmo/profiles/" + profile + "/" + (d ? d + "/" : "");
};

// Get the directory for the default profile
Config.getDefaultProfileDir = function (d) {
    return "/opt/fabmo/profiles/default/" + (d ? d + "/" : "");
};

// Get the mutable data directory for FabMo
// On unix-like systems, this is /opt/fabmo
Config.getDataDir = function (name) {
    var base;
    switch (PLATFORM) {
        case "win32":
        case "win64":
            base = "c:\\fabmo";
            break;
        default:
            base = "/opt/fabmo";
    }
    if (name) {
        return base + path.sep + name;
    } else {
        return base;
    }
};

// Get the current profile name
Config.getCurrentProfile = function () {
    var cfg = require("./index");
    var profile = cfg.engine.get("profile");
    return profile ? profile.toLowerCase() : undefined;
};

// Delete all macros
Config.deleteUserMacros = function (callback) {
    var installedMacrosDir = Config.getDataDir("macros");
    fs.readdir(installedMacrosDir, function (err, files) {
        if (err) {
            return callback(err);
        }
        try {
            files.forEach(function (file) {
                var to_delete = path.join(installedMacrosDir, file);
                fs.removeSync(to_delete);
            });
            callback();
        } catch (e) {
            log.error(e);
            callback(e);
        }
    });
};

// Delete all user configuration files, except for auth_secret and engine/updater.json
Config.deleteUserConfig = function (callback) {
    var config_dir = Config.getDataDir("config");
    fs.readdir(config_dir, function (err, files) {
        if (err) {
            return callback(err);
        }
        try {
            files.forEach(function (file) {
                if (file.search(/auth_secret|engine\.json|updater\.json$/i) === -1) {
                    var p = path.join(config_dir, file);
                    fs.removeSync(p);
                }
            });
            callback();
        } catch (e) {
            log.error(e);
            callback(e);
        }
    });
};

// Clear configuration
Config.deleteProfileData = function (callback) {
    Config.deleteUserConfig(function (err, data) {
        if (err) {
            log.error(err);
        }
        Config.deleteUserMacros(callback);
    });
};

// Creates the data directory and subdirectories if they do not already exist
Config.createDataDirectories = function (callback) {
    var create_directory = function (dir, callback) {
        dir = Config.getDataDir(dir);
        isDirectory(dir, function (isdir) {
            if (!isdir) {
                log.warn('Directory "' + dir + '" does not exist.  Creating a new one.');
                fs.mkdir(dir, function (err) {
                    if (!err) {
                        log.info('Successfully created directory "' + dir + '"');
                    }
                    callback(err);
                });
            } else {
                callback(null);
            }
        });
    }.bind(this);
    dirs = [
        null,
        "debug",
        "backup",
        "db",
        "log",
        "files",
        "config",
        "apps",
        "macros",
        "profiles",
        "approot",
        path.join("approot", "approot"),
    ];
    async.eachSeries(dirs, create_directory, callback);
};

// Convenience function for determining if path is a directory
// TODO - util.js?  Necessary?
function isDirectory(path, callback) {
    fs.stat(path, function (err, stats) {
        if (err) callback(undefined);
        else callback(stats.isDirectory());
    });
}

exports.Config = Config;
