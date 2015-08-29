var log = require('./log').logger('network');
var async = require('async');
var fs = require('fs');

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


function openHotspot(){
  self=this;
  log.info("Opening a hotspot...");
  log.info("SSID : "+ hotspot_ssid);
  log.info("Passphrase : "+ hotspot_passphrase);
  self.wifi.openHotspot(hotspot_ssid,hotspot_passphrase,function(err) {
    CHECK(err);
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
    connman.init(function(err) {
      self=this;
      CHECK(err);
      connman.initWiFi(function(err,wifi,properties) {
        CHECK(err);
        self.wifi=wifi;
        self.properties=properties;
        wifi.closeHotspot(function(err) {CHECK(err);});// be sure to close a previous hotspot before scanning
          wifi.enable(function(err){
          mainWifi();
        });

      });
    });    
}




exports.getAvailableWifiNetworks = function(callback) {

    /*
    wifiscanner.scan(function(err,data){
        if (err) {
            callback(err)
        } else {
            callback(null, data)
        }
    });
*/
    self.wifi.getNetworks(function(err,data) {
        if(err)callback(err);
        else{
            callback(null,data);
        }

    });
}

exports.getAvailableWifiNetwork = function(ssid, callback) {

/* 
    exports.getAvailableWifiNetworks(function(err, networks) {
        if(err) {
            callback(err)
        } else {
            var result = null;
            networks.some(function(network) {
                if(network.ssid == ssid) {
                    result = network;
                    return true;
                }
            });
            if(result) {
                callback(null, result);
            } else {
                callback('No such network.');
            }
        }
    })
*/
    self.wifi.getServiceBySSID(function(err,service){
            if(err) {
                callback(err);
            }else {
                service.getProperties(function(err,props){
                    if(err) {
                        callback(err);
                    }else {
                        callback(null,service.getProperties());
                    }
                });
            }
    });
}

exports.connectToAWifiNetwork= function(ssid,key,callback) {

    /*
    wifiscanner.scan(function(err,data){
        if (err) {
            callback(err)
        } else {
            callback(null, data)
        }
    });
*/
    self.wifi.join(ssid,key,function(err,data) {
        if(err){
        callback(err.message);
        mainWifi();
        }
        else{
            callback(null,data);
        }

    });
}


exports.disconnectFromAWifiNetwork= function(callback){
	self.wifi.disconnect(function(err){
		if(err)callback(err); 
		else callback(null);
	});
     
}

exports.forgetAWifiNetwork=function(ssid,callback){
	self.wifi.forgetNetwork(ssid,function(err){
		if(err)callback(err); 
		else callback(null);
	})
}


exports.turnWifiOn=function(callback){
     self.wifi.enable(function(err){
        if(err)callback(err); 
        else callback(null);
     });
}

exports.turnWifiOff=function(callback){
     self.wifi.disable(function(err){
        if(err)callback(err); 
        else callback(null);
     });
}

exports.turnWifiHotspotOn=function(callback){
     self.wifi.openHotspot(hotspot_ssid,hotspot_passphrase,function(err) {
        if(err)callback(err); 
        else callback(null);
     });
}

exports.turnWifiHotspotOff=function(callback){
     self.wifi.closeHotspot(function(err){
        if(err)callback(err); 
        else callback(null);
     });
}


/*******************************************************************************************/
/*************************************  OLD MANAGER  ***************************************/
/*******************************************************************************************/

exports.createProfileForAvailableWirelessNetwork = function(ssid, key, callback) {
    exports.getAvailableWifiNetwork(ssid, function(err, network) {
        if(err) {
            callback(err);
        } else {
            wifi_info = {}
            wifi_info.ssid = ssid
            wifi_info.security = network.security
            wifi_info.itr = WIFI_INTERFACE
            wifi_info.key = key
            exports.addWifiProfile(wifi_info, callback);
        }
    })
}

var loadNetworkProfile = function(filename, callback) {
    fs.readFile(PROFILES_FOLDER+filename, function (err, data) {
        if(err){
            callback(err);
        } else {
            var profile = parseNetworkProfile(data)
            callback(null, profile);
        }
    });
}

var parseNetworkProfile = function(profile_txt){
    var profile = {};
    var lines = profile_txt.toString().split('\n');
    for(var index in lines){
        var arg = lines[index].trim().split('=');
        if(arg[0])
            profile[arg[0]]=arg[1];
    }
    return profile;
}

exports.getWifiProfiles = function(callback) {
    fs.readdir(PROFILES_FOLDER,function(err,files){
        if(err){
            callback(err);
        } else {
            var wifi_profiles = files.filter(function(filename) {
                var is_profile = filename.indexOf(WIFI_INTERFACE+"-")===0
                return is_profile
            });
            async.map(wifi_profiles, loadNetworkProfile, callback);
        }
    });
}

exports.getWifiProfile = function(ssid, callback) {
    loadNetworkProfile(WIFI_INTERFACE+'-'+ssid, callback);
}

exports.formatWifiProfile = function(wifi_info){
    if(!wifi_info)
        return undefined;
    if(wifi_info.security !== "none" && wifi_info.security && "wep" && wifi_info.security !== "wpa" )
        return undefined;
    if(!wifi_info.ssid)
        return undefined;

    var profile_string="";
    profile_string+=    "Description='FabMo Wireless Manager Profile " + wifi_info.ssid + "'\n";
    profile_string+=    "Interface="+WIFI_INTERFACE+'\n';
    profile_string+=    "Connection=wireless\n";
    profile_string+=    "Security="+wifi_info.security+'\n';
    profile_string+=    "ESSID="+wifi_info.ssid+'\n';
    profile_string+=    "IP=dhcp\n";
    if(wifi_info.security!=="none" && wifi_info.key === undefined)
        return undefined;
    else
        profile_string+="Key="+wifi_info.key+'\n';

    return profile_string;
}

exports.addWifiProfile = function(wifi_info, callback) {
    var txt = exports.formatWifiProfile(wifi_info);
    if(txt) {
        fs.writeFile(PROFILES_FOLDER + WIFI_INTERFACE + '-' + wifi_info.ssid, txt, function(err) {
            callback(err);
        });
    } else {
        err = "Could not convert " + JSON.stringify(wifi_info) + " into a valid wifi profile";
        callback(err);
    }
}

exports.removeWifiProfile = function(ssid, callback) {
    fs.unlink(PROFILES_FOLDER+WIFI_INTERFACE+'-'+ssid, function (err) {
        callback(err);
    });
}


/*******************************************************************************************/
/********************************* END OF OLD MANAGER  *************************************/
/*******************************************************************************************/