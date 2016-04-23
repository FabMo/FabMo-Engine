var redirect = require('./util').updaterRedirect;

module.exports = function(server) {
	server.get(/(time)/,redirect);
	server.post(/(time)/, redirect);
};