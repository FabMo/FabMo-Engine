/*
 * network.js
 *
 * This module provides the factory function for creating the network manager.
 *
 * TODO: For consistency with how we've organized most of the packages, it might be better to move this to a network/index.js module
 */
var config = require("./config");
var log = require("./log").logger("network");

// Create and return the network manager.  You should only call this function once.
// It consults the os and plaform and fishes the appropriate network manager object out of the network/ directory
// If no such manager is defined or there's a problem creating it, an exception is thrown.
exports.createNetworkManager = function (name, callback) {
    // The OS comes from node, and is something like 'linux' or 'darwin'
    // The platform is defined in the updater configuration - it's something like 'edison' or 'westinghouse' or 'generic'
    var OS = config.platform;
    var PLATFORM = config.engine.get("platform");
    log.info("OS is:" + OS);
    log.info("PLATFORM is:" + PLATFORM);
    try {
        var NetworkManager = require("./network/" +
            OS +
            "/" +
            PLATFORM).NetworkManager;
        var nm = new NetworkManager();
        nm.os = OS;
        nm.platform = PLATFORM;
        if (!name && nm.platform === "raspberry-pi") {
            // eslint-disable-next-line no-unused-vars
            nm.set_uuid(function (name) {
                callback(null, nm);
            });
        } else {
            callback(null, nm);
        }
    } catch (e) {
        log.error("Network Management configuration failure" + e);
        callback(
            new Error(
                "Cannot load network manager for " +
                    OS +
                    "/" +
                    PLATFORM +
                    ": " +
                    e.message
            )
        );
    }
};
