var fs = require('fs')
var path = require('path');

module.exports = function(server) {
	var RouteDir = 'routes'
	var files = fs.readdirSync(RouteDir);
	files.forEach(function (file) {
		var filePath = path.resolve('./', RouteDir, file)
		routes = require(filePath);
		routes(server);
	});
}
