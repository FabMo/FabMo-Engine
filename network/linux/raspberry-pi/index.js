var log = require("../../../log").logger("network");
var os = require("os");
var fs = require("fs");
var config = require("../../../config");
var async = require("async");
var child_process = require("child_process");
var exec = child_process.exec;
var util = require("util");
var NetworkManager = require("../../../network_manager").NetworkManager;
var dns = require("dns");

var ifconfig = require("wireless-tools/ifconfig");
var iwconfig = require("wireless-tools/iwconfig");

const commands = require("./commands.js");

var NETWORK_HEALTH_RETRIES = 8;

var RaspberryPiNetworkManager = function () {
    this.mode = "unknown";
    this.wifiState = "idle";
    this.ethernetState = "idle";
    this.networks = [];
    this.command = null;
    this.network_health_retries = NETWORK_HEALTH_RETRIES;
    this.network_history = {};
    this.networkInfo = {
        wireless: null,
        wired: null,
    };
};
util.inherits(RaspberryPiNetworkManager, NetworkManager);

RaspberryPiNetworkManager.prototype.set_serialnum = function (callback) {
    log.info("SETTING FabMo Serial Number from R-Pi for default SSID");
    // We are putting the R-Pi serial number into the FabMo name
    // ... this will be used as the default name for the FabMo
    // ... and will be used (with IP) as the default SSID for the FabMo until set by the user.
    // ... Once defined, it will subsequently be read from the config file.
    exec("cat /proc/cpuinfo | grep Serial | cut -d ' ' -f 2", function (err, result) {
        if (err) {
            var name = { name: "fabmo-?" };
            // this is an indication of a bad name from config file
            config.engine.update(name, function () {
                callback(name);
            });
        } else {
            ////## Get Serial Number for name and clear out 0's to simplfy; do this here rather than later
            // At some point, might want to stick to just the first batch of 0's
            log.debug("At RPI naming from SerialNum - ");
            result = result.split("0").join("").split("\n").join("").trim();
            log.debug("modifiedSerial- " + result);
            name = { name: "FabMo-" + result };
            config.engine.update(name, function () {
                callback(name);
            });
        }
    });
};

// return an object containing {ipaddress:'',mode:''}
//   interface - Interface name to get the info for
//    callback - Called back with the info or error if there was an error
RaspberryPiNetworkManager.prototype.getInfo = function (interface, callback) {
    ifconfig.status(interface, function (err, ifstatus) {
        if (err) return callback(err);
        iwconfig.status(interface, function (err, iwstatus) {
            if (err) return callback(err);
            callback(null, {
                ssid: iwstatus.ssid || "<Unknown>",
                ipaddress: ifstatus.ipv4_address,
                mode: iwstatus.mode,
            });
        });
    });
};

RaspberryPiNetworkManager.prototype.getWifiIp = function (ssid, callback) {
    const getIpCommand = `nmcli -t -f IP4.ADDRESS dev show wlan0`;
    exec(getIpCommand, (err, stdout, stderr) => {
        if (err) {
            console.error(`Error getting IP address: ${stderr}`);
            return callback(err);
        }
        const ipAddress = stdout.trim().split("/")[0]; // Extract the IP address
        if (ipAddress) {
            callback(null, ipAddress);
        } else {
            callback(new Error("IP address not found"), null);
        }
    });
};

// Return a list of IP addresses (the local IP for all interfaces)
RaspberryPiNetworkManager.prototype.getLocalAddresses = function () {
    var retval = [];
    // eslint-disable-next-line no-undef
    interface.array.forEach((interface) => {
        retval.push(interface[0].address);
    });
    retval.shift();
    return retval;
};

//=========================================================================================

// Get the current "scan results"
// (A list of wifi networks that are visible to this client)
//   callback - Called with the network list or with an error if error
RaspberryPiNetworkManager.prototype.getNetworks = function (callback) {
    exec("nmcli -t -f IN-USE,BSSID,SSID,SIGNAL,SECURITY dev wifi", (err, stdout, stderr) => {
        if (err) {
            callback(err);
            return;
        }
        const networks = stdout
            .split("\n")
            .filter(Boolean)
            .map((line) => {
                const match = line.match(/([^:]*):((?:[^:\\]|\\.)*):((?:[^:\\]|\\.)*):([^:]*):(.*)/);
                if (!match) {
                    return null;
                }
                const [, inUse, bssid, ssid, signal, security] = match;
                let signalLevel = parseInt(signal, 10);
                signalLevel = isNaN(signalLevel) ? 0 : signalLevel; // default to 0 if not a number
                return {
                    bssid: bssid.replace(/\\/g, ""), // remove backslashes
                    ssid: ssid.replace(/\\/g, ""),
                    signalLevel,
                    flags: security,
                };
            })
            .filter(Boolean); // remove nulls

        callback(null, networks);
    });
};

// Intiate a wifi network scan (site survey)
//   callback - Called when scan is complete (may take a while) or with error if error
RaspberryPiNetworkManager.prototype.scan = function (callback) {
    exec("nmcli dev wifi rescan", (err, stdout, stderr) => {
        if (err) {
            callback(err);
            return;
        }
        callback(null);
    });
};

RaspberryPiNetworkManager.prototype.returnWifiNetworks = function () {
    this.scan(
        // eslint-disable-next-line no-unused-vars
        function (err, data) {
            if (!err) {
                this.getNetworks(
                    function (err, data) {
                        if (!err) {
                            this.networks = [];
                            var new_network_names = [];
                            for (var i in data) {
                                var ssid = data[i].ssid;
                                var found = false;
                                for (var j in this.networks) {
                                    if (this.networks[j].ssid === ssid) {
                                        found = true;
                                        break;
                                    }
                                }
                                if (!found) {
                                    new_network_names.push(ssid);
                                    this.networks.push(data[i]);
                                }
                            }
                        }
                    }.bind(this)
                );
            }
        }.bind(this)
    );
};

RaspberryPiNetworkManager.prototype.checkWifiHealth = function () {
    var interfaces = os.networkInterfaces();

    this.network_history = {};
    Object.keys(interfaces).forEach(
        function (interface) {
            if (interface !== "lo") {
                if (interfaces[interface]) {
                    this.network_history[interface] = interfaces[interface][0].address;
                }
            }
        }.bind(this)
    );

    // Check if wlan0 exists and get current SSID from system
    if (interfaces.wlan0) {
        exec("nmcli -t -f active,ssid dev wifi | grep '^yes' | cut -d: -f2", (err, stdout) => {
            if (!err && stdout.trim()) {
                const fullOutput = stdout.trim();
                const currentSSID = fullOutput.split("\n")[0]; // Get only the first line (WiFi SSID)

                // Store only the clean SSID for network_history
                this.network_history.wlan0 = this.network_history.wlan0 + "," + currentSSID;

                // Log the full output for debugging
                // log.debug("Full nmcli output: " + fullOutput);
                // log.debug("Extracted WiFi SSID: " + currentSSID);
            }
        });
    }
};

RaspberryPiNetworkManager.prototype.confirmIP = function (callback) {
    var wlan0Int;
    var attempts = 20; //15; //30; //60    // time it takes to chek for IP
    var counter = 0;
    var interval = setInterval(function () {
        var interfaces = os.networkInterfaces();
        wlan0Int = interfaces.wlan0;

        if (counter == attempts || wlan0Int) {
            if (counter == attempts) {
                var error = "Error connecting, please try again";
                clearInterval(interval);
                callback(error);
            } else {
                if (wlan0Int[0].family === "IPv6") {
                    counter++;
                } else {
                    clearInterval(interval);
                    callback(null, wlan0Int[0].address);
                }
            }
        } else {
            counter++;
        }
    }, 1000);
};

// Turns off all Wifi; this includes AP and Station modes (may not want to use)
RaspberryPiNetworkManager.prototype._disableWifi = function (callback) {
    log.info("Disabling wifi...");
    async.series(
        [
            // Stop the hostapd service
            function (callback) {
                exec("systemctl stop hostapd", function (err, result) {
                    if (err) {
                        log.warn(`Error stopping hostapd: ${err}`);
                        callback(err);
                    } else {
                        callback(null, result);
                    }
                });
            },
            // Disable the WiFi interface using nmcli
            function (callback) {
                exec(`nmcli radio wifi off`, function (err, result) {
                    if (err) {
                        log.warn(`Error disabling wifi with nmcli: ${err}`);
                        callback(err);
                    } else {
                        callback(null, result);
                    }
                });
            },
            // Bring down the WiFi interface using ifconfig
            function (callback) {
                ifconfig.down("wlan0", function (err, result) {
                    if (err) {
                        log.warn(`Error bringing down wifi interface: ${err}`);
                        callback(err);
                    } else {
                        log.info("Wifi disabled.");
                        callback(null, result);
                    }
                });
            },
        ],
        function (err, results) {
            callback(err, results);
        }
    );
};

// Join a WiFi network
RaspberryPiNetworkManager.prototype.joinWifiNetwork = function (ssid, password, callback) {
    log.info(`Joining WiFi network: ${ssid}`);
    commands.joinWifiNetwork(ssid, password, (err, result) => {
        if (err) {
            log.error(`Failed to join WiFi network ${ssid}:`, err);
            return callback(err);
        }
        log.info(`Successfully joined WiFi network ${ssid}`);
        // Store SSID in network_history with a different key
        this.network_history.current_ssid = ssid;
        // Or create a comma-separated list
        if (!this.network_history.ssid_list) {
            this.network_history.ssid_list = ssid;
        } else {
            // Avoid duplicates
            const ssids = this.network_history.ssid_list.split(", ");
            if (!ssids.includes(ssid)) {
                this.network_history.ssid_list = ssid + ", " + this.network_history.ssid_list;
            }
        }
        callback(null, result);
    });
};

// Forget a WiFi network
RaspberryPiNetworkManager.prototype.forgetWifi = function (ssid, callback) {
    log.info(`Forgetting WiFi network: ${ssid}`);
    commands.forgetWifiNetwork(ssid, (err, result) => {
        if (err) {
            log.error(`Failed to forget WiFi network ${ssid}:`, err);
            return callback(err);
        }
        log.info(`Successfully forgot WiFi network ${ssid}`);
        callback(null, result);
    });
};

//=========================================================================================

// Do the actual work of dropping out of AP mode
//   callback - Callback called when AP mode has been exited or with error if error
RaspberryPiNetworkManager.prototype._unjoinAP = function (callback) {
    commands.stopAP((err) => {
        if (err) {
            log.error("Failed to stop AP mode:", err);
            return callback(err);
        }
        log.info("AP mode stopped successfully.");
        //this.takeDown("wlan0_ap", callback); // Ensure this does not conflict with stopAP
    });
};

// Do actual work of restarting AP mode (this is the workhorse function)
//   callback - Callback called when AP mode has been entered or with error if error
RaspberryPiNetworkManager.prototype._joinAP = function (callback) {
    // eslint-disable-next-line no-unused-vars
    commands.startAP((err, result) => {
        if (err) {
            return callback(err);
        }
    });
};

// Apply the wifi configuration.  If in AP, drop out of AP (and wifi config will be applied automatically)
// If in station mode, join the wifi network specified in the network configuration.
// Function returns immediately
RaspberryPiNetworkManager.prototype.applyWifiConfig = function () {
    var network_config = config.engine.get("network");
    switch (network_config.wifi.mode) {
        case "ap":
            this._unjoinAP();
            break;
        case "station":
            if (network_config.wifi.wifi_networks.length > 0) {
                var network = network_config.wifi.wifi_networks[0];
                this.joinWifi(network.ssid, network.password);
            } else {
                log.warn("No wifi networks defined.");
            }
            break;
        case "off":
            this.disableWifi();
            break;
    }
};

/*
 * PUBLIC API BELOW HERE
 */

// Initialize the network manager.  This kicks off the state machines that process commands from here on out
// Programmatically speaking, this is the entry point for the network manager; DO REGULAR CHECKS !
RaspberryPiNetworkManager.prototype.init = function () {
    let apModeEnabled = config.engine.get("network").wifi.enabled;
    if (apModeEnabled === undefined) {
        apModeEnabled = true; // Default to enabled
        const networkConfig = config.engine.get("network") || {};
        networkConfig.wifi = networkConfig.wifi || {};
        networkConfig.wifi.enabled = true; // Default to true
        config.engine.set("network", networkConfig, (err) => {
            if (err) {
                console.error("Failed to update network configuration:", err);
            } else {
                console.log("Network configuration updated successfully.");
            }
        });
    }

    if (apModeEnabled) {
        log.info("AP mode is enabled. Starting AP...");
        this._joinAP((err) => {
            if (err) {
                log.error("Failed to start AP mode on boot:", err);
            } else {
                log.info("AP mode started successfully on boot.");
            }
        });
    } else {
        log.info("AP mode is disabled. Not starting AP on boot.");
    }

    setInterval(() => {
        this.returnWifiNetworks();
        this.checkWifiHealth();
    }, 10000);
};

// Get a list of the available wifi networks.  (The "scan results")
//   callback - Called with list of wifi networks or error if error
RaspberryPiNetworkManager.prototype.getAvailableWifiNetworks = function (callback) {
    callback(null, this.networks);
};

// Enable the wifi
//   callback - Called when wifi is enabled or with error if error
RaspberryPiNetworkManager.prototype.turnWifiOn = function (callback) {
    log.info("Turning on Wifi...");
    commands.startWifi((err, result) => {
        if (err) {
            log.error("Failed to turn on Wifi:", err);
            return callback(err);
        }
        log.info("Wifi turned on successfully");
        callback(null, result);
    });
};

// Disable the wifi
//   callback - Called when wifi is disabled or with error if error
// eslint-disable-next-line no-unused-vars
RaspberryPiNetworkManager.prototype.turnWifiOff = function (callback) {
    log.info("Turning off Wifi...");
    commands.stopWifi((err, result) => {
        if (err) {
            log.error("Failed to turn off Wifi:", err);
            return callback(err);
        }
        log.info("Wifi turned off successfully");
        callback(null, result);
    });
};

// Get the history of connected wifi networks
//   callback - Called with a list of networks
RaspberryPiNetworkManager.prototype.getWifiHistory = function (callback) {
    callback(null, this.network_history);
};

// Check that radio harware is ON
RaspberryPiNetworkManager.prototype.isWifiOn = function (callback) {
    exec("nmcli radio wifi", (error, stdout, stderr) => {
        if (error) {
            console.error(`exec error: ${error}`);
            return callback(error, null);
        }
        // a simplistic check; adjust based on actual command output
        if (stdout.trim() === "enabled") {
            callback(null, true);
        } else {
            callback(null, false);
        }
    });
};

// Enable AP mode
RaspberryPiNetworkManager.prototype.enableWifiHotspot = function (callback) {
    log.info("Turning ON AP mode...");
    this._joinAP((err) => {
        if (!err) {
            log.info("AP mode enabled successfully.");
        }
        callback(err);
    });
};

RaspberryPiNetworkManager.prototype.disableWifiHotspot = function (callback) {
    log.info("Turning OFF AP mode...");
    this._unjoinAP((err) => {
        if (!err) {
            log.info("AP mode disabled successfully.");
        }
        callback(err);
    });
};

// Get network status
RaspberryPiNetworkManager.prototype.getStatus = function (callback) {
    ifconfig.status(callback);
};

// Set the network identity
// This sets the hostname, SSID to `name` and the root password/network key to `password`
//    identity - Object of this format {name : 'thisismyname', password : 'thisismypassword'}
//               Identity need not contain both values - only the values specified will be changed
//    callback - Called when identity has been changed or with error if error
RaspberryPiNetworkManager.prototype.setIdentity = function (identity, callback) {
    async.series(
        [
            function set_name(callback) {
                if (identity.name) {
                    log.info("Setting network name to " + identity.name);
                } else {
                    callback(null);
                }
            }.bind(this),

            function set_name_config(callback) {
                if (identity.name) {
                    config.engine.set("name", identity.name, callback);
                } else {
                    callback(null);
                }
            }.bind(this),

            function set_password(callback) {
                if (identity.password) {
                    log.info("Setting network password to " + identity.password);
                } else {
                    callback(null);
                }
            }.bind(this),

            function set_password_config(callback) {
                if (identity.password) {
                    config.engine.set("password", identity.password, callback);
                } else {
                    callback(null);
                }
            }.bind(this),
        ],

        // eslint-disable-next-line no-unused-vars
        function (err, results) {
            if (err) {
                log.error(err);
                typeof callback === "function" && callback(err);
            } else {
                typeof callback === "function" && callback(null, this);
            }
        }.bind(this)
    );
};

// Check to see if this host is connected to the internet
//   callback - Called back with the online state, or with error if error
RaspberryPiNetworkManager.prototype.isOnline = function (callback) {
    dns.resolve("google.com", (err) => {
        if (err) {
            console.error("No internet connection:", err);
            callback(err, false); // Not online
        } else {
            console.log("Internet connection is active.");
            callback(null, true); // Online
        }
    });
};

// Take the configuration stored in the network config and apply it to the currently running instance
// This function returns immediately
RaspberryPiNetworkManager.prototype.applyNetworkConfig = function () {
    this.applyWifiConfig();
    // TODO - Why is this commented out?
    // this.applyEthernetConfig();
};

exports.NetworkManager = RaspberryPiNetworkManager;
