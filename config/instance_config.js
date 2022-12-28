/*
 * instance_config.js
 *
 * This module defines the instance config, which might be better called the "runtime state"
 * Currently, it is used to save the machine position/offsets when the tool stops.
 * (and restore it when the engine is restarted)
 */
Config = require("./config").Config;
var log = require("../log");
var logger = log.logger("config");

// The InstanceConfig object keeps track of runtime settings - they aren't set by the user and are used for things like positional memory, etc.
InstanceConfig = function (driver) {
    Config.call(this, "instance");
    this.driver = driver;
};
util.inherits(InstanceConfig, Config);

// The instance update function is pretty basic for now,
// but if new values provoke a reconfiguration of the application, this is where it will be done.
InstanceConfig.prototype.update = function (data, callback) {
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

// Apply this configuration - set the machine position to the saved value
//   callback - called once the values have been restored (or error)
InstanceConfig.prototype.apply = function (callback) {
    try {
        var position = this.get("position");
        this.driver.setMachinePosition(position, callback);
    } catch (e) {
        callback(e);
    }
};

exports.InstanceConfig = InstanceConfig;
