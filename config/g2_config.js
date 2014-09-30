util = require('util');

Config = require('./config').Config

// A G2Config is the configuration object that stores the configuration values for G2
G2Config = function(driver) {
	Config.call(this);
	this.driver = driver;
	this.default_config_file = './config/default/g2.json';
	this.config_file = './config/data/g2.json';
}
util.inherits(G2Config, Config);

// When a G2Config object is updated, it is synchronized with the physical driver
G2Config.prototype.update = function(data, callback) {
	keys = Object.keys(data);
	async.map(
		keys, 
		// Call driver.set() for each item in the collection of data that was pased in.
		function iterator(key, callback) {
			this.driver.set(key, data[key], callback);
		}.bind(this),
		// Update the cache with all the values returned from the hardware
		function done(err, results) {
			if(err) { callback(err); }
			var retval = {};
			for(var i=0; i<keys.length; i++) {
				key = keys[i];
				value = results[i];
				this._cache[key] = value;
				retval[key] = value;
			}
			callback(null, retval);
		}.bind(this)
	);
}

G2Config.prototype.configureStatusReports = function(callback) {
	this.driver.command({"sr":{
						"posx":true, 
						"posy":true, 
						"posz":true, 
						"posa":true, 
						"posb":true, 
						"vel":true, 
						"stat":true, 
						"hold":true, 
						"line":true, 
						"coor":true}});
	return callback(null, this);
}
exports.G2Config = G2Config;
