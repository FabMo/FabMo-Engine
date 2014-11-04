var fs = require('fs')
var path = require('path');

// Load all the files in the 'routes' directory and process them as route-producing modules
exports.load = function() {
	var commandDir = __dirname;
	var files = fs.readdirSync(commandDir);
	var retval = {}
    files.forEach(function (file) {
        filePath = path.resolve('./', commandDir, file)
        if((path.extname(filePath) == '.js') && (path.basename(filePath) != 'index.js')) {
            commands = require(filePath);
            for(var attr in commands) {
            	retval[attr] = commands[attr];
            }
        }
	});
	return retval;
}
