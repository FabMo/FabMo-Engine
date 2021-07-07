/*
 * user_config.js
 *
 * This module defines the configuration system for managing user accounts.
 *
 * FabMo is a single user system - only one distinct account can be logged in at once, 
 * but the same user account can log in from multiple locations.  The reasoning behind this
 * decision is that while it doesn't really make sense for multiple users to be using a tool at once,
 * it is typical for one user to be logged in from two different places at once, for example
 * their computer and their phone.
 *
 * User data, like other configuration data, is stored in a JSON file in the configuration directory.
 * The objects and methods in this folder are for managing that configuration in a way that obeys
 * FabMo's internal policy for user management.  Passwords are all hashed for storage.
 */
var crypto = require('crypto');
var util = require('util');
var extend = require('../util').extend;
var fs = require('fs-extra');
var Config = require('./config').Config;
var log = require('../log');
var log = require('../log').logger('config');
var profiles = require('../profiles');

// This is the canonical account for the 'admin' user
var DEFAULT_ADMIN_PASSWORD = 'go2fabmo';
var DEFAULT_ADMIN_USER = 'admin';

UserConfig = function(driver) {
	Config.call(this, 'user');
};
util.inherits(UserConfig, Config);

// Create a user configuration file if one does not already exist.
//   callback - Called with an error if the file couldn't be created
UserConfig.prototype.setUpFile = function(callback){
    var user_file = config.getDataDir() + '/config/user.json';
	var pass_shasum = crypto.createHash('sha256').update(DEFAULT_ADMIN_PASSWORD).digest('hex');
	var newUser = this.User(DEFAULT_ADMIN_USER,pass_shasum,true);
	var data = JSON.stringify(newUser);
    fs.writeFile(user_file, data, function(err){
        if(err){
            callback(err);
        } else {
			log.info('User File Created...');	
				callback(null);
			}
    });
    
};

// Typical update function (see config.js)
UserConfig.prototype.update = function(data, callback, force) {
		try {
			extend(this._cache, data, force);
		} catch (e) {
			return callback(e);
		}
			this.save(function(err, result) {
			if(err) {
				callback(err);
			} else {
				callback(null, result);
			}
		});
};


UserConfig.prototype.initUsers = function(data, callback) {
	this._loaded = true;
	this.update(data, function(err, data){
		if(err){
			callback(err);
		} else {
			callback(data);
		}
	}.bind(this));
}

// Create a user with the provided properties
// TODO may want to rename this method "createUser" or something.  The noun-like name
//      and capitalization makes it seem like this is a constructor (which it kind of is, but isn't)
//      isAdmin - boolean, true for user is an admin user
//   created_at - Datetime for creation.  (Default = Date.now())
UserConfig.prototype.User = function(username,password,isAdmin,created_at) {
	var obj = {};
	 obj[username] = {
		"password" : password,
		"isAdmin" : isAdmin || false,
		"created_at" : created_at || Date.now()
	}
	return obj;
};

// Check the provided password and return true if it is correct for this user
//   username - The username of the user whose password is being checked
//   password - The password to check
UserConfig.prototype.validPassword= function(username, password) {
	var pass_shasum = crypto.createHash('sha256').update(password).digest('hex');
	if(pass_shasum === this._cache[username].password){
		return true;
	}else if(password === this._cache[username].password){
		// TODO is this really ok to do?
		return true;
	}else{
		return false;
	}
};

// Delete the provided user from the configuration
//   username - The user to delete
//   callback - Called with an error if there's an error.
UserConfig.prototype.delete = function(username, callback) {
	delete this._cache[username];
	this.update(this._cache, function(err,data){
		if (err) {
			callback(err);
		} else {
			callback(null, 'deleted ' + username);  // TODO : Do we need the "success message" here?
		}
	});
};

// verify user password and encrypt it.
// Passwords must be between 5-15 characters and be composed only of letters numbers and a few allowable symbols.
//   password - The password tp check
//   callback - Called with the hashed pasword 
UserConfig.prototype.verifyAndEncryptPassword = function(password,callback) {
	if(!/^([a-zA-Z0-9@*#]{5,15})$/.test(password) ){ //validatepassword
		if(callback) callback('Password not valid, it should contain between 5 and 15 characters. The only special characters authorized are "@ * #".',null);
		return undefined;
	}
	var pass_shasum = crypto.createHash('sha256').update(password).digest('hex'); // save encrypted password
	if(callback)callback(null,pass_shasum);
	return pass_shasum;
};

// Grant user admin status
//   username - The user to elevate
//   callback - Called with an error if user doesn't exist or couldn't elevate
UserConfig.prototype.grantAdmin = function(username, callback){
	this.findOne(username, function(err, data){
		if(err)callback(err) 
		else {
			data.isAdmin = true;
			this.update(data, function(err, data){
				if (err){
					callback(err);
				} else {
					callback(null);
				}
			})
		}
	});
};

// Revoke user admin status
//   username - The user to demote
//   callback - Called with an error if user doesn't exist or couldn't demote
UserConfig.prototype.revokeAdmin = function(username, callback){
	this.findOne(username, function(err, data){
		if(err)callback(err) 
		else {
			data.isAdmin = false;
			this.update(data, function(err, data){
				if (err){
					callback(err);
				} else {
					callback('Admin granted');
				}
			})
		}
	});
};

// Add the specified user
//   username - The name of the user to add
//   password - The password for the new user
//   callback - Called with the new user object, or error if there was an error
UserConfig.prototype.add = function(username,password,callback){
	if(!/^([a-zA-Z0-9]{3,20})$/.test(username) ){ //validate username
		callback('Username not valid, it should contain between 3 and 20 characters. Special characters are not authorized.',null);
		return ;
	}
	this.verifyAndEncryptPassword(password,function(err,pass_shasum){
		if (err){callback(err,password);return ;}
			if(this._cache.hasOwnProperty(username)){
				log.info('User already exists!!!!')
				callback('Username already taken !',null);
				return ;
			}else{
				var newUser = this.User(username ,pass_shasum);
				this.update(newUser, function(err,data){
					if (err) {
						log.error(err);
					} else {
						callback(null, newUser);
					}
				}, true);
				return ;
			}
	}.bind(this))
}

//Maybe move this to the routes or whatever 
UserConfig.prototype.findOne = function(username,callback){
	username in this._cache ? callback(null, this._cache[username]) : callback(new Error('The username ' + username + ' is invalid.'), null);
}

// Get a map of all user ids to values
// TODO: No need for a callback here - maybe just use a return statement?
UserConfig.prototype.getAll = function(callback){
	callback(this._cache);
}

exports.UserConfig = UserConfig;
