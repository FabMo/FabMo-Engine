/*
 * engine_config.js
 *
 * This file defines the configuration for the engine.
 *
 * When the profile is changed, the new profile is applied as needed.
 * When the log level changes, apply that change immediately to the logging system.
 */
var util = require("util");
var Config = require("./config").Config;
var LogTool = require("../log");
var log = LogTool.logger("config");
var profiles = require("../profiles");
var process = require("process");

// The EngineConfig object keeps track of engine-specific settings
var EngineConfig = function () {
    Config.call(this, "engine");
};
util.inherits(EngineConfig, Config);

// The update function
// Nothing special here EXCEPT:
// If the value passed in for the profile is different than the current profile, we write
// the configuration to disk and exit the engine altogether.  It is assumed that systemd (or whoever launched the engine)
// will pick up and restart the engine after the abort.
EngineConfig.prototype.update = function (data, callback) {
    var profile_changed = false;
    try {
        for (var key in data) {
            if (key === "profile") {
                var newProfile = data[key];
                // Make note if the profile changed.  If so, we want to apply the new profile
                // (Which will probably make a bunch of sweeping configuration changes)
                if (key in this._cache && data[key] != this._cache[key]) {
                    try {
                        log.info(
                            "Profile changed from " +
                                this._cache[key] +
                                " to " +
                                data[key]
                        );
                    } catch (err) {
                        console.warn("EngineConfig update failed");
                    }
                    profile_changed = true;
                } else {
                    log.info("No initial profile changed.");
                }
            }
            this._cache[key] = data[key];
        }
    } catch (e) {
        if (callback) {
            return setImmediate(callback, e);
        }
    }

    // TODO - fix the that=this pattern - it's obnoxious.  Bind, or eventually arrow function
    var that = this;
    function save(callback) {
        // eslint-disable-next-line no-unused-vars
        that.save(function (err, result) {
            if (err) {
                // eslint-disable-next-line no-undef
                typeof callback === "function" && callback(e);
            } else {
                typeof callback === "function" && callback(null, data);
            }
        });
    }
    // If the profile changed above, we apply it, and if that was successful, we abort the process.
    ////## This is where we are generating the object-object error during startup??
    if (profile_changed) {
        log.warn("Engine profile changed - engine will be restarted.");
        // eslint-disable-next-line no-unused-vars
        profiles.apply(newProfile, function (err, data) {
            if (err) {
                log.error(err);
                callback(err);
            } else {
                log.info("shutting down");
                process.exit(1);
            }
        });
    } else {
        save(callback);
    }
};

// Apply the engine settings
//   callback - Called when settings have been applied or with error if error
EngineConfig.prototype.apply = function (callback) {
    try {
        LogTool.setGlobalLevel(this.get("log_level"));
        callback(null, this);
    } catch (e) {
        callback(e);
    }
};

exports.EngineConfig = EngineConfig;
