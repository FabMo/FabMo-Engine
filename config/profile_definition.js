var fs = require("fs");
var path = require("path");
var log = require("../log").logger("profile_def");

var ProfileDefinition = function () {
    this.definition_file = "/fabmo-def/fabmo-def.json";
    this.applied_marker = "/opt/fabmo/config/.auto_profile_applied";
    this._cache = null; 
    this._cacheTime = 0; // Cache timestamp
    this._cacheTTL = 5000; // 5 seconds cache TTL
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

ProfileDefinition.prototype.read = function (force) {
    const now = Date.now();
    
    // Return cached result if still valid (unless forced)
    if (!force && this._cache !== null && (now - this._cacheTime) < this._cacheTTL) {
        return this._cache;
    }
    
    try {
        if (!this.exists()) {
            log.debug("No profile definition file found at: " + this.definition_file);
            this._cache = null;
            this._cacheTime = now;
            return null;
        }

        var data = fs.readFileSync(this.definition_file, "utf8");
        var definition = JSON.parse(data);

        // Validate structure - require auto_profile with at least one
        // recovery target (profile_name or snapshot_name).
        if (
            !definition.auto_profile ||
            (!definition.auto_profile.profile_name && !definition.auto_profile.snapshot_name)
        ) {
            log.warn("Invalid profile definition structure");
            this._cache = null;
            this._cacheTime = now;
            return null;
        }

        if (!definition.auto_profile.enabled) {
            log.info("Auto-profile is disabled in definition file");
            this._cache = null;
            this._cacheTime = now;
            return null;
        }

        // Only log on first read or cache miss
        if (this._cache === null) {
            log.info("Found profile definition: " + definition.auto_profile.profile_name);
        }
        
        this._cache = definition;
        this._cacheTime = now;
        return definition;
    } catch (err) {
        log.error("Error reading profile definition: " + err.message);
        this._cache = null;
        this._cacheTime = now;
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

// Mark profile change in progress
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

// Get the actual engine version
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

ProfileDefinition.prototype.isApplied = function (profileName) {
    try {
        if (fs.existsSync(this.applied_marker)) {
            var content = fs.readFileSync(this.applied_marker, "utf8");
            var marker = JSON.parse(content);

            log.debug("Applied marker content: " + marker.profile_applied + ", checking against: " + profileName);

            // Check if this profile is applied and not in progress
            return marker.profile_applied === profileName && !marker.in_progress;
        }
        return false;
    } catch (err) {
        log.warn("Error checking if profile is applied: " + err.message);
        return false;
    }
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

ProfileDefinition.prototype.hasAutoProfileDefinition = function () {
    try {
        if (!this.exists()) {
            return false;
        }

        var definition = this.read();
        if (!definition) {
            return false;
        }

        // If already applied and not forcing reapply, don't treat as active
        if (this.isAlreadyApplied() && !definition.auto_profile.force_reapply) {
            return false;
        }

        return true;
    } catch (err) {
        return false;
    }
};

// Atomically write the fabmo-def.json file. Preserves any keys outside
// auto_profile and lets callers patch a subset of auto_profile fields.
// Writes are best-effort - if /fabmo-def is not writable, the error is
// surfaced via callback but does not throw.
ProfileDefinition.prototype._writePatch = function (patch, callback) {
    var self = this;
    var existing = {};
    try {
        if (this.exists()) {
            existing = JSON.parse(fs.readFileSync(this.definition_file, "utf8"));
        }
    } catch (err) {
        log.warn(
            "Existing fabmo-def.json is unreadable; rewriting from scratch: " + err.message
        );
        existing = {};
    }
    var nextAutoProfile = Object.assign(
        {},
        existing.auto_profile || {},
        patch.auto_profile || {}
    );
    // If a key in the patch is explicitly null, remove it.
    Object.keys(patch.auto_profile || {}).forEach(function (k) {
        if (patch.auto_profile[k] === null) {
            delete nextAutoProfile[k];
        }
    });
    // Default auto_profile fields if creating from scratch.
    if (!("enabled" in nextAutoProfile)) {
        nextAutoProfile.enabled = true;
    }
    if (!("force_reapply" in nextAutoProfile)) {
        nextAutoProfile.force_reapply = false;
    }
    var next = Object.assign({}, existing, { auto_profile: nextAutoProfile });
    var dir = path.dirname(this.definition_file);
    var tmp = this.definition_file + ".tmp";
    try {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    } catch (mkErr) {
        log.warn("Could not ensure /fabmo-def directory: " + mkErr.message);
        return callback && callback(mkErr);
    }
    fs.writeFile(tmp, JSON.stringify(next, null, 2), function (wErr) {
        if (wErr) {
            log.warn("Could not write fabmo-def.json tmp: " + wErr.message);
            return callback && callback(wErr);
        }
        fs.rename(tmp, self.definition_file, function (rErr) {
            if (rErr) {
                log.warn("Could not rename fabmo-def.json: " + rErr.message);
                try { fs.unlinkSync(tmp); } catch (e) { /* ignore */ }
                return callback && callback(rErr);
            }
            self._cache = null;
            self._cacheTime = 0;
            log.info("fabmo-def.json updated");
            callback && callback(null);
        });
    });
};

// Set the vanilla-profile fallback in fabmo-def.json.
ProfileDefinition.prototype.setProfileName = function (profileName, callback) {
    this._writePatch({ auto_profile: { profile_name: profileName } }, callback);
};

// Set the snapshot fallback in fabmo-def.json. Caller is responsible for
// mirroring the snapshot's contents to /fabmo-def/snapshots/<name>/.
ProfileDefinition.prototype.setSnapshotName = function (snapshotName, callback) {
    this._writePatch({ auto_profile: { snapshot_name: snapshotName } }, callback);
};

// Clear the snapshot fallback. The vanilla profile_name (if any) remains
// as the deeper fallback.
ProfileDefinition.prototype.clearSnapshotName = function (callback) {
    this._writePatch({ auto_profile: { snapshot_name: null } }, callback);
};

module.exports = new ProfileDefinition();
