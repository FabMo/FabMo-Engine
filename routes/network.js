
var log = require('../log').logger('wifi');
var config =  require('../config');
var network = require('../network');

function networkRedirect(req, res, next) {
	var host = req.headers.host.split(':')[0].trim('/');
	var path = req.params[0];
	var url = 'http://' + host + ':' + 9877 + '/' + path;
	res.redirect(307, url, next);	
}

module.exports = function(server) {
	server.get(/(network\/.*)/, networkRedirect);
	server.post(/(network\/.*)/, networkRedirect);
	server.del(/(network\/.*)/, networkRedirect);
	server.put(/(network\/.*)/, networkRedirect);
};
