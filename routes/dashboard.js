var config = require('../config');
var restify = require('restify');
var dashboard = require('../dashboard');

/**
 * @api {get} /apps List of apps
 * @apiGroup Dashboard
 * @apiSuccess {Object[]} apps List of app objects
 * @apiSuccess {String} apps.name Human-readable app name
 * @apiSuccess {String} apps.app_url Root URL for the app
 * @apiSuccess {String} apps.app_path App path (Used internally by the engine)
 * @apiSuccess {String} apps.icon_path URL of app icon
 * @apiSuccess {String} apps.icon_background_color CSS color value of the app icon
 * @apiSuccess {String} apps.id Unique ID of this app (used in app URLs)
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
 * @apiParam {String} id ID of requested app
 * @apiSuccess {Object} app List of app objects
 * @apiSuccess {String} app.name Human-readable app name
 * @apiSuccess {String} app.app_url Root URL for the app
 * @apiSuccess {String} app.app_path App path (Used internally by the engine)
 * @apiSuccess {String} app.icon_path URL of app icon
 * @apiSuccess {String} app.icon_background_color CSS color value of the app icon
 * @apiSuccess {String} app.id Unique ID of this app (used in app URLs)
 */
var getApp = function(req, res, next) {
	log.info("Getting app");
	console.log(dashboard.getAppIndex());
	var answer = {
		status:"success",
		data : {app : dashboard.getAppIndex()[req.params.id]}
	};
	res.json(answer);
};

/**
 * @api {get} /apps/:id/files Get app file listing
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


module.exports = function(server) {
	server.get('/apps', getApps);
	server.get('/apps/:id', getApp);
	server.get('/apps/:id/files', listAppFiles);
	server.get(/\/approot\/?.*/, restify.serveStatic({
		directory: config.getDataDir('temp'),
	}));
};
