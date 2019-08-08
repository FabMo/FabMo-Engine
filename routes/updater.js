var log = require('../log').logger('wifi');
var config =  require('../config');
var network = require('../network');

function redirect(req, res, next) {
    switch(req.method) {
        case 'GET':
            var host = req.headers.host.split(':')[0].trim('/');
            var path = req.params[0];
            var url = 'http://' + host + ':' + (config.engine.get('server_port') + 1) + '/' + path.replace(/^updater\//, '');
            res.redirect(302, url, next);   
            break;

        case 'POST':
            var host = req.headers.host.split(':')[0].trim('/');
            var path = req.params[0];
            var url = 'http://' + host + ':' + (config.engine.get('server_port') + 1) + '/' + path.replace(/^updater\//, '');
            var response = {'url' : url};
            res.json(300, response);
            break;
    }
}

module.exports = function(server) {
	server.get(/(updater\/.*)/, redirect);
	server.post(/(updater\/.*)/, redirect);
	server.del(/(updater\/.*)/, redirect);
	server.put(/(updater\/.*)/, redirect);
	server.get(/(network\/.*)/, redirect);
	server.post(/(network\/.*)/, redirect);
	server.del(/(network\/.*)/, redirect);
	server.put(/(network\/.*)/, redirect);
};
