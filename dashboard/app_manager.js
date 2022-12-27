/*
 * app_manager.js
 *
 * This module provides the functions for managing FabMo apps.
 *
 * FabMo apps are single-page web applications that have special authority to communicate back to
 * the server that hosts them.  They communicate through a websocket and REST API via a client
 * side javascript library called fabmo.js.  The engine provides the means (by way of this module)
 * for the user to upload and manage apps on the tool, and these apps are hosted and managed in such
 * a way that the FabMo client (dashboard) can display them, retrieve information about them, etc.
 *
 * # App Storage
 * Apps are packaged as .zip archives, usually (but not necessarily) with the extension .fma (fabmo app)
 * They are stored (typically) in /opt/fabmo/apps when uploaded, and kept in their archive format in this location.
 *
 * # App Hosting
 * Apps are expanded so that their files can be hosted by the engine.  The hosted location for the apps is
 * (typically) in /opt/fabmo/approot/approot (See code below to explain the need for the double-approot hierarchy)
 * When expanded, apps are placed in directories with names that are either supplied by their package.json, or
 * generated automatically.  Using auto generated names both ensures name uniqueness, and is
 * a cache-busting measure.  Apps are copied/expanded into the approot when they are installed, or on
 * system startup, only in cases where the engine detects that an app exists as an archive, but not in the approot.
 *
 * # System Apps
 * System apps are stored in the engine source tree (/dashboard/apps) in their expanded form, but follow the
 * same rules as user supplied apps.  They are copied to the approot directory just the same as user supplied
 * apps.
 *
 * # Notes
 * Here are some additional notes about apps that might be useful:
 *   - Because apps (particularly system apps) are subject to change (in an engine update for example)
 *     the approot directory is "cleared" strategically in order to provoke a most up-to-date version of
 *     all the apps to be expanded into the approot directory. The approot is cleared on engine updates,
 *      and perhaps at other times.
 *   - The only thing an app technically needs to be an app is a package.json, and an index file
 *     See the source below for readAppPackageInfo for information about what the package.json contains
 *   - `app_info` is a typical argument in this file - it is the object that represents information about
 *     an app.  All functions that take this argument are expecting the same type of argument.
 *     TODO: Arguments like this should be changed to camelCase to keep with coding convention
 *   - Apps are all managed in an internal index that maps an "App ID" to the app object itself (see
 *     app_info above) - apps can specify their own ID in the package.json - if they don't, one will be
 *     automatically supplied by the engine.  The advantage of supplying your own id is that no two apps
 *     in the system may have the same ID, so if you upload a second copy of an app whose id already exists,
 *     the first app will be overwritten.  This is useful while developing apps, so that you don't end up with
 *     many copies of the same app cluttering up your dash, but carries the burden of having to create
 *     globally-unique app names yourself.  Possible candidates might be something like they do for java
 *     packages:  companyname.domainname.version.appname or similar.
 */
var zip = require("adm-zip");
var path = require("path");
var os = require("os");
var ncp = require("ncp").ncp;
var fs = require("fs-extra");
var async = require("async");
var uuid = require("uuid");
var log = require("../log").logger("app_manager");
var util = require("../util");
var glob = require("glob");
var config = require("../config");

// Maximum depth of a deep copy operation
// The ncp module is used for copying app files around, and it has this safeguard to
// prevent huge ridiculous copy operations.
// !! Don't have more than 16 deep nested directories in your apps.
ncp.limit = 16;

// The AppManager object is the singleton object that provides all the functions for managing
// apps in the FabMo engine.  Options:
//          app_directory - The directory where user submitted apps will be stored
//   system_app_directory - The location where system apps will be stored.
// TODO: These options should be camelCase to keep to the coding conventions
var AppManager = function (options) {
    this.app_directory = options.app_directory;
    this.approot_directory = options.approot_directory;
    this.system_app_directory = path.join(__dirname, "apps");
    this.apps_index = {};
    this.app_configs = {};
    this.apps_list = [];
    try {
        this.machine = require("../machine").machine;
    } catch (e) {
        log.warn("No machine bound to AppManager");
        this.machine = null;
    }
};

// Notify any listeners that a change has been made to the app manager
AppManager.prototype.notifyChange = function () {
    if (this.machine) {
        this.machine.emit("change", "apps");
    }
};

// Given the app information object, read its package.json
// UPDATE the provided app_info object with the relevant information from the package.json
//   app_info - Info about the app.  Needs the following:
//                * app_path - The path to the app (where it is hosted in the approot)
//                * app_archive_path - The path to the app archive (where it is stored)
//   callback - Called back with the app info, thus modified, or an error if there was an error.
AppManager.prototype.readAppPackageInfo = function (app_info, callback) {
    var pkg_info_path = path.join(app_info.app_path, "package.json");

    var pathname = path.basename(app_info.app_archive_path);
    var id = pathname.match(/^([^.]*)/g)[0];
    fs.readFile(
        pkg_info_path,
        function (err, data) {
            if (err) {
                return callback(new Error("Could not read package.json"));
            }

            try {
                var package_info = JSON.parse(data);
            } catch (e) {
                return callback(new Error("Could not parse package.json"));
            }

            try {
                app_info.name = package_info.name;
                app_info.config_path = path.join(
                    app_info.app_path,
                    ".config.json"
                );
                app_info.icon_path = app_info.app_path + package_info.icon;
                app_info.icon_background_color =
                    package_info.icon_color || "blue";
                app_info.icon_display = package_info.icon_display;
                app_info.app_url = path.join(
                    "approot",
                    pathname,
                    package_info.main
                );
                app_info.icon_url = path.join(
                    "approot",
                    pathname,
                    package_info.icon
                );
                app_info.id = package_info.id || id;
                app_info.version = package_info.version || "";
                app_info.description =
                    package_info.description || "No description";
                callback(null, app_info);
            } catch (e) {
                callback(e);
            }
        }.bind(this)
    );
};

// Read the configuration file for the app.
// All apps, in their hosted location, have a configuration file called '.config.json' which stores
// configuration submitted through the fabmo.js API.  (dashboard.setAppConfig/dashboard.getAppConfig)
//   app_info - The app info object for which to retrieve the configuration data
//   callback - Called with the configuration data, or error if there was an error
AppManager.prototype.readAppConfiguration = function (app_info, callback) {
    fs.readFile(
        app_info.config_path,
        function (err, data) {
            try {
                var cfg_data = JSON.parse(data);
                callback(null, cfg_data);
            } catch (e) {
                callback(e);
            }
        }.bind(this)
    );
};

// For the provided app, read both its configuration and its package info.
//   app_info - Info object for the app to be queried
//   callback - Called with an object containing both the package info and configuration (or error)
AppManager.prototype.readAppMetadata = function (app_info, callback) {
    this.readAppPackageInfo(
        app_info,
        function (err, info) {
            if (err) {
                callback(err);
            } else {
                this.readAppConfiguration(
                    info,
                    function (err, cfg) {
                        if (err) {
                            //log.warn('Could not read app configuration: ' + err);
                        }
                        cfg = cfg || {};
                        callback(null, { info: info, config: cfg });
                    }.bind(this)
                );
            }
        }.bind(this)
    );
};

// Return the root directory for an app
//   id - The id of the app to query
AppManager.prototype.getAppRoot = function (id) {
    return this.apps_index[id].app_path;
};

// Return the index of all apps (maps app ids to app_info objects)
AppManager.prototype.getAppIndex = function () {
    return this.apps_index;
};

// Get the list of all apps - this is just the app index, but with the values formatted as a list
AppManager.prototype.getAppList = function () {
    return this.apps_list;
};

// Get the app configuration data for the specified app id
//   id - The app id to query
AppManager.prototype.getAppConfig = function (id) {
    return this.app_configs[id];
};

// Set the app configuration data for the specified app id and write to disk.
//       id - The app id of the app to update
//   config - The new config data.  Old data is overwritten
// callback - Called once the new configuration has been written to disk (error if error)
AppManager.prototype.setAppConfig = function (id, config, callback) {
    this.app_configs[id] = config || {};
    fs.writeFile(
        this.apps_index[id].config_path,
        JSON.stringify(config),
        callback
    );
};

// Reconstruct the list of apps from the app_index
// TODO : this is really only used internally, maybe should use the _function convention for private functions
AppManager.prototype.rebuildAppList = function () {
    this.apps_list = [];
    for (var key in this.apps_index) {
        this.apps_list.push(this.apps_index[key]);
    }
};

// Add the provided app object to the index
//   app - app_info object, as described above
AppManager.prototype._addApp = function (app) {
    if (app.info.id in this.apps_index) {
        var old_app = this.apps_index[app.info.id];
        fs.unlink(old_app.app_archive_path, function (err) {
            if (err) {
                log.warn("failed to remove an old app archive: " + err);
            }
        }); // unlink
    }
    this.apps_index[app.info.id] = app.info;
    this.app_configs[app.info.id] = app.config;
    this.rebuildAppList();
    this.notifyChange();
};

// Reload the app with the specified ID.  This provokes a re-expand/re-copy of the app from
// the archive location to the hosted location.
//         id - The id of the app to reload
//   callback - Called with the app_info object for the reloaded app
AppManager.prototype.reloadApp = function (id, callback) {
    app_info = this.apps_index[id];
    if (app_info) {
        this.loadApp(app_info.app_archive_path, { force: true }, callback);
    } else {
        callback(new Error("Not a valid app id: " + id));
    }
};

// Load an app and issue a callback when loaded.  This copies or decompresses the app into
// the approot (hosted) directory and
// In the case of a compressed app, this decompresses the app into the approot directory.
// In the case of a raw app (not-compressed), this copies the app to the approot directory.
//   pathname - Path to the app or app archive to load
//    options - `force` can be set to true to force the app to be copied/decompressed even if
//              the hosted app directory already exists.
AppManager.prototype.loadApp = function (pathname, options, callback) {
    // Check to see if the path exists
    fs.stat(
        pathname,
        function (err, stat) {
            if (err) {
                // Error if we couldn't stat
                return callback(err);
            }
            if (stat.isDirectory()) {
                // Copy if it's a directory
                return this.copyApp(
                    pathname,
                    this.approot_directory,
                    options,
                    callback
                );
            }

            var ext = path.extname(pathname).toLowerCase();
            if (ext === ".fma" || ext === ".zip") {
                // Decompress if it's a compressed app file
                return this.decompressApp(
                    pathname,
                    this.approot_directory,
                    options,
                    callback
                );
            } else {
                // Error if it's a file, but the wrong kind
                return callback(new Error(pathname + " is not an app."));
            }
        }.bind(this)
    );
};

// Delete the app with the provided id.
// This removes the app from both the archive location and the approot.
//       id - The id of the app to remove
// callback - Called with the app_info object for the app thus removed, or error if there was an error.
AppManager.prototype.deleteApp = function (id, callback) {
    app = this.apps_index[id];
    var app_id = id;
    if (app) {
        var app_path = app.app_path;
        var archive_path = app.app_archive_path;
        fs.remove(
            app_path,
            function (err) {
                if (err) {
                    callback(err);
                } else {
                    fs.remove(
                        archive_path,
                        function (err) {
                            if (err) {
                                callback(err);
                            } else {
                                app_info = this.apps_index[app_id];
                                delete this.apps_index[app_id];
                                var index = this.apps_list.indexOf(app_info);
                                if (index > -1) {
                                    this.apps_list.splice(index, 1);
                                } else {
                                    log.warn(
                                        "Inconsistency in the app index observed when removing app " +
                                            app_id
                                    );
                                }
                                callback(null, app_info);
                                this.notifyChange();
                            }
                        }.bind(this)
                    ); // remove app archive
                }
            }.bind(this)
        ); // remove installed app folder
    }
};

//
// Copies an app from the src directory to the dest directory.
//      src - The source app directory (This must be a raw app, it can't point to an archive)
//     dest - The destination direcotry (usually the approot)
//  options - `force` can be set to true to force the app to be copied/decompressed even if
//            the hosted app directory already exists.
// callback - Called with the app_info object for the app thus copied, or error if there was an error
AppManager.prototype.copyApp = function (src, dest, options, callback) {
    try {
        var name = path.basename(src);
        var app_info = {
            app_path: dest + "/" + name + "/",
            app_archive_path: src,
        };
        var exists = fs.existsSync(app_info.app_path);

        if (exists && !options.force) {
            log.debug(
                'Not copying app "' + src + '" because it already exists.'
            );
            this.readAppMetadata(
                app_info,
                function (err, app_metadata) {
                    if (err) {
                        return callback(err);
                    } else {
                        this._addApp(app_metadata);
                        callback(null, app_metadata);
                    }
                }.bind(this)
            );
            return;
        }

        log.debug('Copying app "' + src + '"');
        ncp(
            app_info.app_archive_path,
            app_info.app_path,
            function (err) {
                if (err) {
                    return callback(err);
                } else {
                    this.readAppMetadata(
                        app_info,
                        function (err, app_metadata) {
                            if (err) {
                                return callback(err);
                            }
                            this._addApp(app_metadata);
                            util.diskSync(function () {
                                callback(null, app_metadata);
                            });
                        }.bind(this)
                    );
                }
            }.bind(this)
        );
    } catch (e) {
        return callback(e);
    }
};

//
// Decompress an app from the src archive to the dest directory.
//      src - The source app archive (This must be an app archive, it can't point to a directory)
//     dest - The destination direcotry (usually the approot)
//  options - `force` can be set to true to force the app to be copied/decompressed even if
//            the hosted app directory already exists.
// callback - Called with the app_info object for the app thus copied, or error if there was an error
AppManager.prototype.decompressApp = function (src, dest, options, callback) {
    try {
        var name = path.basename(src);
        var app_info = {
            app_path: dest + "/" + name,
            app_archive_path: src,
        };
        var exists = fs.existsSync(app_info.app_path);
        if (exists && !options.force) {
            log.debug(
                'Not decompressing app "' + src + '" because it already exists.'
            );
            this.readAppMetadata(
                app_info,
                function (err, app_metadata) {
                    if (err) {
                        return callback(err);
                    } else {
                        this._addApp(app_metadata);
                        util.diskSync(function () {
                            callback(null, app_metadata);
                        });
                    }
                }.bind(this)
            );
            return;
        }

        log.debug('Decompressing app "' + app_info.app_path + '"');

        try {
            var app = new zip(src);
            app.extractAllTo(app_info.app_path, true);
        } catch (e) {
            return callback(e);
        }

        this.readAppMetadata(
            app_info,
            function (err, app_metadata) {
                if (err) {
                    return callback(err);
                }
                this._addApp(app_metadata);
                callback(null, app_metadata);
            }.bind(this)
        );
    } catch (e) {
        callback(e);
    }
};

// Install the app archive at the provided path by copying it from that path
// to the app archive directory, and load the app.
//   pathname - Path to the app archive to install
//       name - The filename to use for the installed app
//   callback - Called with the app_info object for the installed app, or error if error
AppManager.prototype.installAppArchive = function (pathname, name, callback) {
    // Keep the name of the file uploaded for a "friendly name"
    var friendly_filename = name || "app.fma";

    // But create a unique name for actual storage
    var filename = util.createUniqueFilename(friendly_filename);
    var full_path = path.join(config.getDataDir("apps"), filename);

    // Move the file to the apps directory
    util.move(
        pathname,
        full_path,
        function (err) {
            log.debug("Done with a move");
            if (err) {
                callback(
                    new Error(
                        "Failed to move the app from the temporary folder to the installation folder."
                    )
                );
            }
            // delete the temporary file (no longer needed)
            fs.unlink(pathname, function (err) {
                if (err) {
                    log.warn(
                        "failed to remove the app from temporary folder: " + err
                    );
                }
            }); // unlink

            // And create the app metadata in memory
            this.loadApp(full_path, {}, function (err, data) {
                if (err) {
                    return callback(err);
                }
                callback(err, data);
            }); // loadApp
        }.bind(this)
    ); // move
};

// Get a list of all app archives found in app archive locations
// TODO - Is this function still used?  It has profile cruft that I think is no longer in play
//   callback - Called with the list of paths, or error if error.
AppManager.prototype.getAppPaths = function (callback) {
    var app_pattern = this.app_directory + "/@(*.zip|*.fma)";
    var sys_pattern = this.system_app_directory + "/@(*.zip|*.fma)";

    // TODO - this is no longer needed
    var profile_pattern = config.getProfileDir("apps") + "/@(*.zip|*.fma)";

    glob(
        app_pattern,
        function (err, user_files) {
            glob(
                sys_pattern,
                function (err, system_files) {
                    glob(
                        profile_pattern,
                        function (err, profile_files) {
                            callback(
                                null,
                                system_files
                                    .concat(user_files)
                                    .concat(profile_files)
                            );
                        }.bind(this)
                    );
                }.bind(this)
            );
        }.bind(this)
    );
};

// Load all of the apps from all of the app archive locations
//   callback - Called with a list containing all app_info objects, or error if error.
AppManager.prototype.loadApps = function (callback) {
    this.getAppPaths(
        function (err, files) {
            async.mapSeries(
                files,
                function (file, callback) {
                    this.loadApp(
                        file,
                        {},
                        function (err, result) {
                            if (err) {
                                // Rather than allowing errors to halt the async.map operation that is loading the apps
                                // we swallow them and simply stick a 'null' in the output array (that we cull out at the end)
                                return callback(null, null);
                            } else {
                                return callback(null, result);
                            }
                        }.bind(this)
                    );
                }.bind(this),
                function (err, results) {
                    callback(err, results);
                }.bind(this)
            );
        }.bind(this)
    );
};

module.exports.AppManager = AppManager;
