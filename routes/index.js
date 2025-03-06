var fs = require("fs");
var path = require("path");
var log = require("../log").logger("routes");
var config = require("../config");
var getStaticServeFunction = require("../static");

// Load all the files in the 'routes' directory and process them as route-producing modules
module.exports = function (server) {
    var routeDir = __dirname;
    var files = fs.readdirSync(routeDir);
    files.forEach(function (file) {
        var filePath = path.resolve("./", routeDir, file);
        if (path.extname(filePath) == ".js" && path.basename(filePath) != "index.js") {
            try {
                var routes = require(filePath);
                if (typeof routes == "function") {
                    routes(server);
                    log.debug('  Loaded routes from "' + filePath + '"');
                } else {
                    log.debug("  (Skipping route load for " + filePath + ")");
                }
            } catch (e) {
                log.warn('Could not load routes from "' + filePath + '": ' + e);
            }
        }
    });

    // Define a route for serving static files
    // This has to be defined after all the other routes, or it plays havoc with things
    server.get(
        "*",
        function (req, res, next) {
            var current_hash = config.engine.get("version");
            var url_arr = req.url.split("/");
            // if the browser requested "/" then we need to add "app/home"
            if (url_arr[0] == "" && url_arr[1] == "") {
                url_arr.push("app");
                url_arr.push("home");
            }
            // if this was first access or an old url, then the first entry
            // will not match the current hash which is what makes sure that
            // we don't run into caching problems. Fix the hash by overwriting
            // or prepending the correct hash.
            if (url_arr[1] != current_hash) {
                url_arr.splice(1, 0, current_hash);
                var newPath = url_arr.join("/");
                res.redirect(newPath, next);
            } else {
                next();
            }
        },
        getStaticServeFunction({
            //directory: './static'
            directory: "./dashboard/build",
            default: "index.html",
        })
    );
};
