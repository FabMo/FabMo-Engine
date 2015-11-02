var log = require('./log').logger('network');
var async = require('async');
var fs = require('fs');
var doshell = require('./util').doshell

try{var wifiscanner = require('node-simplerwifiscanner');}catch(e){
        log.warn("Did not load connman-simplified: " + e);
}
try{var connman = require('connman-simplified')();}catch(e){
    log.warn("Did not load connman-simplified: " + e);
}

var PROFILES_FOLDER = "/etc/netctl/";
var WIFI_INTERFACE = "wlan0";
var hotspot_ssid="handibot";
var hotspot_passphrase="shopbot";
var wifi;
var properties;

function CHECK(err){if(err){log.error(err);/*process.exit(-1);*/}}

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

function openHotspot(callback){
  self=this;
  log.info("Opening a hotspot...");
  log.info("SSID : "+ hotspot_ssid);
  log.info("Passphrase : "+ hotspot_passphrase);
  jedison('join ap', function(err, result) {
    callback(err, result);
  });
}

function mainWifi(){
  self=this;
  self.wifi.getNetworks(function(err,list) { // get the list of available networks
    CHECK(err);
    log.info("networks: " + self.wifi.getServicesString(list));
    self.wifi.joinFavorite(function(err){ // try to join a favorite
      if(err){openHotspot();} // if it fails, open a hotspot point.
      else{
        self.wifi.service.getProperties(function(err,props){
          log.info("you're connected to " + props.Name + " through " + props.Type);
        });
      }
    });
  });
}

exports.init = function() {
}




exports.getAvailableWifiNetworks = function(callback) {
    jedison('scan');
    jedison('get networks', function(err, data) {
        callback(err, data);
    })
}

exports.getAvailableWifiNetwork = function(ssid, callback) {
    callback('not yet');
}

exports.connectToAWifiNetwork= function(ssid,key,callback) {
    callback('not yet');
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
callback('not yet');

}

exports.turnWifiOff=function(callback){
/*
     self.wifi.disable(function(err){
        if(err)callback(err); 
        else callback(null);
     });
*/
callback('not yet');

}

exports.turnWifiHotspotOn=function(callback){
    console.log("Turning on wifi hotspot")
    openHotspot(callback);
}

exports.turnWifiHotspotOff=function(callback){
/*     self.wifi.closeHotspot(function(err){
        if(err)callback(err); 
        else callback(null);
     });
*/
callback('not yet');
}