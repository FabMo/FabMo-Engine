var fs = require("fs");
var path = require("path");
var log = require("../../../log").logger("opensbp");
require("../../../log").setGlobalLevel("info");

// Load all the files in the 'routes' directory and process them as route-producing modules
exports.load = function () {
    var commandDir = __dirname;
    var files = fs.readdirSync(commandDir);
    var retval = {};
    files.forEach(function (file) {
        var filePath = path.resolve("./", commandDir, file);
        if (path.extname(filePath) == ".js" && path.basename(filePath) != "index.js") {
            try {
                var commands = require(filePath);
                for (var attr in commands) {
                    retval[attr] = commands[attr];
                }
                log.debug('Loaded OpenSBP commands from "' + filePath + '"');
            } catch (e) {
                log.warn('Could not load OpenSBP Commands from "' + filePath + '": ' + e);
                log.error(e);
            }
        }
    });
    return retval;
};
