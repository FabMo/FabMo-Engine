var fs = require('fs')
var path = require('path');

// Load all the files in the 'routes' directory and process them as route-producing modules
module.exports = function(server) {
	var routeDir = 'routes'
	var files = fs.readdirSync(routeDir);
    files.forEach(function (file) {
        filePath = path.resolve('./', routeDir, file)
        if((path.extname(filePath) == '.js') && (path.basename(filePath) != 'index.js')) {
            routes = require(filePath);
		    routes(server);
        }
	});
}
