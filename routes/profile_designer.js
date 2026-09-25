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

// GET /profile_designer/profiles
// Saved profiles available for editing (the default profile is the
// baseline, not an editable profile, so it is excluded).
// eslint-disable-next-line no-unused-vars
var getProfilesList = function (req, res, next) {
    var dir = config.getDataDir("profiles");
    var list = [];
    try {
        fs.readdirSync(dir).forEach(function (entry) {
            if (entry === "default" || entry.charAt(0) === ".") return;
            var pkgFile = path.join(dir, entry, "package.json");
            if (!fs.existsSync(pkgFile)) return;
            try {
                var pkg = JSON.parse(fs.readFileSync(pkgFile, "utf8"));
                list.push({
                    dir: entry,
                    name: pkg.name || entry,
                    description: pkg.description || "",
                    version: pkg.version || "",
                });
            } catch (e) {
                log.warn("Unreadable profile package.json in " + entry + ": " + e.message);
            }
        });
    } catch (e) {
        return res.json({ status: "error", message: e.message });
    }
    res.json({ status: "success", data: { profiles: list } });
};

// GET /profile_designer/profile/:id
// Load a saved profile for editing: its package info, config diffs,
// bundled app archive names, and whether it carries macros.
// eslint-disable-next-line no-unused-vars
var getProfile = function (req, res, next) {
    var id = path.basename(req.params.id || "");
    var dir = path.join(config.getDataDir("profiles"), id);
    if (!id || id === "default" || !fs.existsSync(path.join(dir, "package.json"))) {
        return res.json({ status: "error", message: "No such profile: " + id });
    }
    var out = { dir: id, package: {}, configs: {}, apps: [], has_macros: false };
    try {
        out.package = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
        CONFIG_FILES.forEach(function (name) {
            var f = path.join(dir, "config", name + ".json");
            if (fs.existsSync(f)) {
                try {
                    out.configs[name] = JSON.parse(fs.readFileSync(f, "utf8"));
                } catch (e) {
                    log.warn("Unreadable " + f + ": " + e.message);
                }
            }
        });
        var appsDir = path.join(dir, "apps");
        if (fs.existsSync(appsDir)) {
            out.apps = fs.readdirSync(appsDir).filter(function (f) {
                return f.charAt(0) !== ".";
            });
        }
        var macrosDir = path.join(dir, "macros");
        out.has_macros = fs.existsSync(macrosDir) && fs.readdirSync(macrosDir).length > 0;
    } catch (e) {
        return res.json({ status: "error", message: e.message });
    }
    res.json({ status: "success", data: out });
};

// GET /profile_designer/apps
// Apps eligible for inclusion in a profile. System apps ship with the
// engine anyway — they are listed (flagged) so a profile can pin a
// copy of one (e.g. sb4), but bundling them is normally unnecessary.
// eslint-disable-next-line no-unused-vars
var getEligibleApps = function (req, res, next) {
    var systemDir = path.join(__dirname, "..", "dashboard", "apps");
    var apps = (dashboard.getAppList() || [])
        .filter(function (app) {
            return app.app_archive_path && fs.existsSync(app.app_archive_path);
        })
        .map(function (app) {
            return {
                id: app.id,
                name: app.name,
                icon_path: app.icon_path,
                system: app.app_archive_path.indexOf(systemDir) === 0,
            };
        })
        .sort(function (a, b) {
            return a.system === b.system ? a.name.localeCompare(b.name) : a.system ? 1 : -1;
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
//         apps: [app ids], overwrite: bool,
//         source_profile: <dirname being edited, if any>,
//         keep_apps: [archive filenames from source to retain],
//         macros_mode: "none" | "machine" | "keep" }
// Writes <profiles dir>/fabmo-profile-<slug>/ with only the provided
// (non-empty) config diffs. include_macros:true is accepted as a
// legacy alias for macros_mode:"machine".
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
    var profilesDir = config.getDataDir("profiles");
    var target = path.join(profilesDir, dirname);

    if (fs.existsSync(target) && !body.overwrite) {
        return res.json({
            status: "error",
            message: "Profile '" + dirname + "' already exists",
            data: { exists: true, profile: dirname },
        });
    }

    var macrosMode = body.macros_mode || (body.include_macros ? "machine" : "none");

    try {
        // When editing an existing profile, archives/macros to be kept
        // must be stashed before the target is emptied — the target may
        // BE the source.
        var keptArchives = {}; // filename -> Buffer
        var keptMacros = null; // filename -> Buffer
        var sourceDir = body.source_profile
            ? path.join(profilesDir, path.basename(body.source_profile))
            : null;
        if (sourceDir && fs.existsSync(sourceDir)) {
            (body.keep_apps || []).forEach(function (f) {
                var src = path.join(sourceDir, "apps", path.basename(f));
                if (fs.existsSync(src)) {
                    keptArchives[path.basename(f)] = fs.readFileSync(src);
                }
            });
            if (macrosMode === "keep") {
                var srcMacros = path.join(sourceDir, "macros");
                if (fs.existsSync(srcMacros)) {
                    keptMacros = {};
                    fs.readdirSync(srcMacros).forEach(function (f) {
                        keptMacros[f] = fs.readFileSync(path.join(srcMacros, f));
                    });
                }
            }
        }

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

        // Archives kept from the profile being edited (apps that may
        // not be installed on this machine) are written back first;
        // freshly-selected installed apps land second so a same-named
        // installed copy wins.
        var keptNames = Object.keys(keptArchives);
        if (keptNames.length > 0) {
            fs.ensureDirSync(path.join(target, "apps"));
            keptNames.forEach(function (f) {
                fs.writeFileSync(path.join(target, "apps", f), keptArchives[f]);
            });
        }

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

        // Macros: capture this machine's, keep the edited profile's, or none
        if (macrosMode === "machine") {
            var macroDir = config.getDataDir("macros");
            if (fs.existsSync(macroDir)) {
                fs.copySync(macroDir, path.join(target, "macros"));
            }
        } else if (macrosMode === "keep" && keptMacros) {
            fs.ensureDirSync(path.join(target, "macros"));
            Object.keys(keptMacros).forEach(function (f) {
                fs.writeFileSync(path.join(target, "macros", f), keptMacros[f]);
            });
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
    server.get("/profile_designer/profiles", getProfilesList);
    server.get("/profile_designer/profile/:id", getProfile);
    server.post("/profile_designer/save", saveProfile);
};
