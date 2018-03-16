var config = require('./config')
var async = require('async')
var fs = require('fs-extra')
var log = require('./log').logger('profiles')
var ncp = require('ncp').ncp

var PROFILE_DIRS = ['config','macros','apps']
var profiles = {}

var load = function(callback) {
	log.debug('Loading profiles...')
	var profileDir = config.getDataDir('profiles')
	fs.readdir( profileDir, function( err, files ) {
        if(err) {
        	return callback(err);
        }
        async.each(files, function(file, callback) {
        	var profilePath = path.join(profileDir, file);
        	fs.stat(profilePath,function(err,stats){
				if(err) callback();
				if(stats.isDirectory()) {
					readProfileInfo(profilePath, function(err, profile) {
						if(err) {
							log.error(err);
						} else {
							log.debug('Read profile ' + profile.name);
							profiles[profile.name] = profile;
						}
						callback(null);
					});
				}
			});
        }, 
        function allDone() {
        	callback(null, profiles);
        });
    });
}

var readProfileInfo = function(profileDir, callback) {
	fs.readFile(path.join(profileDir, 'package.json'), 'utf8', function (err, data) {
    	if (err) return callback(new Error('Could not read profile package.json: ' + err))
    	try {
    		var obj = JSON.parse(data);    		
    	} catch(e) {
    		return callback(new Error('Profile ' + profileDir + ' does not have a valid package.json'));
    	}
    	if(!obj['name']) throw new Error('Profile package.json does not have a name');
		callback(null, {
			name : obj['name'],
			description : obj['description'] || '',
			dir : profileDir
		});	
	});
}

var apply = function(profileName, callback) {
	// Make sure this is a profile that actually occurs in the list
	if(profileName in profiles) {
		log.debug('Switching profiles to ' + profileName)
		// Get the profile data
		profile = profiles[profileName];
		async.each(PROFILE_DIRS, function(dir, callback) {
			var configDir = config.getDataDir(dir)
			var profileConfigDir = path.join(profile.dir, dir)
			log.debug('Removing config directory ' + configDir);
			fs.remove(configDir, function(err) {
				if(err) {
					return callback(err);
				}
	
				// And replace with the configuration provided by the profile
				log.debug('Copying profile configuration directory ' + profileConfigDir);
				ncp(profileConfigDir, config.getDataDir(dir), function (err) {
					if (err) {
						return callback(err);
					} else {
						log.debug('...done copying.')
						callback();
					}
				});
			});
		},
		function allDone(err) {
			config.clearAppRoot(function(err) {
				appsDir = config.getDataDir('apps')
				console.log('Shuffling up filenames in ' + appsDir)
				fs.readdir(appsDir, function(err, files) {
					console.log(files);
					files.forEach(function(file) {
						fs.renameSync(path.join(appsDir, file), path.join(appsDir, util.createUniqueFilename(file)));
					})
					callback(err);
				});
			});
		});		
	} else {
		callback(new Error(profiles + ' is not a valid profile.'))
	}
}

module.exports.load = load
module.exports.apply = apply
module.exports.getProfiles = function() {return profiles;}
