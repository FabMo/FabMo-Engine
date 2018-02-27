var config = require('./config')
var async = require('async')
var fs = require('fs-extra')
var log = require('./log').logger('profiles')
var ncp = require('ncp').ncp

var PROFILE_DIRS = ['config','macros','apps']
var profiles = {}

var load = function(callback) {
	var profileDir = config.getDataDir('profiles')
	fs.readdir( profileDir, function( err, files ) {
        if(err) {
        	callback(err);
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

var apply = function(profile, callback) {
	async.each(PROFILE_DIRS, function(dir, callback) {
		fs.remove(config.getDataDir(dir), function(err) {
			callback();
		});
	},
	function allDone(err) {
		config.createDataDirectories(function(err, data) {
			console.log("Done applying profile")
			callback(err)
		});
	});
}

module.exports.load = load
module.exports.apply = apply
module.exports.getProfiles = function() {return profiles;}
