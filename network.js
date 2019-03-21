// /*
//  * network.js
//  * 
//  * TODO : This seems like a relic.  This code has all been moved to the updater.  Delete it?
//  */
// var log = require('./log').logger('network');
// var async = require('async');
// var fs = require('fs');
// var doshell = require('./util').doshell

// var wifi;
// var WIFI_SCAN_INTERVAL = 5000;
// var WIFI_SCAN_RETRIES = 3;

// function jedison(cmdline, callback) {
//     var callback = callback || function() {}
//     doshell('./conf/jedison ' + cmdline, function(s) {
//         try {
//             j = JSON.parse(s)
//             if(j.status == 'success') {
//                 callback(null, j.data || {})
//             } else {
//                 callback(j.message)
//             }
//         } catch(e) {
//             callback(e);
//         }
//     });
// }

// var EdisonNetworkManager = function() {
//   this.mode = 'unknown';
//   this.state = 'idle';
//   this.networks = [];
//   this.command = null;
//   this.network_health_retries = 5;
// }

// EdisonNetworkManager.prototype.getInfo = function(callback) {
//   jedison('get wifi-info', callback);
// }

// EdisonNetworkManager.prototype.getNetworks = function(callback) {
//   jedison('get networks', callback);
// }

// EdisonNetworkManager.prototype.scan = function(callback) {
//   console.log("Scanning for networks..."); 
//   jedison('scan', callback);
// }

// EdisonNetworkManager.prototype.run = function() {
//   if(this.command) {
// 	switch(this.command.cmd) {
// 		case 'join':
// 			var ssid = this.command.ssid;
// 			var pw = this.command.password;
// 			this.command = null;
// 			this.state = 'idle';
// 			this.mode = 'unknown';
// 			this._joinWifi(ssid,pw,function(err, data) {
// 				this.run();
// 			}.bind(this));
// 			break;

// 		case 'ap':
// 			this.command=null;
// 			this.state = 'idle'
// 			this.mode = 'unknown'
// 			this._joinAP(function(err, data) {
// 				this.run();
// 			}.bind(this));
// 			break;
// 	}
// 	return;
// } 
//   switch(this.mode) {
//     case 'ap':
//       this.runAP();
//       break;

//     case 'station':
//       this.runStation();
//       break;

//     default:
//       this.state = 'idle';
//       this.getInfo(function(err, data) {
//         if(!err) {
//           var old_mode = this.mode;
// 		if(data.mode == 'managed') { this.mode = 'station'; }
//           else if(data.mode == 'master') { this.mode = 'ap'; }
//           else { log.warn('Unknown network mode: ' + data.mode)}
//         	if(this.mode != old_mode) {

//         setImmediate(this.run.bind(this));
// 		} else {

//         setTimeout(this.run.bind(this), 5000);

// }
// 	} else {

//         setTimeout(this.run.bind(this), 5000);
// }

//       }.bind(this));
//       break;
//   }
// }

// EdisonNetworkManager.prototype.runStation = function() {
//   switch(this.state) {
//     case 'idle':
//       this.scan_retries = WIFI_SCAN_RETRIES;
//       // Fall through
//     case 'scan':  
//       this.scan(function(err, data) {
//         this.state = 'done_scanning';
//         setTimeout(this.run.bind(this), WIFI_SCAN_INTERVAL);        
//       }.bind(this));
//       break;

//     case 'done_scanning':
//       this.getNetworks(function(err, data) {
//         if(!err) {
//           log.debug('Scanned and found ' + data.length + ' networks.')
//           for(var i in data) {
//               var ssid = data[i].ssid;
//               var found = false;
//               for(var j in this.networks) {
//                   if(this.networks[j].ssid === ssid) {
//                       found = true;
//                       break;
//                   }
//               }
//              if(!found) {
//                  this.networks.push(data[i]);
//              }
//           }
//         } else {
//           console.warn(err);
//         }
//         if(data.length === 0 && this.scan_retries > 0) {
//         log.warn("No networks?!  Retrying...");
// 	this.state = 'scan'
//         this.scan_retries--;
// } else {
//         this.state = 'check_network';
//         this.network_health_retries = 5;
// }
//         setImmediate(this.run.bind(this));
//       }.bind(this));
//       break;

//     case 'check_network':
//       log.debug('Checking network health...');
//       this.getInfo(function(err, data) {
//         var networkOK = true;
//         if(!err) {
//           if(data.ipaddress === '?') {
//            	log.info("Ip address == ?"); 
// 		networkOK = false;
//           }
//           if(data.mode === 'master') {
//              log.info("In master mode..."); 
// 	     this.mode = 'ap';
//              this.state = 'idle';
//              setImmediate(this.run.bind(this));
//           }
//         } else {
//           networkOK = false;
//         }
//         if(networkOK) {
//           log.debug("Network health OK");
//           this.state = 'idle';          
//           setImmediate(this.run.bind(this));
//         } else {
//           log.warn("Network health in question...");
//           if(this.network_health_retries == 0) {
//               this.network_health_retries = 5;
//               log.error("Network is down.  Going to AP mode.");
//        	      this.joinAP();
//               setImmediate(this.run.bind(this)); 
// 	  } else {
//              this.network_health_retries--;
//              setTimeout(this.run.bind(this),1000);
// 	  }
// 	}
//       }.bind(this));
//       break;
//   }
// }

// EdisonNetworkManager.prototype.runAP = function() {
//   switch(this.state) {
//     default:
//       this.getInfo(function(err, data) {
//         if(!err) {
//           if(data.mode === 'managed') { this.mode = 'station'; }
//           else if(data.mode === 'master') { this.mode = 'ap'; }
//           else { log.warn('Unknown network mode: ' + data.mode)}
//         }
//         setTimeout(this.run.bind(this), 5000);
//       }.bind(this));
//       break;
//   }
// }


// EdisonNetworkManager.prototype.joinAP = function() {
// 	this.command = {
// 		'cmd' : 'ap',
// 	}
// }

// EdisonNetworkManager.prototype._joinAP = function(callback) {
//   jedison('join ap', function(err, result) {
//     if(!err) {
// 	log.info("Entered AP mode.");
//     }
//     callback(err, result);
//   });
// }

// EdisonNetworkManager.prototype.joinWifi = function(ssid, password) {
// 	this.command = {
// 		'cmd' : 'join',
// 		'ssid' : ssid,
// 		'password' : password
// 	}
// }
// EdisonNetworkManager.prototype._joinWifi = function(ssid, password, callback) {
//   log.info("Attempting to join wifi network: " + ssid + " with password: " + password); 
//   jedison('join wifi --ssid=' + ssid + ' --password=' + password , function(err, result) {
//     if(err) {
//         log.error(err);
//     }
//     log.debug(result);
//     callback(err, result);
//   });
// }

// exports.init = function() {
// 	log.debug("Collapsing from AP state to scan (first boot)");
// 	jedison('unjoin', function(err, data) {
//   		wifi = new EdisonNetworkManager();
//   		wifi.run();
// 	});
// }


// exports.getAvailableWifiNetworks = function(callback) {
//   callback(null, wifi.networks);
// }

// exports.getAvailableWifiNetwork = function(ssid, callback) {
//     callback('not yet');
// }

// exports.connectToAWifiNetwork= function(ssid,key,callback) {
//     wifi.joinWifi(ssid, key, callback);
// }


// exports.disconnectFromAWifiNetwork= function(callback){
// /*  self.wifi.disconnect(function(err){
//     if(err)callback(err); 
//     else callback(null);
//   });*/
// callback('not yet');
     
// }

// exports.forgetAWifiNetwork=function(ssid,callback){
// /*  self.wifi.forgetNetwork(ssid,function(err){
//     if(err)callback(err); 
//     else callback(null);
//   })
// */
// callback('not yet');
// }


// exports.turnWifiOn=function(callback){
// /*     self.wifi.enable(function(err){
//         if(err)callback(err); 
//         else callback(null);
//      });
// */
// callback('Not available on the edison wifi manager.');

// }

// exports.turnWifiOff=function(callback){
// /*
//      self.wifi.disable(function(err){
//         if(err)callback(err); 
//         else callback(null);
//      });
// */
// callback('Not available on the edison wifi manager.');

// }

// exports.turnWifiHotspotOn=function(callback){
//     log.info("Entering AP mode...")
//     wifi.joinAP();
// }

// exports.turnWifiHotspotOff=function(callback){
// /*     self.wifi.closeHotspot(function(err){
//         if(err)callback(err); 
//         else callback(null);
//      });
// */
// callback('not yet');
// }


/*
 * network.js
 *
 * This module provides the factory function for creating the network manager.
 *
 * TODO: For consistency with how we've organized most of the packages, it might be better to move this to a network/index.js module
 */
var config = require('./config');

// Create and return the network manager.  You should only call this function once.
// It consults the os and plaform and fishes the appropriate network manager object out of the network/ directory
// If no such manager is defined or there's a problem creating it, an exception is thrown.
exports.createNetworkManager = function() {

	// The OS comes from node, and is something like 'linux' or 'darwin' 
	// The platform is defined in the updater configuration - it's something like 'edison' or 'westinghouse' or 'generic'
	var OS = config.platform;	
	var PLATFORM = config.engine.get('platform');
	console.log(OS); 
	console.log(PLATFORM);
	try {
		var NetworkManager = require('./network/' + OS + '/' + PLATFORM).NetworkManager;
		var nm = new NetworkManager();
		nm.os = OS;
		nm.platform = PLATFORM;
		return nm;
	} catch(e) {
		throw new Error("Cannot load network manager for " + OS + "/" + PLATFORM + ": " + e.message);
	}
}

