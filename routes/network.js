
var log = require('../log').logger('wifi');
var config =  require('../config');
var network = require('../network');

function getRedirect(req, res, next) {
	var host = req.headers.host.split(':')[0].trim('/');
	var path = req.params[0];
	var url = 'http://' + host + ':' + (config.engine.get('server_port') + 1) + '/' + path;
	res.redirect(302, url, next);	
}

function postRedirect(req, res, next) {
	var host = req.headers.host.split(':')[0].trim('/');
	var path = req.params[0];
	var url = 'http://' + host + ':' + (config.engine.get('server_port') + 1) + '/' + path;
	var response = {'url' : url};
	res.json(300, response);
}

module.exports = function(server) {
	server.get(/(network\/.*)/, getRedirect);
	server.post(/(network\/.*)/, postRedirect);
	server.del(/(network\/.*)/, getRedirect);
	server.put(/(network\/.*)/, getRedirect);
};
