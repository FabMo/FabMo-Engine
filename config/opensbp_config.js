/* eslint-disable no-undef */
/* eslint-disable no-unused-vars */
/*
 * opensbp_config.js
 *
 * Configuration tree for the OpenSBP runtime.
 *
 */
var fs = require("fs-extra");
var path = require("path");
var util = require("util");
var extend = require("../util").extend;
var PLATFORM = require("process").platform;
var log = require("../log").logger("config");

var Config = require("./config").Config;
var async = require("async");

// The OpenSBP configuration object manages the settings related to the OpenSBP runtime.
// Importantly, it keeps a field called `variables` which is a map of variable names to values
// that correspond to the persistent (dollar-sign) variables in OpenSBP - The OpenSBP runtime
// consults this configuration whenever persistent variables are read or written - it is what
// lends the persistence to those variables.
var OpenSBPConfig = function () {
    Config.call(this, "opensbp");
    // EventEmitter.call(this);
    // this.name = name;
    // this._cache = {}; // Assuming some kind of internal state
};
util.inherits(OpenSBPConfig, Config);

// Overide of Config.prototype.load is removing tempVariables on load.  See config.js
//   *This is duplicated code from config.js as a work around for the cache not being accesible in callbacks.
OpenSBPConfig.prototype.load = function (filename, callback) {
    this._filename = filename;

    // Check if auto-profile change is in progress
    var profileDef = require("./profile_definition");
    var definition = profileDef.read();
    var skipRecovery = profileDef.isChangeInProgress() || profileDef.hasAutoProfileDefinition();

    if (skipRecovery) {
        log.info("Auto-profile system active - skipping backup recovery for: " + filename);
    }

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

    // Get the actual target profile from auto-profile definition if it exists
    let actualTargetProfile = currentProfile; // default fallback
    if (skipRecovery && definition && definition.auto_profile && definition.auto_profile.profile_name) {
        actualTargetProfile = definition.auto_profile.profile_name;
    }
    const originalUserProfileFile = path.join(
        originalProfileDir,
        actualTargetProfile,
        "config/",
        path.basename(filename)
    );

    const tryLoadFile = (filePath, next) => {
        fs.readFile(filePath, "utf8", (err, data) => {
            if (err) {
                return next(err);
            }
            try {
                data = JSON.parse(data);
                if (Object.prototype.hasOwnProperty.call(data, "tempVariables")) {
                    data["tempVariables"] = {};
                }

                // REMOVED: Profile blocking logic
                // Let normal config merge happen - auto-profile system handles the rest

                this.update(
                    data,
                    (err, d) => {
                        if (err) {
                            return next(err);
                        }
                        next(); // Continue the chain
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
        if (skipRecovery) {
            log.info("Skipping backup recovery due to auto-profile in progress");
            return next(); // Return success, not error
        }

        fs.access(backupDir, fs.constants.F_OK, (err) => {
            if (err) {
                log.warn(`Backup directory does not exist: ${backupDir}`);
                return next();
            }
            log.info(`Attempting to load from backup: ${backupFile}`);
            tryLoadFile(backupFile, next);
        });
    };

    const loadFromWorkingProfile = (next) => {
        if (skipRecovery) {
            log.info("Skipping working profile recovery due to auto-profile system");
            return next(); // Return success, not error
        }

        fs.access(workingProfileDir, fs.constants.F_OK, (err) => {
            if (err) {
                log.warn(`Working profile directory does not exist: ${workingProfileDir}`);
                return next();
            }
            log.info(`Attempting to rebuild from working profile: ${defaultProfileFile} and ${userProfileFile}`);
            async.series([(cb) => tryLoadFile(defaultProfileFile, cb), (cb) => tryLoadFile(userProfileFile, cb)], next);
        });
    };

    const loadFromOriginalProfile = (next) => {
        // ALWAYS try to load from original profiles - this provides baseline defaults
        // Do NOT check skipRecovery here - we need these defaults even during auto-profile
        log.info(
            `Attempting to rebuild from original profile: ${originalDefaultProfileFile} and ${originalUserProfileFile}`
        );

        // Debug: Check if files exist
        log.debug(
            `Checking original default profile: ${originalDefaultProfileFile} - exists: ${fs.existsSync(
                originalDefaultProfileFile
            )}`
        );
        log.debug(
            `Checking original user profile: ${originalUserProfileFile} - exists: ${fs.existsSync(
                originalUserProfileFile
            )}`
        );

        async.series(
            [
                (cb) => {
                    log.debug(`Trying to load original default profile: ${originalDefaultProfileFile}`);
                    tryLoadFile(originalDefaultProfileFile, cb);
                },
                (cb) => {
                    log.debug(`Trying to load original user profile: ${originalUserProfileFile}`);
                    tryLoadFile(originalUserProfileFile, cb);
                },
            ],
            (err) => {
                if (err) {
                    log.error(`Original profile loading failed: ${err.message}`);
                } else {
                    log.info(`Original profile loading succeeded`);
                }
                next(err);
            }
        );
    };

    // Try direct load first, then fallback
    tryLoadFile(filename, (err) => {
        if (err) {
            log.warn(`Failed to load config file: ${filename}, trying backup.`);

            async.series([loadFromBackup, loadFromWorkingProfile, loadFromOriginalProfile], (err) => {
                if (err) {
                    log.warn(`Failed to load configuration from all sources: ${err.message}`);
                    callback(err);
                } else {
                    callback(null, this._cache); // ✅ Return the cache data
                }
            });
        } else {
            callback(null, this._cache); // ✅ Return the cache data
        }
    });
};

// Update the tree with the provided data. Deal with values shared by runtime with G2
////## xy version of values is kludge for SBP legacy compatibility with dummy 'y' entry
OpenSBPConfig.prototype.update = function (data, callback, force) {
    try {
        extend(this._cache, data, force);
    } catch (e) {
        return callback(e);
    }
    // Update Jerk Values to current G2, no longer saved in g2.json
    if (!data.tempVariables && !data.variables) {
        if ("xy_maxjerk" in this._cache) {
            config.machine.machine.driver.command({
                xjm: this._cache["xy_maxjerk"],
            });
        }
        if ("xy_maxjerk" in this._cache) {
            config.machine.machine.driver.command({
                yjm: this._cache["xy_maxjerk"],
            });
        }
        if ("z_maxjerk" in this._cache) {
            config.machine.machine.driver.command({
                zjm: this._cache["z_maxjerk"],
            });
        }
        if ("a_maxjerk" in this._cache) {
            config.machine.machine.driver.command({
                ajm: this._cache["a_maxjerk"],
            });
        }
        if ("b_maxjerk" in this._cache) {
            config.machine.machine.driver.command({
                bjm: this._cache["b_maxjerk"],
            });
        }
        if ("c_maxjerk" in this._cache) {
            config.machine.machine.driver.command({
                cjm: this._cache["c_maxjerk"],
            });
        }

        // Update Jog Speed to current G2, no longer saved in g2.json (this is called velocity max for G2)
        if ("jogxy_speed" in this._cache) {
            config.machine.machine.driver.command({
                xvm: this._cache["jogxy_speed"] * 60,
            });
        }
        if ("jogxy_speed" in this._cache) {
            config.machine.machine.driver.command({
                yvm: this._cache["jogxy_speed"] * 60,
            });
        }
        if ("jogz_speed" in this._cache) {
            config.machine.machine.driver.command({
                zvm: this._cache["jogz_speed"] * 60,
            });
        }
        if ("joga_speed" in this._cache) {
            config.machine.machine.driver.command({
                avm: this._cache["joga_speed"] * 60,
            });
        }
        if ("jogb_speed" in this._cache) {
            config.machine.machine.driver.command({
                bvm: this._cache["jogb_speed"] * 60,
            });
        }
        if ("jogc_speed" in this._cache) {
            config.machine.machine.driver.command({
                cvm: this._cache["jogc_speed"] * 60,
            });
        }

        // Update Safe Z Pull Up as feed hold lift in G2, not done for A, B, or C axis ... should be if made linear
        ////##  TODO: also implement turning safeZ completely off via G2 feed hold parameter (e.g. for 5 axis)
        if ("safeZpullUp" in this._cache) {
            config.machine.machine.driver.command({
                zl: this._cache["safeZpullUp"],
            });
        }
    }
    //    this.emit("configChanged", this._cache); // Emit event with the current state of the config
    this.save(function (err, result) {
        if (err) {
            callback(err);
        } else {
            callback(null, data);
        }
    });
};

// SetMany remains the same
OpenSBPConfig.prototype.setMany = OpenSBPConfig.prototype.update;

// Apply this configuration. Currently this is a NOOP
OpenSBPConfig.prototype.apply = function (callback) {
    setImmediate(callback, null);
};

// Helper function to navigate the access path
function navigateAccessPath(value, accessPath) {
    for (let part of accessPath) {
        let key = part.value;
        if (value && key in value) {
            value = value[key];
        } else {
            throw new Error("Property or index '" + key + "' not found.");
        }
    }
    return value;
}

// Helper function to set a value at a nested path
function setNestedValue(obj, accessPath, value) {
    let current = obj;
    for (let i = 0; i < accessPath.length - 1; i++) {
        const key = accessPath[i].value;
        if (!(key in current)) {
            current[key] = {};
        }
        current = current[key];
    }
    const lastKey = accessPath[accessPath.length - 1].value;
    current[lastKey] = value;
}

// PERMANENT VARIABLES ("$" VARIABLES)

// Return the value of the variable with the specified identifier
//   identifier - An object with 'name' and 'access' properties
OpenSBPConfig.prototype.getVariable = function (identifier) {
    const variableName = identifier.name.toUpperCase();
    const accessPath = identifier.access || [];
    const variables = this._cache["variables"];

    if (!variables || !(variableName in variables)) {
        throw new Error("Permanent Variable $" + variableName + " was used but not defined.");
    }

    let value = variables[variableName];
    value = navigateAccessPath(value, accessPath);
    return value;
};

// Set the variable identified by 'identifier' to the provided value.
//   identifier - An object with 'name' and 'access' properties
//       value - The value to assign
//    callback - Called when the variable has been set
OpenSBPConfig.prototype.setVariable = function (identifier, value, callback) {
    const variableName = identifier.name;
    const accessPath = identifier.access || [];
    let variables = this._cache["variables"] || {};

    if (!(variableName in variables)) {
        variables[variableName] = {};
    }

    if (accessPath.length === 0) {
        // Simple variable assignment
        variables[variableName] = value;
    } else {
        // Nested variable assignment
        setNestedValue(variables[variableName], accessPath, value);
    }

    // Update the cache
    var u = { variables: variables };
    this.update(u, callback, true);
};

// Promise wrapper to allow async/await
OpenSBPConfig.prototype.setVariableWrapper = async function (identifier, value) {
    return new Promise((resolve, reject) => {
        this.setVariable(identifier, value, function (err, result) {
            if (err) {
                reject(err);
            } else {
                resolve(result);
            }
        });
    });
};

// Return true if the provided variable has been defined
//   identifier - An object with 'name' and 'access' properties
OpenSBPConfig.prototype.hasVariable = function (identifier) {
    const variableName = identifier.name.toUpperCase();
    const accessPath = identifier.access || [];
    const variables = this._cache["variables"];

    if (!variables || !(variableName in variables)) {
        return false;
    }

    let value = variables[variableName];

    try {
        value = navigateAccessPath(value, accessPath);
        return value !== undefined;
    } catch (e) {
        return false;
    }
};

// TEMP VARIABLES ("&" VARIABLES)

// Return the value of the temp variable with the specified identifier
//   identifier - An object with 'name' and 'access' properties
OpenSBPConfig.prototype.getTempVariable = function (identifier) {
    const variableName = identifier.name.toUpperCase();
    const accessPath = identifier.access || [];
    const tempVariables = this._cache["tempVariables"];

    if (!tempVariables || !(variableName in tempVariables)) {
        throw new Error("Temp Variable &" + variableName + " was used but not defined.");
    }

    let value = tempVariables[variableName];
    value = navigateAccessPath(value, accessPath);
    return value;
};

// Set the temp variable identified by 'identifier' to the provided value.
//   identifier - An object with 'name' and 'access' properties
//       value - The value to assign
//    callback - Called when the variable has been set
OpenSBPConfig.prototype.setTempVariable = function (identifier, value, callback) {
    const variableName = identifier.name;
    const accessPath = identifier.access || [];
    let tempVariables = this._cache["tempVariables"] || {};

    if (!(variableName in tempVariables)) {
        tempVariables[variableName] = {};
    }

    if (accessPath.length === 0) {
        // Simple variable assignment
        tempVariables[variableName] = value;
    } else {
        // Nested variable assignment
        setNestedValue(tempVariables[variableName], accessPath, value);
    }

    // Update the cache
    var u = { tempVariables: tempVariables };
    this.update(u, callback, true);
};

// Promise wrapper to allow async/await
OpenSBPConfig.prototype.setTempVariableWrapper = async function (identifier, value) {
    return new Promise((resolve, reject) => {
        this.setTempVariable(identifier, value, function (err, result) {
            if (err) {
                reject(err);
            } else {
                resolve(result);
            }
        });
    });
};

// Return true if the provided temp variable has been defined
//   identifier - An object with 'name' and 'access' properties
OpenSBPConfig.prototype.hasTempVariable = function (identifier) {
    const variableName = identifier.name.toUpperCase();
    const accessPath = identifier.access || [];
    const tempVariables = this._cache["tempVariables"];

    if (!tempVariables || !(variableName in tempVariables)) {
        return false;
    }

    let value = tempVariables[variableName];

    try {
        value = navigateAccessPath(value, accessPath);
        return value !== undefined;
    } catch (e) {
        return false;
    }
};

exports.OpenSBPConfig = OpenSBPConfig;
