/*
 * network/linux/manager.js
 *
 * This module defines the generic superclass for network managers in the `linux` platform.
 *
 * It defines the interface for all the methods, and logs a warning if any of these methods are unimplemented.
 */
var log = require("./log").logger("manager");
var util = require("util");
var events = require("events");

var GenericNetworkManager = function (os, platform) {
    this.platform = platform || "???";
    this.os = os || "???";
};
util.inherits(GenericNetworkManager, events.EventEmitter);

function fail(instance, callback) {
    callback
        ? callback(new Error("Function unavailable on " + instance.os + "/" + instance.platform))
        : log.warn("Function unavailable on " + instance.os + "/" + instance.platform + ", no callback given");
}

GenericNetworkManager.prototype.init = function () {};

GenericNetworkManager.prototype.getAvailableWifiNetworks = function (callback) {
    log.warn("Unimplemented: getAvailableWifiNetworks");
    fail(this, callback);
};

GenericNetworkManager.prototype.connectToAWifiNetwork = function (ssid, key, callback) {
    log.warn("Unimplemented: connectToAWifiNetwork(" + ssid + "," + key + ")");
    fail(this, callback);
};

GenericNetworkManager.prototype.turnWifiOn = function (callback) {
    log.warn("Unimplemented: turnWifiOn");
    fail(this, callback);
};

GenericNetworkManager.prototype.turnWifiOff = function (callback) {
    log.warn("Unimplemented: turnWifiOff");
    fail(this, callback);
};

GenericNetworkManager.prototype.turnWifiHotspotOn = function (callback) {
    log.warn("Unimplemented: turnWIfiHotspotOn");
    fail(this, callback);
};

GenericNetworkManager.prototype.turnWifiHotspotOff = function (callback) {
    log.warn("Unimplemented: turnWIfiHotspotOff");
    fail(this, callback);
};

GenericNetworkManager.prototype.getWifiHistory = function (callback) {
    log.warn("Unimplemented: getWifiHistory");
    fail(this, callback);
};

GenericNetworkManager.prototype.setIdentity = function (identity, callback) {
    log.warn("Unimplemented: setIdentity(" + JSON.stringify(identity) + ")");
    fail(this, callback);
};

GenericNetworkManager.prototype.isOnline = function (callback) {
    log.warn("Unimplemented: isOnline()");
    fail(this, callback);
};

GenericNetworkManager.prototype.isWifiOn = function (callback) {
    log.warn("Unimplemented: isWiFiOn()");
    fail(this, callback);
};

GenericNetworkManager.prototype.getStatus = function (callback) {
    log.warn("Unimplemented: getStatus()");
    fail(this, callback);
};

//Ethernet section
GenericNetworkManager.prototype.turnEthernetOn = function (callback) {
    log.warn("Unimplemented: turnEthernetOn()");
    fail(this, callback);
};

GenericNetworkManager.prototype.turnEthernetOff = function (callback) {
    log.warn("Unimplemented: turnEthernetOff()");
    fail(this, callback);
};

// interface specific - static addressing
GenericNetworkManager.prototype.enableDHCP = function (interface, callback) {
    log.warn("Unimplemented: enableDHCP()");
    fail(this, callback);
};

GenericNetworkManager.prototype.disableDHCP = function (interface, callback) {
    log.warn("Unimplemented: disableDHCP()");
    fail(this, callback);
};

GenericNetworkManager.prototype.startDHCPServer = function (interface, callback) {
    log.warn("Unimplemented: enableDHCP()");
    fail(this, callback);
};

GenericNetworkManager.prototype.stopDHCPServer = function (interface, callback) {
    log.warn("Unimplemented: disableDHCP()");
    fail(this, callback);
};

GenericNetworkManager.prototype.setIpAddress = function (interface, ip, callback) {
    log.warn("Unimplemented: setIpAddress()");
    fail(this, callback);
};

GenericNetworkManager.prototype.setNetmask = function (interface, netmask, callback) {
    log.warn("Unimplemented: setNetmask()");
    fail(this, callback);
};

GenericNetworkManager.prototype.setGateway = function (gateway, callback) {
    log.warn("Unimplemented: setGateway()");
    fail(this, callback);
};

GenericNetworkManager.prototype.applyEthernetConfig = function (callback) {
    log.warn("Unimplemented: applyEthernetConfig()");
    fail(this, callback);
};

GenericNetworkManager.prototype.applyWifiConfig = function (callback) {
    log.warn("Unimplemented: applyWifiConfig()");
    fail(this, callback);
};

GenericNetworkManager.prototype.getLocalAddresses = function () {
    return [];
};
exports.NetworkManager = GenericNetworkManager;
