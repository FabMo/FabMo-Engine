var fs = require("fs");
var path = require("path");
var log = require("../log").logger("profile_def");

var ProfileDefinition = function () {
    this.definition_file = "/fabmo-def/fabmo-def.json";
    this.applied_marker = "/opt/fabmo/config/.auto_profile_applied";
};

ProfileDefinition.prototype.exists = function () {
    try {
        return fs.existsSync(this.definition_file);
    } catch (err) {
        return false;
    }
};

ProfileDefinition.prototype.isAlreadyApplied = function () {
    return fs.existsSync(this.applied_marker);
};

ProfileDefinition.prototype.read = function () {
    try {
        if (!this.exists()) {
            log.debug("No profile definition file found at: " + this.definition_file);
            return null;
        }

        var data = fs.readFileSync(this.definition_file, "utf8");
        var definition = JSON.parse(data);

        // Validate structure
        if (!definition.auto_profile || !definition.auto_profile.profile_name) {
            log.warn("Invalid profile definition structure");
            return null;
        }

        if (!definition.auto_profile.enabled) {
            log.info("Auto-profile is disabled in definition file");
            return null;
        }

        log.info("Found profile definition: " + definition.auto_profile.profile_name);
        return definition;
    } catch (err) {
        log.error("Error reading profile definition: " + err.message);
        return null;
    }
};

ProfileDefinition.prototype.markAsApplied = function (profileName, callback) {
    var self = this;

    // Get the actual running engine version
    this.getEngineVersion(function (engineVersion) {
        var marker = {
            profile_applied: profileName,
            applied_at: new Date().toISOString(),
            engine_version: engineVersion,
            in_progress: false, // Mark as complete
        };

        fs.writeFile(self.applied_marker, JSON.stringify(marker, null, 2), function (err) {
            if (err) {
                log.error("Could not create applied marker: " + err.message);
            } else {
                log.info("Marked profile as applied: " + profileName);
            }
            callback && callback(err);
        });
    });
};

// New method to mark profile change in progress
ProfileDefinition.prototype.markAsInProgress = function (profileName, callback) {
    var self = this;

    // Get the actual running engine version
    this.getEngineVersion(function (engineVersion) {
        var marker = {
            profile_applied: profileName,
            applied_at: new Date().toISOString(),
            engine_version: engineVersion,
            in_progress: true, // Mark as in progress
        };

        fs.writeFile(self.applied_marker, JSON.stringify(marker, null, 2), function (err) {
            if (err) {
                log.error("Could not create in-progress marker: " + err.message);
            } else {
                log.info("Marked profile change in progress: " + profileName);
            }
            callback && callback(err);
        });
    });
};

// Add method to get the actual engine version
ProfileDefinition.prototype.getEngineVersion = function (callback) {
    try {
        // Try to get version from the running engine
        var config = require("./index"); // Main config module

        if (config && config.engine && config.engine.get) {
            // Try to get version from engine config
            var version = config.engine.get("version");
            if (version) {
                return callback(version);
            }
        }

        // Try to get version from engine instance if available
        if (global.engine && global.engine.version) {
            return callback(global.engine.version);
        }

        // Try to get from the version module
        try {
            var versionInfo = require("../version");
            if (versionInfo && versionInfo.number) {
                return callback(versionInfo.number);
            }
        } catch (versionErr) {
            // Version module might not exist
        }

        // Fallback to package.json version
        var packageVersion = require("../package.json").version;
        log.warn("Using package.json version as fallback: " + packageVersion);
        callback(packageVersion);
    } catch (err) {
        log.warn("Could not determine engine version: " + err.message);
        callback("unknown");
    }
};

// Check if auto-profile change is in progress
ProfileDefinition.prototype.isChangeInProgress = function () {
    try {
        if (fs.existsSync(this.applied_marker)) {
            var marker = JSON.parse(fs.readFileSync(this.applied_marker, "utf8"));
            return marker.in_progress === true;
        }
    } catch (err) {
        log.warn("Error checking in-progress status: " + err.message);
    }
    return false;
};

ProfileDefinition.prototype.shouldApplyProfile = function () {
    var definition = this.read();
    if (!definition) return false;

    // Don't apply if already applied (unless force_reapply is true)
    if (this.isAlreadyApplied() && !definition.auto_profile.force_reapply) {
        log.info("Profile already auto-applied, skipping");
        return false;
    }

    return definition;
};

module.exports = new ProfileDefinition();
