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

G2Config.prototype.changeUnits = function(units, callback) {
	this.driver.setUnits(units, function(err, data) {
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

// Update the configuration with the data provided (data is just an object with configuration keys/values)
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

G2Config.prototype.restore = function(callback) {
	this.update(this._cache, callback);
}

G2Config.prototype.restoreSome = function(keys, callback) {
    cache = {};
	keys.forEach(function(key) {
		cache[key] = this._cache[key];
	}.bind(this));
	this.update(cache, callback);
}

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
