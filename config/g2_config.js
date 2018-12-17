/*
 * g2_config.js
 *
 * This module defines the configuration object that manages the settings in G2.
 */
async = require('async');
util = require('util');
Config = require('./config').Config;

var log = require('../log').logger('g2config');

// A G2Config is the configuration object that stores the configuration values for G2.
// G2 configuration data is *already* JSON formatted, so G2Config objects are easy to create from config files using `load()`
// A G2Config object is bound to a driver, which gets updated when configuration values are loaded/changed.
G2Config = function(driver) {
	Config.call(this, 'g2');
};
util.inherits(G2Config, Config);

G2Config.prototype.init = function(driver, callback) {
	this.driver = driver;
	Config.prototype.init.call(this, callback);
}

// Change the current unit system to the provided value.
//  newUnits - The new unit system (0=mm, 1=in)
// Note that the units are set by setting the 'unit' parameter, which is unique to the FabMo variant of G2
G2Config.prototype.changeUnits = function(newUnits, callback) {
	this.driver.get('unit', function(err, currentUnits){
		if(err){
			callback(err);
		} else {
			if(parseInt(newUnits) === parseInt(currentUnits)){
				callback('no unit change needed');
			} else {
				this.driver.setUnits(newUnits, function(err, data) {
					if(err) {
						callback(err);
					} else {
						this.getFromDriver(function(err, g2_values) {
							if(err) {
								callback(err);
							} else  {
								this.setMany(g2_values, callback);
							}
						}.bind(this));
					}
				}.bind(this));
			}
		}
	}.bind(this));


}

// Retrieve all of the configuration parameters from G2.
// Keys to retrieve are taken from the cache
//   callback - Called with an object containing all values retrieved
G2Config.prototype.getFromDriver = function(callback) {
	var keys = Object.keys(this._cache)
	this.driver.get(Object.keys(this._cache), function(err, values) {
		if(err) {
			callback(err);
		} else {
			if(keys.length != values.length) {
				callback(new Error("Something went wrong when getting values from G2"))
			} else {
				var obj = {}
				for(var i=0; i<keys.length; i++) {
					obj[keys[i]] = values[i];
				}
				callback(null, obj);
			}
		}

	});
}

// Get values from G2, set in the cache and on disk.
//       keys - List of keys to retrieve
//   callback - Called with updated data, or error
G2Config.prototype.reverseUpdate = function(keys, callback) {
	this.driver.get(keys, function(err, data) {
		if (err) {
			callback(err)
		} else {
			keys.forEach(function(key,i) {
				this._cache[key] = data[i];
			}.bind(this))
			this.save(callback);
		}
	}.bind(this));
}

// Update the configuration with the data provided.  Values set are synced with G2
//       data - Object mapping keys to update to values
//   callback - Called with an object mapping keys to all values updated (after sync with G2)
G2Config.prototype.update = function(data, callback) {
	keys = Object.keys(data);
	// TODO: We can probably replace this with a `setMany()`
	async.mapSeries(
		keys,
		// Call driver.set() for each item in the collection of data that was passed in.
		function iterator(key, cb) {
			if(this.driver) {
				this.driver.set(key, data[key], function(err, data) {
					cb(null, data);
				});
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

// Write all cached values to G2
//   callback - Called with the updated cache, or error
G2Config.prototype.restore = function(callback) {
	this.update(this._cache, callback);
}

// Write only the list of provided values to G2
//       keys - list of keys to restore
//   callback - Called with an object containing the values updated
G2Config.prototype.restoreSome = function(keys, callback) {
    cache = {};
	keys.forEach(function(key) {
		cache[key] = this._cache[key];
	}.bind(this));
	this.update(cache, callback);
}

// Status reports are special, and their format must be whats expected for the 
// machine/runtime environments to work properly.
// TODO: Move this data out into a configuration file, perhaps.
// Configure the status reports (indicating to G2 what is to be reported)
//   callback - Called as soon as the command is issued (Does not wait for a response)
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
						"in8":true,
						"out1":true,
						"out2":true,
						"out3":true,
						"out4":true,
						"out5":true,
						"out6":true,
						"out7":true,
						"out8":true
					}});
		this.driver.command({"qv":0});
		this.driver.command({"jv":4});
		this.driver.requestStatusReport();
		return callback(null, this);
	} else {
		return callback(null, this);
	}
};
exports.G2Config = G2Config;
