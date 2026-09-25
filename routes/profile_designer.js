/*
 * routes/profile_designer.js
 *
 * API for the Profile Designer app. Machine profiles are applied ON TOP
 * of the default profile's configs (see profiles.js / config.js
 * loadFromWorkingProfile), so a good profile contains ONLY the settings
 * that differ from the defaults. The designer shows the default configs,
 * lets the user edit values, and saves just the diff plus a selection of
 * installed apps (and optionally the machine's current macros) as a new
 * profile directory under the working profiles dir (/opt/fabmo/profiles).
 *
 * Copying a saved profile into the engine source tree for release is a
 * separate, manual step.
 */
var fs = require("fs-extra");
var path = require("path");
var config = require("../config");
var dashboard = require("../dashboard");
var profiles = require("../profiles");
var log = require("../log").logger("profile_designer");

// Config files that participate in profiles, in the order the designer
// should present them.
var CONFIG_FILES = ["machine", "opensbp", "g2", "engine", "instance"];

function defaultConfigDir() {
    var working = path.join(config.getDataDir("profiles"), "default", "config");
    if (fs.existsSync(working)) {
        return working;
    }
    // Fall back to the shipped copy (fresh install edge case)
    return path.join(__dirname, "..", "profiles", "default", "config");
}

// GET /profile_designer/defaults
// The default profile's config files — the baseline the designer diffs against.
// eslint-disable-next-line no-unused-vars
var getDefaults = function (req, res, next) {
    var dir = defaultConfigDir();
    var configs = {};
    CONFIG_FILES.forEach(function (name) {
        var file = path.join(dir, name + ".json");
        try {
            configs[name] = JSON.parse(fs.readFileSync(file, "utf8"));
        } catch (e) {
            log.warn("Could not read default config " + file + ": " + e.message);
            configs[name] = {};
        }
    });
    res.json({ status: "success", data: { configs: configs, files: CONFIG_FILES } });
};

// GET /profile_designer/apps
// User-installed apps eligible for inclusion in a profile. System apps
// ship with the engine and are never packaged into profiles.
// eslint-disable-next-line no-unused-vars
var getEligibleApps = function (req, res, next) {
    var systemDir = path.join(__dirname, "..", "dashboard", "apps");
    var apps = (dashboard.getAppList() || [])
        .filter(function (app) {
            return app.app_archive_path && app.app_archive_path.indexOf(systemDir) !== 0;
        })
        .map(function (app) {
            return { id: app.id, name: app.name, icon_path: app.icon_path };
        });
    res.json({ status: "success", data: { apps: apps } });
};

function slugify(name) {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

// POST /profile_designer/save
// Body: { name, description, version, configs: {machine:{...}, ...},
//         apps: [app ids], include_macros: bool, overwrite: bool }
// Writes <profiles dir>/fabmo-profile-<slug>/ with only the provided
// (non-empty) config diffs.
// eslint-disable-next-line no-unused-vars
var saveProfile = function (req, res, next) {
    var body = req.params || {};
    var name = (body.name || "").trim();
    if (!name) {
        return res.json({ status: "error", message: "A profile name is required" });
    }
    var slug = slugify(name);
    if (!slug) {
        return res.json({ status: "error", message: "Profile name must contain letters or numbers" });
    }
    var dirname = "fabmo-profile-" + slug;
    var target = path.join(config.getDataDir("profiles"), dirname);

    if (fs.existsSync(target) && !body.overwrite) {
        return res.json({
            status: "error",
            message: "Profile '" + dirname + "' already exists",
            data: { exists: true, profile: dirname },
        });
    }

    try {
        fs.emptyDirSync(target);

        // package.json identifies the profile
        fs.writeJsonSync(
            path.join(target, "package.json"),
            {
                name: name,
                description: body.description || "",
                version: body.version || "v0.0.1",
            },
            { spaces: 2 }
        );

        // Config diffs — only files with actual changes are written
        var configs = body.configs || {};
        var wroteConfig = false;
        CONFIG_FILES.forEach(function (cname) {
            var diff = configs[cname];
            if (diff && typeof diff === "object" && Object.keys(diff).length > 0) {
                fs.ensureDirSync(path.join(target, "config"));
                fs.writeJsonSync(path.join(target, "config", cname + ".json"), diff, { spaces: 2 });
                wroteConfig = true;
            }
        });

        // Selected apps — copy the installed archives in under a
        // readable filename (installed archives are UUID-named)
        var appIds = body.apps || [];
        var appErrors = [];
        if (appIds.length > 0) {
            fs.ensureDirSync(path.join(target, "apps"));
            var appList = dashboard.getAppList() || [];
            appIds.forEach(function (id) {
                var app = appList.filter(function (a) {
                    return a.id === id;
                })[0];
                if (!app || !app.app_archive_path || !fs.existsSync(app.app_archive_path)) {
                    appErrors.push(id);
                    return;
                }
                var ext = path.extname(app.app_archive_path) || ".fma";
                var filename = (slugify(app.name) || id) + ext;
                fs.copySync(app.app_archive_path, path.join(target, "apps", filename));
            });
        }

        // Optionally capture the machine's current macros
        if (body.include_macros) {
            var macroDir = config.getDataDir("macros");
            if (fs.existsSync(macroDir)) {
                fs.copySync(macroDir, path.join(target, "macros"));
            }
        }

        log.info("Profile Designer saved profile " + dirname + " to " + target);

        // Refresh the profile registry so the new profile is selectable
        // without an engine restart
        profiles.load(function (err) {
            if (err) {
                log.warn("Profile registry refresh failed: " + err);
            }
            res.json({
                status: "success",
                data: {
                    profile: dirname,
                    path: target,
                    wrote_config: wroteConfig,
                    app_errors: appErrors,
                },
            });
        });
    } catch (e) {
        log.error(e);
        res.json({ status: "error", message: "Could not save profile: " + e.message });
    }
};

module.exports = function (server) {
    server.get("/profile_designer/defaults", getDefaults);
    server.get("/profile_designer/apps", getEligibleApps);
    server.post("/profile_designer/save", saveProfile);
};
