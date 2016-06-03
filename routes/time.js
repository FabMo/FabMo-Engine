var redirect = require('./util').updaterRedirect;
var passport = require('../authentication').passport;

module.exports = function(server) {
	server.get(/(time)/,redirect);
	server.post(/(time)/,passport.authenticate('local'), redirect);
};
