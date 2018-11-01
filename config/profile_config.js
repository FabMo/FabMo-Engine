/*
 * profile_config.js
 * 
 * This module provides the profile configuration.
 * Since profiles are not editable, this is pretty simple.
 */
var profiles = require('../profiles');



// The profile config object isn't a proper config object, it's just sort of a pass-through
// that returns the list of profiles defined for this tool.  They're not editable, so it doesn't
// need to be more than that.
var ProfileConfig = function() {};

// Return the current list of profiles
ProfileConfig.prototype.getData = function() {
	return profiles.getProfiles();
}

exports.ProfileConfig = ProfileConfig;
