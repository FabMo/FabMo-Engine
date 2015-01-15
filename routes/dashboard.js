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
var get_apps = function(req, res, next) {
	res.json(dashboard.getAppList());
}

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
var get_app = function(req, res, next) {
	log.info("Getting app")
	res.json(dashboard.getAppIndex()[req.params.id])
}

/**
 * @api {get} /apps/:id/files Get app file listing
 * @apiGroup Dashboard
 * @apiParam {String} id ID of requested app
 * @apiSuccess {Object} root Root of directory tree
 */
var listAppFiles = function(req, res, next) {
	log.info("Getting files")
	res.json(dashboard.getAppFiles(req.params.id));
}


module.exports = function(server) {
	server.get('/apps', get_apps);
	server.get('/apps/:id/files', listAppFiles)
	server.get('/apps/:id', get_app);
	server.get(/\/approot\/?.*/, restify.serveStatic({
		directory: config.getDataDir('temp'),
	}));
}