var fs = require('fs');
var path = require('path');
var log = require('../log').logger('routes');
var restify = require('restify');
var util = require('../util');
var passport = require('../authentication').passport;
var config = require('../config');
var static = require('../static');

// Load all the files in the 'routes' directory and process them as route-producing modules
module.exports = function(server) {
	var routeDir = __dirname;
	var files = fs.readdirSync(routeDir);
	files.forEach(function (file) {
		filePath = path.resolve('./', routeDir, file);
		if((path.extname(filePath) == '.js') && (path.basename(filePath) != 'index.js')) {
		try{
			routes = require(filePath);
			if(typeof(routes) == 'function') {
				routes(server);
				log.debug('  Loaded routes from "' + filePath + '"');				
			} else {
				log.debug('  (Skipping route load for ' + filePath + ')');
			}
		} catch(e) {
			log.warn('Could not load routes from "' + filePath + '": ' + e);
		}
	}
	});

	// var authentication_handler = function(req,res,next){
	// 	res.header('Cache-Control', 'no-cache, private, no-store, must-revalidate, max-stale=0, post-check=0, pre-check=0');
	// 	passport.authenticate('local', {
	//     failureRedirect: '',
	//   })(req,res,next);
	// }

// // protect only the / endpoint (dashboard)
// 	server.get(/^\/$/,authentication_handler, restify.serveStatic({
// 		directory: './dashboard/static',
// 		default: 'index.html'
// 	}));

	// Define a route for serving static files
	// This has to be defined after all the other routes, or it plays havoc with things

	server.get(/.*/, 
		function(req, res, next) {
			var current_hash = config.engine.get('version');
			 var url_arr = req.url.split('/');
			 if(url_arr[1] !== current_hash){
				url_arr.splice(1,0, current_hash);
				var newPath = url_arr.join('/');
				res.redirect(newPath , next);
			 } else {
				next();
			 }
		},
		static({
			//directory: './static'
			directory: './dashboard/build',
			default: 'index.html'
		})
	);





};
