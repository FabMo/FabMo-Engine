
var log = require('../log').logger('wifi');
var config =  require('../config');
var network = require('../network');
var redirect = require('./util').updaterRedirect;

module.exports = function(server) {
	server.get(/(network\/.*)/, redirect);
	server.post(/(network\/.*)/, redirect);
	server.del(/(network\/.*)/, redirect);
	server.put(/(network\/.*)/, redirect);
};
