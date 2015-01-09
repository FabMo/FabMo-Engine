var config = require('../config');
var restify = require('restify');
var dashboard = require('../dashboard');

var getApps = function(req, res, next) {
	log.info("Getting apps");
	res.json(dashboard.getAppList());
}

var getApp = function(req, res, next) {
	log.info("Getting app")
	console.log(dashboard.getAppIndex())
	res.json(dashboard.getAppIndex()[req.params.id])
}

var listAppFiles = function(req, res, next) {
	log.info("Listing files")
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
}

module.exports = function(server) {
	server.get('/apps', getApps);
	server.get('/apps/:id', getApp);
	server.get('/apps/:id/files', listAppFiles)
	server.get(/\/approot\/?.*/, restify.serveStatic({
		directory: config.getDataDir('temp'),
	}));
}