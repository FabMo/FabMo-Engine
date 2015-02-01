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
	res.json(dashboard.getAppList());
};

/**
 * @api {get} /apps/:id App info
 * @apiGroup Dashboard
 * @apiParam {String} id ID of requested app
 * @apiSuccess {Object[]} apps List of app objects
 * @apiSuccess {String} apps.name Human-readable app name
 * @apiSuccess {String} apps.app_url Root URL for the app
 * @apiSuccess {String} apps.app_path App path (Used internally by the engine)
 * @apiSuccess {String} apps.icon_path URL of app icon
 * @apiSuccess {String} apps.icon_background_color CSS color value of the app icon
 * @apiSuccess {String} apps.id Unique ID of this app (used in app URLs)
 */
var getApp = function(req, res, next) {
	log.info("Getting app");
	console.log(dashboard.getAppIndex());
	res.json(dashboard.getAppIndex()[req.params.id]);
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

	res.json(files);
};


module.exports = function(server) {
	server.get('/apps', getApps);
	server.get('/apps/:id', getApp);
	server.get('/apps/:id/files', listAppFiles);
	server.get(/\/approot\/?.*/, restify.serveStatic({
		directory: config.getDataDir('temp'),
	}));
};
