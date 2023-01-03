/*
 * nework/darwin/generic/index.html
 *
 * Network module for Mac OS X.  Actually does rudimentary network management!
 *
 * It can at least scan for networks.
 */
var doshell = require("../../../util").doshell;
var parseString = require("xml2js").parseString;
var config = require("../../../config");
var AIRPORT =
    "/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport";

var util = require("util");
var NetworkManager = require("../../../network_manager").NetworkManager;

var WIFI_SCAN_INTERVAL = 5000;

var DarwinNetworkManager = function () {
    this.networks = [];
};
util.inherits(DarwinNetworkManager, NetworkManager);

DarwinNetworkManager.prototype._scan = function (callback) {
    doshell(
        AIRPORT + " -s -x",
        function (result) {
            parseString(
                result,
                function (err, result) {
                    if (result) {
                        var data = result.plist.array[0].dict;
                        for (var i in data) {
                            var ssid = data[i].string[1];
                            var found = false;
                            for (var j in this.networks) {
                                if (this.networks[j].ssid === ssid) {
                                    found = true;
                                    break;
                                }
                            }
                            if (!found) {
                                this.networks.push({ ssid: ssid });
                            }
                        }
                    }
                }.bind(this)
            );
            callback();
        }.bind(this)
    );
};

DarwinNetworkManager.prototype.run = function () {
    this._scan(
        function () {
            setTimeout(this.run.bind(this), WIFI_SCAN_INTERVAL);
        }.bind(this)
    );
};

/*
 * PUBLIC API BELOW HERE
 */
DarwinNetworkManager.prototype.init = function () {
    this.run();
    this.emit("network", { mode: "station" });
};

DarwinNetworkManager.prototype.isOnline = function (callback) {
    callback(null, true);
};

DarwinNetworkManager.prototype.getAvailableWifiNetworks = function (callback) {
    callback(null, this.networks);
};

DarwinNetworkManager.prototype.setIdentity = function (identity, callback) {
    if (identity.name) {
        config.updater.set("name", identity.name);
    }
    typeof callback === "function" && callback(null, this);
};

exports.NetworkManager = DarwinNetworkManager;
