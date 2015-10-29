var config = require('../config');
var restify = require('restify');
var dashboard = require('../dashboard');
var util = require('../util');
var fs = require('fs');

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

/**
 * @apiGroup Dashboard
 * @api {post} /app Install App
 * @apiDescription Install an app to the user's app installation directory.  App will be decompressed and installed immediately.
 */
var submitApp = function(req, res, next) {

    // Get the one and only one file you're currently allowed to upload at a time
    var file = req.files.file;
    var answer;

    log.debug("Submitting an app...");

    // Only write "allowed files"
    if(file && util.allowedAppFile(file.name))
    {
        log.debug(file);
        log.debug("This is an allowed file!");

        // Keep the name of the file uploaded for a "friendly name"
        var friendly_filename = file.name;

        // But create a unique name for actual storage
        var filename = util.createUniqueFilename(friendly_filename);
        var full_path = path.join(config.getDataDir('apps'), filename);

        log.debug(filename);
        log.debug(full_path);

        // Move the file
        util.move(file.path, full_path, function(err) {
            log.debug("Done with a move");
            if (err) {
                answer = {
                    status:"error",
                    message:"failed to move the app from temporary folder to app installation folder"
                }; 
                return res.json(answer);
                //throw err; 
            }
            log.debug("No error.");
            // delete the temporary file, so that the temporary upload dir does not get filled with unwanted files
            fs.unlink(file.path, function(err) {
                if (err) {
                    log.warn("failed to remove the app from temporary folder: " + err);
                }
            }); // unlink
            
            dashboard.loadApp(full_path, {}, function(err, data) {
                var answer;
                if(err) {
                    answer = {
                        status: "error",
                        data : {"app" : err}
                    };
                } else {
                    answer = {
                        status: "success",
                        data : {"app" : data}
                    };
                }
                res.json(answer);
            });

        }); // move
    } // if file and allowed
    else if (file){
        answer = {
            status:"fail",
            data : {"app" : "Wrong file format for app upload."}
        };
        res.json(answer);
    }
    else{
        answer = {
            status:"fail",
            data : {"job" : "Problem receiving the app : bad request."}
        };
        res.json(answer);
    }
}; // submitJob


module.exports = function(server) {
    server.post('/apps', submitApp);
    server.get('/apps', getApps);
    server.get('/apps/:id', getAppInfo);
    server.get('/apps/:id/config', getAppConfig);
    server.del('/apps/:id', deleteApp);
    server.get('/apps/:id/files', listAppFiles);
    server.get(/\/approot\/?.*/, restify.serveStatic({
        directory: config.getDataDir('approot'),
    }));
};
