/* 
 * detection_daemon.js
 * 
 * The detection daemon is responsible for making the FabMo engine discoverable on local networks.
 *
 * There are three ways that the FabMo engine accomplishes this.
 * Two of them are implented in this file.
 *
 * - bonjour
 * - A hand-rolled UDP broadcast strategy
 * - A cloud-based discovery service called beacon (not implemented here, but in the updater)
 * 
 * Of the three strategies above, the beacon service is the most likely to work, as UDP broadcasting is
 * often blocked on networks, particularly in schools and businesses.
 */
var os=require('os');
var util=require('util');
var EventEmitter = require('events').EventEmitter;
var dgram = require('dgram');
var log = require('./log').logger('detection');
var config = require('./config');
var bonjour = require('bonjour')();


// Direct socket messages
var OK = "YES I M !\0";
var ERR = "I DNT UNDRSTND !\0";
var HOSTNAME = "U NAME ?\0";
var REQ = "R U A SBT ?\0";

// This is the broadcast port
var DEFAULT_PORT = 24862; 

// Kick off the "detection daemon" which is the process that listens for broadcast messages coming from the tool minder
// The detection daemon is what we as a FabMo device run so that we can be discovered by the FabMo Minder
var start = function(port) {
	
	// Bonjour is easy, we just use the included module to publish our availability
	bonjour.unpublishAll();
	bonjour.publish({ name: os.hostname()+" - FabMo Tool Minder daemon", host:os.hostname()+'.local', type: 'fabmo',protocol:'tcp', port: config.engine.get('server_port'),txt : {fabmo:JSON.stringify(getMachineInfo())}});
	
	// Setup UDP socket, keeping in mind API changes that are needed for older versions of node
	var socketOpts = {'type':'udp4','reuseAddr':true};
	if (process.version.match(/v0\.10\.\d*/i)) {
		socketOpts = 'udp4';
	}

	// Create a socket and listen on the specified port	
	// The minder will send broadcast messages on this port that (network permitting) we will recieve and respond to.
	var socket = dgram.createSocket(socketOpts);
	port = port || DEFAULT_PORT;
	socket.bind(port);

	// Bind to message event
	socket.on("message", function ( data, rinfo ) {
		// Respond properly to queries asking if we are a FabMo device
		if(data.toString() == REQ) 
		{
			// Respond indicating that we are a FabMo system
			socket.send(new Buffer(OK), 0, OK.length, rinfo.port, rinfo.address, function (err) {
				if (err) {
					log.error(err);
				}
			});
		}
		// Respond properly to continued dialog in the autodetect process
		else if(data.toString() == HOSTNAME) 
		{

			result = getMachineInfo();
			// advertise an HTTP server on port 80
			socket.send(new Buffer(JSON.stringify(result)), 0, JSON.stringify(result).length, rinfo.port, rinfo.address, function (err) {
				if (err) log.error(err);
				});
		}
		else
		{
			log.error("Received from "+rinfo.address+" : unknown message : '"+ data.toString() +"'");
		}
	});
};

/*
 * Helper function that returns information about this machine:
 * hostname - The hostname of this machine
 * networks - a list of networks to which this machine is attached (as reported by the os)
 * server_port - the HTTP port on which this Engine instance hosts its interface
 */
function getMachineInfo(){
	var result = {};
	result.hostname= os.hostname();
	result.networks=[];
	result.server_port = config.engine.get('server_port');
	try {
	Object.keys(os.networkInterfaces() || {}).forEach(function(key,index,arr){ //val = ip adresses , key = name of interface
		var networks_list = this;
		(networks_list[key]||{}).forEach(function(val2,key2,arr2){
			if (val2.internal === false && val2.family === 'IPv4')
			{
				result.networks.push({'interface' : key , 'ip_address' : val2.address});
			}
		});
	},os.networkInterfaces());
	} catch(e) {
		log.warn(e);
	}
	return result;
}

// calling this module as a function kicks off the listening process
module.exports = start;
