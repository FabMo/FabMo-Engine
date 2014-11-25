var config = require('../config');
var restify = require('restify');
var dashboard = require('../dashboard');

var get_apps = function(req, res, next) {
	res.json(dashboard.getAppList());
}

var get_app = function(req, res, next) {
	res.json(dashboard.getAppIndex()[req.params.id])
}
module.exports = function(server) {
	server.get('/apps', get_apps);
	server.get('/apps/:id', get_app);
	server.get(/\/approot\/?.*/, restify.serveStatic({
		directory: config.getDataDir('temp'),
	}));
}