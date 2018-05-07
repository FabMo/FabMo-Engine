var crypto = require('crypto');
var util = require('util');
var extend = require('../util').extend;
var fs = require('fs-extra');
Config = require('./config').Config;
var log = require('../log');
var log = require('../log').logger('config');
var profiles = require('../profiles');

var users;

UserConfig = function(driver) {
	Config.call(this, 'user');
};
util.inherits(UserConfig, Config);



UserConfig.prototype.setUpFile = function(callback){
    var user_file = config.getDataDir() + '/config/user.json';
	var pass_shasum = crypto.createHash('sha256').update("go2fabmo").digest('hex');
	var newUser = this.User("admin",pass_shasum,true);
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





UserConfig.prototype.User = function(username,password,isAdmin,created_at) {
	var obj = {};
	 obj[username] = {
		"password" : password,
		"isAdmin" : isAdmin || false,
		"created_at" : created_at || Date.now()
	}
	return obj;
	
};



UserConfig.prototype.validPassword= function(username, password){

	var pass_shasum = crypto.createHash('sha256').update(password).digest('hex');
	if(pass_shasum === this._cache[username].password){
		return true;
	}else if(password === this._cache[username].password){
		return true;
	}else{
		return false;
	}
};

// Delete this user from the database
UserConfig.prototype.delete = function(username, callback){
	delete this._cache[username];
	this.update(this._cache, function(err,data){
		if (err) {
			callback(err);
		} else {
			callback(null, 'deleted ' + username);
		}
	});
};

// verify user password and encrypt it.
UserConfig.prototype.verifyAndEncryptPassword = function(password,callback){
	if(!/^([a-zA-Z0-9@*#]{5,15})$/.test(password) ){ //validatepassword
		if(callback) callback('Password not valid, it should contain between 5 and 15 characters. The only special characters authorized are "@ * #".',null);
		return undefined;
	}
	var pass_shasum = crypto.createHash('sha256').update(password).digest('hex'); // save encrypted password
	if(callback)callback(null,pass_shasum);
	return pass_shasum;
};

// Grant user admin status
UserConfig.prototype.grantAdmin = function(username, callback){
	this.findOne(username, function(err, data){
		if(err)callback(err) 
		else {
			data.isAdmin = true;
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

// Revoke user admin status
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


UserConfig.prototype.add = function(username,password,callback){
	if(!/^([a-zA-Z0-9]{3,20})$/.test(username) ){ //validate username
		callback('Username not valid, it should contain between 3 and 20 characters. Special characters are not authorized.',null);
		return ;
	}
	this.verifyAndEncryptPassword(password,function(err,pass_shasum){
		if (err){callback(err,password);return ;}
			if(this._cache.hasOwnProperty(username)){
				console.log('User already exists!!!!')
				callback('Username already taken !',null);
				return ;
			}else{
					var newUser = this.User(username ,pass_shasum);
					this.update(newUser, function(err,data){
						if (err) {
							console.log(err);
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
	username in this._cache ? callback(null, this._cache[username]) : callback('No known user', null);
}

UserConfig.prototype.getAll = function(callback){
	callback(this._cache);
}

UserConfig.findById = function(id,callback){
	users.findOne({_id:id},function(err,doc){
		if(err){console.log(err);callback(err,null);return;}
		if(doc){
			user = new User(doc.username,doc.password,doc.isAdmin,doc.created_at,doc._id);
			callback(err,user);
			return;
		}else{
			callback("user doesn't exist!");
			return;
		}
	});
}

exports.UserConfig = UserConfig;
