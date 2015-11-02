var log = require('./log').logger('network');
var async = require('async');
var fs = require('fs');
var doshell = require('./util').doshell

var wifi;
var WIFI_SCAN_INTERVAL = 5000;

function jedison(cmdline, callback) {
    var callback = callback || function() {}
    doshell('./conf/jedison ' + cmdline, function(s) {
        try {
            j = JSON.parse(s)
            if(j.status == 'success') {
                callback(null, j.data || {})
            } else {
                callback(j.message)
            }
        } catch(e) {
            callback(e);
        }
    });
}

var EdisonNetworkManager = function() {
  this.mode = 'unknown';
  this.state = 'idle';
  this.networks = [];
  this.command = null;
}

EdisonNetworkManager.prototype.getInfo = function(callback) {
  jedison('get wifi-info', callback);
}

EdisonNetworkManager.prototype.getNetworks = function(callback) {
  jedison('get networks', callback);
}

EdisonNetworkManager.prototype.scan = function(callback) {
  jedison('scan wifi', callback);
}

EdisonNetworkManager.prototype.run = function() {
  switch(this.mode) {
    case 'ap':
      this.runAP();
    break;

    case 'station':
      this.runStation();
    break;

    default:
      this.state = 'idle';
      this.getInfo(function(err, data) {
        if(!err) {
          if(data.mode == 'managed') { this.mode = 'station'; }
          else if(data.mode == 'master') { this.mode = 'ap'; }
          else { log.warn('Unknown network mode: ' + data.mode)}
        }

        setTimeout(this.run.bind(this), 1000);
      }.bind(this));
  }
}

EdisonNetworkManager.prototype.runStation = function() {
  switch(this.state) {
    case 'idle':
      this.scan();
      this.state = 'done_scanning';
      setTimeout(this.run.bind(this), WIFI_SCAN_INTERVAL);
      break;

    case 'done_scanning':
      this.getNetworks(function(err, data) {
        if(!err) {
          console.log(data)
          this.networks = data;
        } else {
          console.warn(err);
        }
        this.state = 'idle';
        setImmediate(this.run.bind(this));
      }.bind(this));
  }
}

EdisonNetworkManager.prototype.runAP = function() {
  switch(this.state) {
    default:
      this.getInfo(function(err, data) {
        if(!err) {
          if(data.mode == 'managed') { this.mode = 'station'; }
          else if(data.mode == 'master') { this.mode = 'ap'; }
          else { log.warn('Unknown network mode: ' + data.mode)}
        }
        setTimeout(this.run.bind(this), 1000);
      });
      break;
  }
}

EdisonNetworkManager.prototype.joinAP = function(callback) {
  this.mode = 'unknown';
  jedison('join ap', function(err, result) {
    callback(err, result);
  });
}

EdisonNetworkManager.prototype.joinWifi = function(ssid, password, callback) {
  this.mode = 'unknown';
  this.state = 'idle';
  jedison('join wifi --ssid=' + ssid + ' --password=' + password , function(err, result) {
    callback(err, result);
  });
}


function mainWifi(){
  wifi = new EdisonNetworkManager();
  wifi.run();
}

exports.init = function() {
  mainWifi();
}


exports.getAvailableWifiNetworks = function(callback) {
  callback(null, wifi.networks);
}

exports.getAvailableWifiNetwork = function(ssid, callback) {
    callback('not yet');
}

exports.connectToAWifiNetwork= function(ssid,key,callback) {
    wifi.joinWifi(ssid, key, callback);
}


exports.disconnectFromAWifiNetwork= function(callback){
/*	self.wifi.disconnect(function(err){
		if(err)callback(err); 
		else callback(null);
	});*/
callback('not yet');
     
}

exports.forgetAWifiNetwork=function(ssid,callback){
/*	self.wifi.forgetNetwork(ssid,function(err){
		if(err)callback(err); 
		else callback(null);
	})
*/
callback('not yet');
}


exports.turnWifiOn=function(callback){
/*     self.wifi.enable(function(err){
        if(err)callback(err); 
        else callback(null);
     });
*/
callback('Not available on the edison wifi manager.');

}

exports.turnWifiOff=function(callback){
/*
     self.wifi.disable(function(err){
        if(err)callback(err); 
        else callback(null);
     });
*/
callback('Not available on the edison wifi manager.');

}

exports.turnWifiHotspotOn=function(callback){
    log.info("Turning on wifi hotspot")
    wifi.joinAP(callback);
}

exports.turnWifiHotspotOff=function(callback){
/*     self.wifi.closeHotspot(function(err){
        if(err)callback(err); 
        else callback(null);
     });
*/
callback('not yet');
}