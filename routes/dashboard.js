var config = require('../config');
var restify = require('restify');
var dashboard = require('../dashboard');
var util = require('../util');
var fs = require('fs');
var upload = require('./upload').upload;


/**
 * @api {get} /apps List Apps
 * @apiGroup Dashboard
 * @apiDescription Get detailed information about all installed apps
 * @apiSuccess {String} status `success`
 * @apiSuccess {Object} data Response data
 * @apiSuccess {Object[]} data.apps List of app objects
 * @apiSuccess {String} data.apps.name Human-readable app name
 * @apiSuccess {String} data.apps.app_url Root URL for the app
 * @apiSuccess {String} data.apps.app_path App path (Used internally by the engine)
 * @apiSuccess {String} data.apps.icon_path URL of app icon
 * @apiSuccess {String} data.apps.icon_background_color CSS color value of the app icon
 * @apiSuccess {String} data.apps.id Unique ID of this app (used in app URLs)
 */
var getApps = function(req, res, next) {
	var answer = {
		status:"success",
		data : {apps : dashboard.getAppList()}
	};
	res.json(answer);
};

/**
 * @api {get} /apps/:id App info
 * @apiGroup Dashboard
 * @apiDescription Get detailed information about the specified app
 * @apiParam {String} id ID of requested app
 * @apiSuccess {String} status `success`
 * @apiSuccess {Object} data Response data
 * @apiSuccess {Object} data.app App object
 * @apiSuccess {String} data.app.name Human-readable app name
 * @apiSuccess {String} data.app.app_url Root URL for the app
 * @apiSuccess {String} data.app.app_path App path (Used internally by the engine)
 * @apiSuccess {String} data.app.icon_path URL of app icon
 * @apiSuccess {String} data.app.icon_background_color CSS color value of the app icon
 * @apiSuccess {String} data.app.id Unique ID of this app (used in app URLs)
 */
var getAppInfo = function(req, res, next) {
	log.info("Getting app " + req.params.id);
	var answer = {
		status:"success",
		data : {app : dashboard.getAppIndex()[req.params.id]}
	};
	res.json(answer);
};

/**
 * @api {get} /apps/:id/config App configuration
 * @apiGroup Dashboard
 * @apiDescription Get detailed information about the specified app
 * @apiParam {String} id ID of requested app
 * @apiSuccess {String} status `success`
 * @apiSuccess {Object} data Response data
 * @apiSuccess {Object} data.config App configuration data object
 */
var getAppConfig = function(req, res, next) {
    try {
        var answer = {
            status:"success",
            data : {config : dashboard.getAppConfig(req.params.id)}
        };
    } catch(e) {
        var answer = {
            status:"error",
            message : String(e)
        };
    }
    res.json(answer);
}

/**
 * @api {post} /apps/:id/config Update app configuration
 * @apiGroup Dashboard
 * @apiDescription Replace the specified app configuration with the POSTed object into the engine configuration.  Configuration updates take effect immediately.
 * @apiParam {Object} config Generic JSON formatted object to store as the apps configuration.
 */
var postAppConfig = function(req, res, next) {
    var new_config = {};
    var answer;
    dashboard.setAppConfig(req.params.id, req.params.config, function(err, result) {
        if(err) {
            var answer = {
                status:"error",
                message : String(e)
            };
        }
        else {
            var answer = {
                status:"success",
                data : {}
            };
        }
        res.json(answer);

    }.bind(this))
}


/**
 * @api {delete} /apps/:id Delete App
 * @apiDescription Delete the specified app
 * @apiGroup Dashboard
 */
var deleteApp = function(req, res, next) {
    log.info("Deleting app " + req.params.id);
    dashboard.deleteApp(req.params.id, function(err, result) {
        var answer;
        if(err) {
            answer = {
                status:"error",
                message : err
            };
        } else {
            answer = {
                status:"success",
                data : {app : result}
            };
        }
        res.json(answer);
    });
};

/**
 * @api {get} /apps/:id/files List App Files
 * @apiGroup Dashboard
 * @apiParam {String} id ID of requested app
 * @apiSuccess {Object} root Root of directory tree
 */
var listAppFiles = function(req, res, next) {
	log.info("Listing files");
	id = req.params.id;

	files = dashboard.getAppFiles(id);
	// Add URL attributes to all of the leaves of the file tree
	function add_urls(node) {
		if(node.type === 'file') {
			node.url = '/approot' + node.path;
		}
		if(node.children) {
			node.children.forEach(function(node) {
				add_urls(node);
			});
		}
	}

	add_urls(files);

		var answer = {
		status:"success",
		data : {files : files}
	};
	res.json(answer);
};

var submitApp = function(req, res, next) {

    upload(req, res, next, function(err, uploads) {

        // Multiple apps can be submitted at once.  Process each of them in turn.
        async.map(uploads.files, function(upload_data, callback) {
            var file = upload_data.file;
            if(file && util.allowedAppFile(file.name)) {
                // Keep the name of the file uploaded for a "friendly name"
                var friendly_filename = file.name || upload_data.filename || 'app.fma';

                // But create a unique name for actual storage
                var filename = util.createUniqueFilename(friendly_filename);
                var full_path = path.join(config.getDataDir('apps'), filename);

                // Move the file to the apps directory
                util.move(file.path, full_path, function(err) {
                    log.debug("Done with a move");
                    if (err) {
                        callback(new Error('Failed to move the app from the temporary folder to the installation folder.'));
                    }
                    // delete the temporary file (no longer needed)
                    fs.unlink(file.path, function(err) {
                        if (err) {
                            log.warn("failed to remove the app from temporary folder: " + err);
                        }
                    }); // unlink

                    // And create the app metadata in memory
                    dashboard.loadApp(full_path, {}, function(err, data) {
                        callback(err, data);
                    }); // loadApp
                }); // move
            } else if(file) {
                callback(new Error('Cannot accept ' + file.name + ': Incorrect file format.'));
            } else {
                callback(new Error('Bad request.'));
            }
        }, 
        function all_finished(err, apps) {
            if(err) {
                return res.json({
                    status: "error",
                    message : err.message
                });
            }
            return res.json({
                status: "success",
                data : {
                    status : "complete", 
                    data : {"apps" : apps}
                }
            });
        }); // async.map
    }); // upload
}; // submitApp

module.exports = function(server) {
    server.post('/apps', submitApp);
    server.get('/apps', getApps);
    server.get('/apps/:id', getAppInfo);
    server.get('/apps/:id/config', getAppConfig);
    server.post('/apps/:id/config', postAppConfig);
    server.del('/apps/:id', deleteApp);
    server.get('/apps/:id/files', listAppFiles);
    server.get(/\/approot\/?.*/, restify.serveStatic({
        directory: config.getDataDir('approot'),
    }));
};
