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
// Around line 28-210

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
    let actualTargetProfile = currentProfile;
    if (skipRecovery && definition && definition.auto_profile && definition.auto_profile.profile_name) {
        actualTargetProfile = definition.auto_profile.profile_name;
    }
    const originalUserProfileFile = path.join(
        originalProfileDir,
        actualTargetProfile,
        "config/",
        path.basename(filename)
    );

    // Helper function to load a single file
    const tryLoadFile = (filePath, next) => {
        log.debug(`Attempting to load: ${filePath}`);
        
        fs.readFile(filePath, "utf8", (err, data) => {
            if (err) {
                log.debug(`Failed to load ${filePath}: ${err.message}`);
                return next(err);
            }
            
            // Validate data before parsing
            if (!data || typeof data !== 'string') {
                const error = new Error(`Invalid data read from ${filePath}`);
                log.debug(error.message);
                return next(error);
            }
            
            try {
                // Parse the JSON
                const parsedData = JSON.parse(data);
                
                // Validate it's an object
                if (typeof parsedData !== 'object' || parsedData === null) {
                    const error = new Error(`Invalid JSON structure in ${filePath}`);
                    log.debug(error.message);
                    return next(error);
                }
                
                // Clear tempVariables on load (they're session-specific, not persistent)
                if (Object.prototype.hasOwnProperty.call(parsedData, "tempVariables")) {
                    parsedData["tempVariables"] = {};
                }

                // Update the cache
                this.update(
                    parsedData,
                    (err, d) => {
                        if (err) {
                            log.error(`Failed to update cache from ${filePath}: ${err.message}`);
                            return next(err);
                        }
                        log.info(`Successfully loaded configuration from ${filePath}`);
                        next(); // Success!
                    },
                    true // force update
                );
            } catch (parseError) {
                log.error(`JSON parse error in ${filePath}: ${parseError.message}`);
                return next(parseError);
            }
        });
    };

    // Helper function to load a pair of profile files (default + user)
    const tryLoadProfile = (defaultFile, userFile, next) => {
        log.debug(`Attempting to load profile: default=${defaultFile}, user=${userFile}`);
        
        async.series(
            [
                (cb) => tryLoadFile(defaultFile, cb),
                (cb) => tryLoadFile(userFile, cb)
            ],
            (err) => {
                if (err) {
                    log.debug(`Profile load failed: ${err.message}`);
                } else {
                    log.info("Profile load succeeded");
                }
                next(err);
            }
        );
    };

    // Define the fallback chain
    // Each step only runs if the previous step failed
    const loadStrategies = [
        // Strategy 1: Load from primary config file
        {
            name: "primary config",
            execute: (cb) => tryLoadFile(filename, cb)
        },
        
        // Strategy 2: Load from backup (skip if auto-profile active)
        {
            name: "backup",
            execute: (cb) => {
                if (skipRecovery) {
                    log.debug("Skipping backup (auto-profile active)");
                    return cb(new Error("Skipping backup during auto-profile"));
                }
                tryLoadFile(backupFile, cb);
            }
        },
        
        // Strategy 3: Load from working profile (skip if auto-profile active)
        {
            name: "working profile",
            execute: (cb) => {
                if (skipRecovery) {
                    log.debug("Skipping working profile (auto-profile active)");
                    return cb(new Error("Skipping working profile during auto-profile"));
                }
                tryLoadProfile(defaultProfileFile, userProfileFile, cb);
            }
        },
        
        // Strategy 4: Load from original installation profile (final fallback)
        {
            name: "original profile",
            execute: (cb) => {
                tryLoadProfile(originalDefaultProfileFile, originalUserProfileFile, cb);
            }
        }
    ];

    // Execute the fallback chain
    // Try each strategy in order, stop on first success
    let strategyIndex = 0;
    
    const tryNextStrategy = () => {
        if (strategyIndex >= loadStrategies.length) {
            // All strategies failed
            const error = new Error("Failed to load configuration from all sources");
            log.error(error.message);
            return callback(error);
        }
        
        const strategy = loadStrategies[strategyIndex];
        log.debug(`Trying load strategy ${strategyIndex + 1}/${loadStrategies.length}: ${strategy.name}`);
        
        strategy.execute((err) => {
            if (!err) {
                // Success! We're done
                log.info(`Configuration loaded successfully via ${strategy.name}`);
                return callback(null, this._cache);
            }
            
            // This strategy failed, try the next one
            log.debug(`Strategy '${strategy.name}' failed: ${err.message}`);
            strategyIndex++;
            tryNextStrategy();
        });
    };
    
    // Start the chain
    tryNextStrategy();
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
