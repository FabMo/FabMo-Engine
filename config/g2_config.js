async = require('async');
util = require('util');
Config = require('./config').Config;

// A G2Config is the configuration object that stores the configuration values for G2.
// G2 configuration data is *already* JSON formatted, so G2Config objects are easy to create from config files using `load()`
// A G2Config object is bound to a driver, which gets updated when configuration values are loaded/changed.
G2Config = function(driver) {
	Config.call(this, 'g2');
	this.driver = driver;
};
util.inherits(G2Config, Config);

// Update the configuration with the data provided (data is just an object with configuration keys/values)
G2Config.prototype.update = function(data, callback) {
	keys = Object.keys(data);
	// TODO: We can probably replace this with a `setMany()`
	async.mapSeries(
		keys, 
		// Call driver.set() for each item in the collection of data that was passed in.
		function iterator(key, cb) {
			if(this.driver) {
				this.driver.set(key, data[key], cb);
			} else {
				cb(null);
			}
		}.bind(this),
		// Update the cache with all the values returned from the hardware
		function done(err, results) {
			if(err) { return callback(err); }
			var retval = {};
			for(var i=0; i<keys.length; i++) {
				key = keys[i];
				value = results[i];
				this._cache[key] = value;
				retval[key] = value;
			}

			this.save(function(err, result) {
				if(err) {
					callback(err);
				} else {
					callback(null, retval);
				}
			}.bind(this));
		}.bind(this)
	);
};

// setMany aliases to update, to provide similar interface as G2 driver
G2Config.prototype.setMany = G2Config.prototype.update;

// Status reports are special, and their format must be whats expected for the machine/runtime environments
// to work properly.  
// TODO: Move this data out into a configuration file, perhaps.
G2Config.prototype.configureStatusReports = function(callback) {
	if(this.driver) {
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
						"coor":true,
						"unit":true,
						"in1":true,
						"in2":true,
						"in3":true,
						"in4":true,
						"in5":true,
						"in6":true,
						"in7":true,
						"in8":true
					}});
	this.driver.command({"qv":0});
	this.driver.command({"jv":4});
}
	return callback(null, this);
};
exports.G2Config = G2Config;
