
var log = require('../log').logger('wifi');
var config =  require('../config');
var network = require('../network');
var redirect = require('./util').updaterRedirect;
var passport = require('../authentication').passport;

module.exports = function(server) {
	server.get(/(network\/.*)/, redirect);
	server.post(/(network\/.*)/,passport.authenticate('local'), redirect);
	server.del(/(network\/.*)/,passport.authenticate('local'), redirect);
	server.put(/(network\/.*)/,passport.authenticate('local'), redirect);
};
