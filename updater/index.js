var util = require('../util');
var config = require('../config');
var log = require('../log').logger('updater');
var glob = require('glob')
var process = require('process');

var getFabmoVersionString = function(callback) {
	util.doshell('git rev-parse --verify HEAD', function(data) {
		if(data) {data = data.trim();}
		callback(null, data);
	});
}

var updateEngine = function(callback) {
	log.info('Updating the Fabmo Engine...');
	log.debug('Stopping the engine...');
	var engine = require('../engine');
	engine.stop(function(err) {
		// Platform specific script for updating
		var pattern = './updater/scripts/' + config.platform + '.*';
		glob(pattern, function(err, files) {
			if(files.length > 0) {
				script = files[0];
				log.debug('Updater script found: ' + script);
				util.doshell(script, function(stdout) {
					console.log(stdout);
					log.debug('Update complete');
					process.exit(0);
				});
			} else {
				callback(new Error("There is no auto-update capability for the '" + config.platform + "' platform."));
			}
		}.bind(this));
	});
}

exports.getFabmoVersionString = getFabmoVersionString;
exports.updateEngine = updateEngine;