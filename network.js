try{var wifiscanner = require('node-simplerwifiscanner');}catch(e){}
var log = require('./log').logger('network');
var async = require('async');
var fs = require('fs');

var PROFILES_FOLDER = "/etc/netctl/";
var WIFI_INTERFACE = "wlan0";

exports.getAvailableWifiNetworks = function(callback) {
    wifiscanner.scan(function(err,data){
        if (err) {
            callback(err)
        } else {
            callback(null, data)
        }
    });
}

exports.getAvailableWifiNetwork = function(ssid, callback) {
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
}

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