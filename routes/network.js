/*
 * routes/network.js
 *
 * Routes related to network management.  Provides functions for
 * setting up wifi, ethernet, getting network status, etc.
 */
var log = require("../log").logger("network");
var config = require("../config");
var util = require("../util");

var LOGFILE = "/var/log/network_monitor.log";
var fs = require("fs");
var network = require("../engine").networkManager;

// Function to read the latest log entry
const readLatestLogEntry = (callback) => {
    fs.readFile(LOGFILE, "utf8", (err, data) => {
        if (err) {
            return callback(err);
        }
        const lines = data.trim().split("\n");
        const lastLine = lines.slice(-1)[0];
        callback(null, lastLine);
    });
};

// Return a list of wifi networks that are currently visible.
// TODO - This is a bad route name, because retrieving it doesn't actually trigger a scan
// eslint-disable-next-line no-unused-vars
var scan = function (req, res, next) {
    network.getAvailableWifiNetworks(function (err, data) {
        if (err) {
            log.error(err);
            res.json({ status: "error", message: err.message });
        } else {
            res.json({ status: "success", data: { wifi: data } });
        }
    });
};

// // Connect to the wifi network specified in the request body  *
// // eslint-disable-next-line no-unused-vars
// var connectWifi = function (req, res, next) {
//     var ssid = req.params.ssid;
//     var key = req.params.key;
//     if (ssid) {
//         network.joinWifiNetwork(ssid, key, function (err, data) {
//             if (err) {
//                 log.error(err);
//                 res.json({ status: "error", message: err });
//             } else {
//                 // Assuming getWifiIP is an asynchronous function
//                 network.getWifiIp(ssid, function (ipErr, ipAddress) {
//                     if (ipErr) {
//                         // Handle error, maybe IP couldn't be retrieved
//                         log.error(ipErr);
//                         res.json({ status: "success", data: { wifi: data, ip: "Unavailable" } });
//                     } else {
//                         // Include the IP address in the response
//                         res.json({ status: "success", data: { wifi: data, ip: ipAddress } });
//                     }
//                 });
//             }

//             // } else {
//             //     res.json({ status: "success", data: { wifi: data } });
//             // }
//         });
//     } else {
//         log.error("Not joining a network because no SSID provided.");
//         res.json({ status: "error", message: "No SSID provided" });
//     }
// };

// Connect to the wifi network specified in the request body
// eslint-disable-next-line no-unused-vars
var connectWifi = function (req, res, next) {
    var ssid = req.params.ssid;
    var key = req.params.key;
    if (ssid) {
        network.joinWifiNetwork(ssid, key, function (err, data) {
            if (err) {
                log.error(err);
                res.json({ status: "error", message: err });
            } else {
                // Assuming getWifiIP is an asynchronous function
                network.getWifiIp(ssid, function (ipErr, ipAddress) {
                    if (ipErr) {
                        // Handle error, maybe IP couldn't be retrieved
                        log.error(ipErr);
                        res.json({ status: "success", data: { wifi: data, ip: "Unavailable" } });
                    } else {
                        // Include the IP address in the response
                        res.json({ status: "success", data: { wifi: data, ip: ipAddress } });
                    }
                });
            }
        });
    } else {
        log.error("Not joining a network because no SSID provided.");
        res.json({ status: "error", message: "No SSID provided" });
    }
};

// Disconnect from the current wifi network
// eslint-disable-next-line no-unused-vars
var disconnectFromWifi = function (req, res, next) {
    var ssid = req.params.ssid;
    var network = require("../engine").networkManager;
    if (ssid) {
        // eslint-disable-next-line no-unused-vars
        network.forgetWifi(ssid, function (err, data) {
            if (err) {
                res.json({ status: "error", message: err.message });
            } else {
                res.json({ status: "success" });
            }
            //        res.json({ status: "success" });
        });
    } else {
        // TODO this could be more informative
        res.json({ status: "error", message: "wrong POST command sent !" });
    }
};

// // Forget the wifi network with the SSID provided in the post body *
// // eslint-disable-next-line no-unused-vars
// var forgetWifi = function (req, res, next) {
//     var ssid = req.params.ssid;
//     var network = require("../engine").networkManager;

//     if (ssid) {
//         // eslint-disable-next-line no-unused-vars
//         network.forgetWifiNetwork(ssid, function (err, data) {
//             if (err) {
//                 res.json({ status: "error", message: err.message });
//             } else {
//                 res.json({ status: "success" });
//             }
//         });
//     } else {
//         res.json({ status: "error", message: "No SSID provided" });
//     }
// };

// Enable or disable the wifi, depending on the value of the `enabled` attribute in the POST body
// eslint-disable-next-line no-unused-vars
var wifiState = function (req, res, next) {
    var state = req.params.enabled;

    var network = require("../engine").networkManager;
    if (state === true) {
        network.turnWifiOn(function (err) {
            if (err) {
                res.json({ status: "error", message: err.message });
            } else {
                res.json({ status: "success" });
            }
        });
    } else if (state === false) {
        network.turnWifiOff(function (err) {
            if (err) {
                res.json({ status: "error", message: err.message });
            } else {
                res.json({ status: "success" });
            }
        });
    } else {
        // TODO this could be more informative
        res.json({ status: "error", message: "wrong POST command sent !" });
    }
};

// const hotspotState = (req, res, next) => {
//     const state = req.body.enabled; // Use req.body for POST data

//     const sendResponse = (err) => {
//         if (err) {
//             return res.json({ status: "error", message: err.message });
//         }
//         res.json({ status: "success" });
//     };

//     if (state === true || state === "true") {
//         network.enableWifiHotspot((err) => {
//             if (err) {
//                 return sendResponse(err);
//             }
//             // Log the action for the monitoring script
//             readLatestLogEntry((logErr, lastLog) => {
//                 if (logErr) {
//                     console.error("Failed to read log:", logErr);
//                 } else {
//                     console.log("Last log entry:", lastLog);
//                 }
//                 sendResponse(null);
//             });
//         });
//     } else if (state === false || state === "false") {
//         network.disableWifiHotspot((err) => {
//             if (err) {
//                 return sendResponse(err);
//             }
//             // Log the action for the monitoring script
//             readLatestLogEntry((logErr, lastLog) => {
//                 if (logErr) {
//                     console.error("Failed to read log:", logErr);
//                 } else {
//                     console.log("Last log entry:", lastLog);
//                 }
//                 sendResponse(null);
//             });
//         });
//     } else {
//         res.json({ status: "error", message: "Invalid state value" });
//     }
// };

// Enable or disable AP mode, depending on the value of the `enabled` attribute in the POST body
const hotspotState = (req, res, next) => {
    const state = req.body.enabled; // Use req.body for POST data

    const sendResponse = (err) => {
        if (err) {
            return res.json({ status: "error", message: err.message });
        }
        res.json({ status: "success" });
    };

    if (state === true || state === "true") {
        network.enableWifiHotspot((err) => {
            if (err) {
                return sendResponse(err);
            }
            // Log the action for the monitoring script
            readLatestLogEntry((logErr, lastLog) => {
                if (logErr) {
                    console.error("Failed to read log:", logErr);
                } else {
                    console.log("Last log entry:", lastLog);
                }
                sendResponse(null);
            });
        });
    } else if (state === false || state === "false") {
        network.disableWifiHotspot((err) => {
            if (err) {
                return sendResponse(err);
            }
            // Log the action for the monitoring script
            readLatestLogEntry((logErr, lastLog) => {
                if (logErr) {
                    console.error("Failed to read log:", logErr);
                } else {
                    console.log("Last log entry:", lastLog);
                }
                sendResponse(null);
            });
        });
    } else {
        res.json({ status: "error", message: "Invalid state value" });
    }
};

// Set the network ID name and password
// This is the AP SSID/Hostname
// eslint-disable-next-line no-unused-vars
var setNetworkIdentity = function (req, res, next) {
    var name = req.params.name;
    var password = req.params.password;

    var network = require("../engine").networkManager;
    network.setIdentity(
        { name: name, password: password },
        // eslint-disable-next-line no-unused-vars
        function (err, data) {
            if (err) {
                return res.json({ status: "error", message: err.message });
            }
            res.json({ status: "success" });
        }
    );
};

// Retrieve the network ID (but only return the name, not password)
// This is the AP SSID/Hostname
// eslint-disable-next-line no-unused-vars
function getNetworkIdentity(req, res, next) {
    res.json({
        status: "success",
        data: { name: config.engine.get("name"), id: config.engine.get("id") },
    });
}

// Retrieve the history of joined networks
// eslint-disable-next-line no-unused-vars
var getWifiHistory = function (req, res, next) {
    var network = require("../engine").networkManager;
    network.getWifiHistory(function (err, data) {
        if (err) {
            return res.json({ status: "error", message: err.message });
        }
        res.json({
            status: "success",
            data: { history: data },
        });
    });
};

// Return true if this machine can see the internet, false otherwise
// eslint-disable-next-line no-unused-vars
var isOnline = function (req, res, next) {
    var network = require("../engine").networkManager;
    network.isOnline(function (err, online) {
        if (err) {
            return res.json({ status: "error", message: err.message });
        }
        return res.json({ status: "success", data: { online: online } });
    });
};

// Get network status (???)
// TODO : What actually is the network status
// eslint-disable-next-line no-unused-vars
var getStatus = function (req, res, next) {
    var network = require("../engine").networkManager;

    network.getStatus(function (err, status) {
        if (err) {
            return res.json({ status: "error", message: err.message });
        }
        return res.json({ status: "success", data: { status: status } });
    });
};

// Set the ethernet configuration to params provided in the POST body
// eslint-disable-next-line no-unused-vars
var setEthernetConfig = function (req, res, next) {
    var network = require("../engine").networkManager;
    var netConfig = config.engine.get("network");
    var ethernetConfig = netConfig.ethernet;
    var newEthernetConfig = req.params;
    util.extend(ethernetConfig, newEthernetConfig);
    netConfig.ethernet = ethernetConfig;
    config.engine.set("network", netConfig);
    network.applyEthernetConfig();
    res.json({
        status: "success",
        data: config.engine.get("network").ethernet,
    });
};

// Retrieve the ethernet config
// eslint-disable-next-line no-unused-vars
var getEthernetConfig = function (req, res, next) {
    var netConfig = config.engine.get("network");
    var ethernetConfig = netConfig.ethernet;
    res.json({
        status: "success",
        data: ethernetConfig,
    });
};

// Set the wifi configuration to params provided in the POST body
// eslint-disable-next-line no-unused-vars
var setWifiConfig = function (req, res, next) {
    var network = require("../engine").networkManager;
    var netConfig = config.engine.get("network");
    var wifiConfig = netConfig.wifi;
    var newWifiConfig = req.params;
    util.extend(wifiConfig, newWifiConfig);
    netConfig.wifi = wifiConfig;
    config.engine.set("network", netConfig);
    network.applyWifiConfig();
    res.json({
        status: "success",
        data: config.engine.get("network").wifi,
    });
};

// Retrieve the ethernet config
// eslint-disable-next-line no-unused-vars
var getWifiConfig = function (req, res, next) {
    var netConfig = config.engine.get("network");
    var wifiConfig = netConfig.wifi;
    res.json({
        status: "success",
        data: wifiConfig,
    });
};

module.exports = { hotspotState };

module.exports = function (server) {
    server.post("/network/wifi/state", wifiState);
    server.post("/network/hotspot/state", hotspotState);
    server.get("/network/wifi/scan", scan);
    server.post("/network/wifi/connect", connectWifi);
    server.post("/network/wifi/disconnect", disconnectFromWifi);
    server.get("/network/wifi/history", getWifiHistory);
    server.get("/network/identity", getNetworkIdentity);
    server.post("/network/identity", setNetworkIdentity);
    server.get("/network/online", isOnline);
    server.post("/network/ethernet/config", setEthernetConfig);
    server.post("/network/wifi/config", setWifiConfig);
    server.get("/network/ethernet/config", getEthernetConfig);
    server.get("/network/wifi/config", getWifiConfig);
};
