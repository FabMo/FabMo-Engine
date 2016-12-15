var zip = require('adm-zip');
var path = require('path');
var os = require('os');
var ncp = require('ncp').ncp;
var fs = require('fs-extra');
var async = require('async');
var uuid = require('node-uuid');
var log = require('../log').logger('app_manager');
var util = require('../util');
var glob = require('glob');
var config = require('../config');

// Maximum depth of a deep copy operation
ncp.limit = 16;
var AppManager = function(options) {
	this.app_directory = options.app_directory;
	this.approot_directory = options.approot_directory;
	this.system_app_directory = path.join(__dirname, 'apps');
	this.apps_index = {};
	this.app_configs = {};
	this.apps_list = [];
	try {
		this.machine = require('../machine').machine;
	} catch(e) {
		log.warn('No machine bound to AppManager');
		this.machine = null;
	}
};

AppManager.prototype.notifyChange = function() {
	if(this.machine) {
		this.machine.emit('change', 'apps');
	}
}

AppManager.prototype.readAppPackageInfo = function(app_info, callback) {
	var pkg_info_path = path.join(app_info.app_path, 'package.json');
	
	var pathname = path.basename(app_info.app_archive_path);
	var id = pathname.match(/^([^.]*)/g)[0];
	fs.readFile(pkg_info_path, function(err, data) {
		if(err) {
			return callback(new Error("Could not read package.json"));
		}

		try {
			var package_info = JSON.parse(data);
		} catch(e) {
			return callback(new Error("Could not parse package.json"))
		}

		try {
			app_info.name = package_info.name;
			app_info.config_path = path.join(app_info.app_path, '.config.json');
			app_info.icon_path = app_info.app_path + package_info.icon;
			app_info.icon_background_color = package_info.icon_color || 'blue';
			app_info.icon_display = package_info.icon_display;
			app_info.app_url = path.join('approot', pathname, package_info.main);
			app_info.icon_url = path.join('approot', pathname, package_info.icon);
			app_info.id = package_info.id || id;
			app_info.version = package_info.version || '';
			app_info.description = package_info.description || "No description";
			callback(null, app_info);
		} catch(e) {
			callback(e);
		}
	}.bind(this));
};

AppManager.prototype.readAppConfiguration = function(app_info, callback) {
	fs.readFile(app_info.config_path, function(err, data) {
		try {
			var cfg_data = JSON.parse(data);
			callback(null, cfg_data);
		} catch(e) {
			callback(e);
		}
	}.bind(this))
}

AppManager.prototype.readAppMetadata = function(app_info, callback) {
	this.readAppPackageInfo(app_info, function(err, info) {
		if(err) {
			callback(err);
		} else {
			this.readAppConfiguration(info, function(err, cfg) {
				if(err) {
					//log.warn('Could not read app configuration: ' + err);
				}
				cfg = cfg || {};
				callback(null, {'info' : info, 'config' : cfg});
			}.bind(this))
		}
	}.bind(this))
}

AppManager.prototype.getAppRoot = function(id) {
	return this.apps_index[id].app_path;
};

AppManager.prototype.getAppIndex = function() {
	return this.apps_index;
};

AppManager.prototype.getAppList = function() {
	return this.apps_list;
};

AppManager.prototype.getAppConfig = function(id) {
	return this.app_configs[id];
}

AppManager.prototype.setAppConfig = function(id, config, callback) {
	this.app_configs[id] = config || {};
	fs.writeFile(this.apps_index[id].config_path, JSON.stringify(config), callback);
}

AppManager.prototype.rebuildAppList = function() {
	this.apps_list = [];
	for(var key in this.apps_index) {
		this.apps_list.push(this.apps_index[key]);
	}
}
AppManager.prototype._addApp = function(app) {
	if(app.info.id in this.apps_index) {
		var old_app = this.apps_index[app.info.id]
	    fs.unlink(old_app.app_archive_path, function(err) {
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

AppManager.prototype.reloadApp = function(id, callback) {
	app_info = this.apps_index[id];
	if(app_info) {
		this.loadApp(app_info.app_archive_path, {force:true}, callback);
	} else {
		callback(new Error("Not a valid app id: " + id));
	}
}

/**
 * Load an app and issue a callback when loaded.
 * In the case of a compressed app, this decompresses the app into the approot directory.
 * In the case of a raw app, this copies the app to the approot directory.
 */
AppManager.prototype.loadApp = function(pathname, options, callback){
	// Check to see if the path exists
	fs.stat(pathname,function(err,stat){
		if(err) {
			// Error if we couldn't stat
			return callback(err);
		}
		if(stat.isDirectory()) {
			// Copy if it's a directory
			return this.copyApp(pathname, this.approot_directory, options, callback);
		}

		var ext = path.extname(pathname).toLowerCase();
		if(ext === '.fma' || ext === '.zip') {
			// Decompress if it's a compressed app file
			return this.decompressApp(pathname, this.approot_directory, options, callback);
		} else {
			// Error if it's a file, but the wrong kind
			return callback(new Error(pathname + ' is not an app.'));
		}
	}.bind(this));
};

AppManager.prototype.deleteApp = function(id, callback) {
	app = this.apps_index[id];
	var app_id = id;
	if(app) {
		var app_path = app.app_path;
		var archive_path = app.app_archive_path;
		fs.remove(app_path, function(err) {
			if(err) {
				callback(err);
			} else {
				fs.remove(archive_path, function(err) {
					if(err) {
						callback(err);
					} else {
						app_info = this.apps_index[app_id];
						delete this.apps_index[app_id];
						var index = this.apps_list.indexOf(app_info);
						if (index > -1) {
							this.apps_list.splice(index, 1);
						} else {
							log.warn("Inconsistency in the app index observed when removing app " + app_id);
						}
						callback(null, app_info);
						this.notifyChange();
					}
				}.bind(this)); // remove app archive
			}
		}.bind(this)); // remove installed app folder
	}
};

/**
 * Copies an app from the src directory to the dest approot directory.
 * Callback with app info.
 */
AppManager.prototype.copyApp = function(src, dest, options, callback) {
	try {
		var name = path.basename(src);
		var app_info = {
			app_path : dest + "/" + name + "/",
			app_archive_path : src
		};
		var exists = fs.existsSync(app_info.app_path);

		if(exists && !options.force) {
			log.debug('Not copying app "' + src + '" because it already exists.');
			this.readAppMetadata(app_info, function(err, app_metadata) {
				if(err) {
					return callback(err);
				} else {
					this._addApp(app_metadata);
					callback(null, app_metadata);
				}
			}.bind(this));
			return;
		}

		log.debug('Copying app "' + src + '"');
		ncp(app_info.app_archive_path, app_info.app_path, function (err) {
			if (err) {
				return callback(err);
			} else {
				this.readAppMetadata(app_info, function(err, app_metadata) {
					if(err) {
						return callback(err);
					}
					this._addApp(app_metadata);
					callback(null, app_metadata);
				}.bind(this));
			}
		}.bind(this));
	} catch(e) {
		return callback(e);
	}
};


/**
 * Decompress the app and return app info (via callback)
 */
AppManager.prototype.decompressApp = function(src, dest, options, callback) {
	try {
		var name = path.basename(src);
		var app_info = {
			app_path : dest + "/" + name,
			app_archive_path : src
		};
		var exists = fs.existsSync(app_info.app_path);
		if(exists && !options.force) {
			log.debug('Not decompressing app "' + src + '" because it already exists.');
			this.readAppMetadata(app_info, function(err, app_metadata) {
				if(err) {
					return callback(err);
				} else {
					this._addApp(app_metadata);
					callback(null, app_metadata);
				}
			}.bind(this));
			return;
		}

		log.debug('Decompressing app "' + app_info.app_path + '"');

		try {
			var app = new zip(src);
			app.extractAllTo(app_info.app_path, true);
		} catch(e) {
			return callback(e);
		}

		this.readAppMetadata(app_info, function(err, app_metadata) {
			if(err) {
				return callback(err);
			}
			this._addApp(app_metadata);
			callback(null, app_metadata);
		}.bind(this));
	}
	catch(e){
		callback(e);
	}
};

AppManager.prototype.installAppArchive = function(pathname, name, callback) {
    // Keep the name of the file uploaded for a "friendly name"
    var friendly_filename = name || 'app.fma';

    // But create a unique name for actual storage
    var filename = util.createUniqueFilename(friendly_filename);
    var full_path = path.join(config.getDataDir('apps'), filename);

	// Move the file to the apps directory
	util.move(pathname, full_path, function(err) {
	    log.debug("Done with a move");
	    if (err) {
	        callback(new Error('Failed to move the app from the temporary folder to the installation folder.'));
	    }
	    // delete the temporary file (no longer needed)
	    fs.unlink(pathname, function(err) {
	        if (err) {
	            log.warn("failed to remove the app from temporary folder: " + err);
	        }
	    }); // unlink

	    // And create the app metadata in memory
	    this.loadApp(full_path, {}, function(err, data) {
	    	if(err) {
	    		return callback(err);
	    	}
	        callback(err, data);
	    }); // loadApp
	}.bind(this)); // move
}

AppManager.prototype.getAppPaths = function(callback) {
	var app_pattern = this.app_directory + '/@(*.zip|*.fma)'
	var sys_pattern = this.system_app_directory + '/@(*.zip|*.fma)'
	glob(app_pattern, function(err, user_files) {
		glob(sys_pattern, function(err, system_files) {
			callback(null, system_files.concat(user_files));
		}.bind(this));
	}.bind(this));
};

/**
 * Load all of the apps in the provided apps directory
 */
AppManager.prototype.loadApps =  function(callback) {
	this.getAppPaths(function(err,files){
		async.mapSeries(files,
			function(file, callback) {
				this.loadApp(file, {}, function(err, result) {
					if(err) {
						// Rather than allowing errors to halt the async.map operation that is loading the apps
						// we swallow them and simply stick a 'null' in the output array (that we cull out at the end)
						return callback(null, null);
					} else {
						return callback(null, result);
					}
				}.bind(this));
			}.bind(this),
			function(err, results) {
				callback(err, results);
			}.bind(this));
	}.bind(this));
};

module.exports.AppManager = AppManager;
