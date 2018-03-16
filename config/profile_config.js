var config = require('../config');
var Config = require('./config').Config;
var log = require('../log').logger('profile_config');
var u = require('../util');
var profiles = require('../profiles');

// The EngineConfig object keeps track of engine-specific settings
var ProfileConfig = function() {};

ProfileConfig.prototype.getData = function() {
	return profiles.getProfiles();
}

exports.ProfileConfig = ProfileConfig;
