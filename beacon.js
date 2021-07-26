/*
 * beacon.js
 *
 * Defines the service responsible for reporting to a beacon host in the cloud
 * The beacon is a reporting service that allows FabMo instances to report their local IP address and software version information
 * to a cloud service that organizes it and provides access to the information to FabMo tool minder instances on the same network.
 * 
 * Importantly, it is a way for the FabMo Minder to discover tools on its local network in cases where the UDP broadcast strategies
 * defined in detection_daemon.js do not work
 */
var config = require('./config')

var log = require('./log').logger('beacon')
var request = require('request')
var Q = require('q');

// Interval for retrying the server (milliseconds)
var RETRY_INTERVAL = 5000

// The Beacon object is responsible for checking in with a beacon server
// It provides information about this host and the local network environment so that the minder
// service can find local tools in instances where UDP broadcast/zeroconf strategies fail
//   options - Options for initializing the beacon service
//        url - The URL for beacon requests
//   interval - The interval between reports in milliseconds (default = 1 hour)
var Beacon = function(options) {
	var options = options || {}
	this.url = options.url
    this.retry_url = null
    if(!this.url) { throw new Error('Beacon needs a URL.'); }
	this.interval = options.interval || 1*60*60*1000;
	this._timer = null;
	this.running = false;
	this.consent_for_beacon = "false";
	this.localAddresses = []
	this.engine = require('./engine');
}

// Set the URL for this beacon instance
// This action provokes a new beacon report
//   url - The new beacon URL
function setURL(url) { this.set('url', url); }

// Set the reporting interval for this beacon instance (milliseconds)
// This action provokes a new beacon report
//   interval - The new reporting interval in milliseconds
function setInterval(interval) { this.set('interval', interval); }

// Change an option for this instance to the provided value
//   key - The option to change (eg: url, interval, etc.)
// value - The new value for the option   
Beacon.prototype.set = function(key, value) {
	this[key] = value;
	var wasRunning = this.running;
	this.stop();
	if(wasRunning) { this.run('config'); }
}

// Start the reporting service.  This provokes an immediate report
//   reason - Informational string describing why reporting is being started (eg: "joined a new network", etc.)
Beacon.prototype.start = function(reason) {
	this.running = true;
	this.run(reason);
}

// Function called at intervals to report to the beacon
// TODO - This function is internal to the beacon, maybe use the underscore convention for private method?
Beacon.prototype.run = function(reason) {
	if (this.consent_for_beacon != "false") {
		this.report(reason)
			.catch(function(err) {
				log.warn('Could not send a beacon message: ' + err);
			})
			.finally(function() {

				this._timer = setTimeout(this.run.bind(this), this.interval);
			}.bind(this));
	} else {
		log.warn('Beacon is not enabled');
	}
}

// Stops further beacon reports. Reports can be restarted with `start()`
Beacon.prototype.stop = function() {
	this.running = false;
	if(this._timer) {
		clearTimeout(this._timer);
	}
}

// Report to the beacon server only once
// TODO - Look at this function - not sure it actually does what is advertises
//   reason - Informational string describing why a report is being sent (eg: "changed IP address", etc.)
Beacon.prototype.once = function(reason) {
	var wasRunning = this.running;
	this.stop();
	this.start(reason);
}

// Return a promise that fulfills with the beacon message to be sent.
// Retrieves information that is typical for beacon packets (engine version, updater version, ip addresses, etc)
//   reason - The reason message for the beacon packet (Typically this is passed from the call that provoked the report) 
Beacon.prototype.createMessage = function(reason) {
	
	// Create a base message with the easy stuff
	var msg = {
		id : 'pi-123',
		name : 'brendan-pi',
		os : config.platform,
		platform : config.engine.get('platform'),
		os_version :'test',
		reason : reason || 'interval',
		local_ips : [],
		updater_version: {
			build_date: 'gone',
			number: 'gone',
			hash :'gone'
		}
	}

	// Add local IP addresses to message
	this.localAddresses.forEach(function(addr, idx) {
		msg.local_ips.push({'address':addr});
	});

	var deferred = Q.defer()
	
	// Get the version of both the engine

	try {
		this.engine.getVersion(function(err, version) {
			if(err) {
				msg.engine_version = {};
				log.warn("Engine version could not be determined");
				log.warn(err);
			} else {
				log.info('version gotten');
				msg.engine_version = version;
			}
			deferred.resolve(msg);
		})
	} catch(e) {
		// TODO - Do we really want to fail if we can't get the engine/updater version?
		//        Reliability might be improved if we just filled in an "unknown" value for these
		//        (an incomplete report mi0ght be better than none at all)
		deferred.reject(e);
	}
	console.log('gonna return')
	return deferred.promise
}

// Report to the beacon server.
// Returns a promise that resolves once the report has been sent (or rejects when it fails)
//   reason - Informational string describing the reason this report is being sent (eg: "system startup", etc.)
//            if the reason is set to "retry" this will send a report to this.retry_url rather than this.url -
//            this.retry_url is nominally undefined, but will be set by this function in the case of a 301 or 307 response (URL Changed)
Beacon.prototype.report = function(reason) {
	log.info('doing the report')
	deferred = Q.defer()
	if(this.url) {
		// Create the message that contains all the IP Address/Version/OS information
		return this.createMessage(reason)
		.then(function(message) {
			// If this is a retry, send to the retry URL instead of the normal url 
			log.info(message)
			var url = reason == 'retry' ? this.retry_url : this.url;

			// Reset the retry URL to the normal URL after this attempt
            this.retry_url = this.url;
		    log.info('Sending beacon report (' + (reason || 'interval') + ') to ' + url);
            
		    // Post to the server
            request({uri : url, json : true,body : message, method : 'POST'}, function(err, response, body) {
				if(err) {
					log.warn('Could not send message to beacon server: ' + err);
					deferred.reject(err);
				} else if(response.statusCode != 200) {
					if(response.statusCode === 301) {
						// A 301 response means that the beacon URL has changed permanently.
						// We take this seriously and actually update our settings to reflect the new URL
						// TODO - Shouldn't we retry here as well?  By returning now, we ensure that no retry happens.
						if(response.headers.location) {
							log.warn('Beacon URL has changed.  Updating configuration to new URL: ' + response.headers.location)
							config.engine.set('beacon_url', response.headers.location);
							deferred.resolve();
							return;
						}
					} else if(response.statusCode === 307) {
						// A 307 response means the beacon URL has moved, but temporarily.  We retry at that URL
						// TODO - should we just 'set' the URL for this session?
						if(response.headers.location) {
                            this.retry_url = response.headers.location;
                        }
                    }

                    // Log an error and reject the promise, but set a timer for a retry
					var err = new Error("Beacon server responded with status code " + response.statusCode);
					log.warn(err);
					deferred.reject(err);
                    setTimeout(function() {
						this.report('retry');
					}.bind(this), RETRY_INTERVAL);

				} else {
					log.info('Post to beacon server successful.');
					deferred.resolve();
				}
			}.bind(this));
		}.bind(this)).catch(function(err){
			log.error(err)
			deferred.reject(err);
		}.bind(this))
	} else {
		deferred.resolve();
	}

	return deferred.promise()
}

// Set the local addresses to the provided list of values
// This list of local IP addresses will be reported to the beacon server as IP addresses on 
// which this host is available on the network.  Setting local addresses provokes an immediate
// beacon report.
Beacon.prototype.setLocalAddresses = function(localAddresses) {
	this.localAddresses = localAddresses;
}

module.exports = Beacon