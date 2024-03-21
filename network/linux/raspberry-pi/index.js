var log = require("../../../log").logger("network");
var os = require("os");
var fs = require("fs");
var config = require("../../../config");
var async = require("async");
var child_process = require("child_process");
var exec = child_process.exec;
var util = require("util");
var NetworkManager = require("../../../network_manager").NetworkManager;
// TODO:  Add networking logging instead of useing console.log

var ifconfig = require("wireless-tools/ifconfig");
var iwconfig = require("wireless-tools/iwconfig");
var wpa_cli = require("wireless-tools/wpa_cli");
var udhcpc = require("wireless-tools/udhcpc");

const commands = require("./commands.js");

var wifiInterface = "wlan0"; // test assigning wlan1 to wifiInterface ???
var ethernetInterface = "eth0";

//var last_name = "";

// eslint-disable-next-line no-unused-vars
var CUR_UAP0_SSID = "";

var DEFAULT_NETMASK = "255.255.255.0";
var DEFAULT_BROADCAST = "192.168.1.255";
// This is how long the system will wait for DHCP before going into "magic mode" (ms)
var DHCP_MAGIC_TTL = 5000;
var ETHERNET_SCAN_INTERVAL = 2000;
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
    exec(
        "cat /proc/cpuinfo | grep Serial | cut -d ' ' -f 2",
        function (err, result) {
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
        }
    );
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

// Get the current "scan results"
// (A list of wifi networks that are visible to this client)
//   callback - Called with the network list or with an error if error
RaspberryPiNetworkManager.prototype.getNetworks = function (callback) {
    wpa_cli.scan_results(wifiInterface, callback);
};

// Intiate a wifi network scan (site survey)
//   callback - Called when scan is complete (may take a while) or with error if error
RaspberryPiNetworkManager.prototype.scan = function (callback) {
    wpa_cli.scan(wifiInterface, callback);
};

RaspberryPiNetworkManager.prototype.returnWifiNetworks = function () {
    this.scan(
        // eslint-disable-next-line no-unused-vars
        function (err, data) {
            if (!err) {
                this.getNetworks(
                    function (err, data) {
                        if (!err) {
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

// Check SSID of the current uap0 interface; then call final name-check and joinAP if needed
RaspberryPiNetworkManager.prototype._checkSSID = function (callback) {
    exec("iw uap0 info | grep ssid", (error, stdout, stderr) => {
        if (error) {
            log.error(`Execution error: ${error}`);
            CUR_UAP0_SSID = "";
            //                callback(null)
            //                return;
        } else if (stderr) {
            log.error(`Error: ${stderr}`);
            CUR_UAP0_SSID = "";
            //                callback(null)
            //                return;
        } else {
            log.debug(`Current SSID of uap0: ${stdout}`);
            // Check if the result is what we expect before replacing
            if (stdout.includes("ssid")) {
                // clean up ssid value by removing "ssid" and blanks
                CUR_UAP0_SSID = stdout.replace(/ssid\s*/i, "").trim();
                //                    let CUR_UAP0_SSID = stdout.replace(/ssid\s*/i, "").trim();
                //                log.debug("NEXT LINE IS FIRST READ OF CUR_UAP0_SSID");
                //                log.debug(CUR_UAP0_SSID);
            } else {
                log.debug("Unexpected result:", stdout);
            }
        }
        callback(
            this._joinAP(function (err) {
                if (err) {
                    log.warn("Could not bring back up AP");
                } else {
                    log.info("AP back up after responding to relevant change");
                }
            })
        );
    });
};

RaspberryPiNetworkManager.prototype.checkWifiHealth = function () {
    var interfaces = os.networkInterfaces();
    // var wlan0Int = interfaces.wlan0;
    // var apInt = interfaces.uap0;
    //var wiredInt = "eth0";
    log.debug("##############-------- >>>>>> CALL to checkWifiHealth");

    //    log.debug("##-------------------- >> Initial Screen");
    // Cases below should force us to consider updating the AP SSID
    // if (
    //     !this.network_history || // first time through
    //     (!this.network_history[wiredInt] && // no history
    //         interfaces[wiredInt]?.[0]?.address) ||
    //     (this.network_history[wiredInt] && !interfaces[wiredInt]) || //
    //     (this.network_history[wiredInt] &&
    //         interfaces[wiredInt] && // we have history and a current value, BUT...
    //         this.network_history[wiredInt] != interfaces[wiredInt][0].address) // ... they are different
    // ) {
    //     //        var forceSSIDupdate = 1;
    //     //        log.debug("##-------------got a FORCED UPDATE");
    // }

    //    log.debug("##-------------------- >> Update History for Re-Screen");
    this.network_history = {};
    Object.keys(interfaces).forEach(
        function (interface) {
            if (interface !== "lo") {
                if (interfaces[interface]) {
                    this.network_history[interface] =
                        interfaces[interface][0].address;
                }
            }
        }.bind(this)
    );
    // Check if wlan0 exists and get ssid from outside file if so
    if (interfaces.wlan0) {
        log.debug("wlan0 interface found");
        // Read the JSON file to get the SSID name
        const filePath = "/etc/network_conf_fabmo/recent_wifi.json";
        const data = fs.readFileSync(filePath, "utf8"); // Read file as a string
        const json = JSON.parse(data);
        const ssid = json.ssid;
        this.network_history.wlan0 = this.network_history.wlan0 + " ," + ssid;
        log.debug("SSID:", this.network_history.wlan0);
    } else {
        log.debug(
            "wlan0 interface not found or it does not have an IP address"
        );
    }
};

RaspberryPiNetworkManager.prototype.checkEthernetHealth = function () {
    ifconfig.status(ethernetInterface, function (err, status) {
        if (err) {
            log.error(err);
        } else {
            log.info(status);
        }
    });
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

// // Actually do the work of joining AP mode AND updating AP name
// RaspberryPiNetworkManager.prototype._joinAP = function (
//     callback,
//     CUR_UAP0_SSID
// ) {
//     var interfaces = os.networkInterfaces();
//     var wlan0Int = interfaces.wlan0;
//     var eth0Int = interfaces.eth0;
//     var name = config.engine.get("name"); // should already be simplified
//     //var name = config.engine.get('name').split('0').join('').split('\n').join('').trim();
//     var full_name;
//     var ext;

//     // Updating AP-Name
//     // Then, restarting AP if we get name change; this should drop AP momentarily!
//     ext = ":";
//     if (eth0Int) {
//         ext = ext + eth0Int[0].address;
//     } else if (wlan0Int) {
//         ext = ext + wlan0Int[0].address;
//     } else {
//         ext = ">AP:192.168.42.1";
//     }
//     full_name = name + ext;
//     //    log.debug("CHECKING NAMES full_name: " + full_name);
//     //    log.debug("CHECKING NAMES last_name: " + last_name);
//     if (
//         full_name !== last_name ||
//         (CUR_UAP0_SSID &&
//             (!CUR_UAP0_SSID.includes(":") ||
//                 CUR_UAP0_SSID === "FabMo-???>AP:192.168.42.1" ||
//                 full_name != CUR_UAP0_SSID))
//     ) {
//         //        log.debug("///////////###-------- >>>>>> CALL REJOIN-AP");
//         log.debug(
//             'Changing SSID from "' + last_name + '" to "' + full_name + '"'
//         );
//         // SSID is limited to 32 char; so makes long names challenging, as in:
//         // 'ted-dev:169.254.225.224:192.168.1.109'
//         // So best to prioritize display for ethernet, until a better idea ...
//         //     TODO: chop tool names that are too long
//         var network_config = config.engine.get("network");
//         network_config.wifi.mode = "ap";
//         config.engine.set("network", network_config);
//         commands.takeDown("uap0", (err, result) => {
//             log.debug("taken down AP");
//             console.log(err);
//             console.log(result);
//             commands.addApInterface((err, result) => {
//                 log.debug("Adding AP int");
//                 console.log(err);
//                 console.log(result);
//                 commands.bringUp("uap0", (err, result) => {
//                     log.debug("bringing up");
//                     console.log(err);
//                     console.log(result);
//                     commands.configureApIp("192.168.42.1", (err, result) => {
//                         log.debug("configure");
//                         console.log(err);
//                         console.log(result);
//                         commands.hostapd(
//                             {
//                                 ssid: full_name,
//                             },
//                             () => {
//                                 log.debug("hostAPD up");
//                                 //   commands.dnsmasq({ interface: "uap0" }, () => {
//                                 //       console.log("should be up and running AP");
//                                 //       callback(err, result);
//                                 //   });
//                             }
//                         );
//                     });
//                 });
//             });
//         });
//     }
//     last_name = full_name;
// };

RaspberryPiNetworkManager.prototype._disableWifi = function (callback) {
    log.info("Disabling wifi...");
    // eslint-disable-next-line no-unused-vars
    exec("systemctl stop hostapd wpa_supplicant", function (err, result) {
        if (err) log.warn(err);
        ifconfig.down(wifiInterface, function (err, result) {
            if (!err) {
                log.info("Wifi disabled.");
            }
            callback(err, result);
        });
    });
};

RaspberryPiNetworkManager.prototype._joinWifi = function (
    ssid,
    password,
    callback
) {
    var network_config = config.engine.get("network");
    network_config.wifi.mode = "station";
    network_config.wifi.wifi_networks = [{ ssid: ssid, password: password }];
    config.engine.set("network", network_config);
    var PSK = password;
    var SSID = ssid;
    exec(
        "wpa_cli -i wlan0 add_network",
        // eslint-disable-next-line no-unused-vars
        function (error, stdout, stderr) {
            if (error !== null) {
                console.log("error: " + error);
            } else {
                async.series(
                    [
                        function (callback) {
                            exec(
                                "wpa_cli  -i wlan0 set_network 0 ssid '\"" +
                                    SSID +
                                    "\"'",
                                function (error, stdout) {
                                    if (error) {
                                        console.error(error);
                                    } else {
                                        console.log("SSID result: " + stdout);
                                        callback(null, stdout);
                                    }
                                }
                            );
                        },
                        function (callback) {
                            exec(
                                "wpa_cli -i wlan0 set_network 0 psk '\"" +
                                    PSK +
                                    "\"'",
                                function (error, stdout) {
                                    if (error) {
                                        console.error(error);
                                    } else {
                                        console.log("PSK result: " + stdout);
                                        callback(null, stdout);
                                    }
                                }
                            );
                        },
                        function (callback) {
                            exec(
                                "wpa_cli -i wlan0 enable_network 0",
                                function (error, stdout) {
                                    if (error) {
                                        console.error(error);
                                    } else {
                                        console.log(
                                            "enable_network result: " + stdout
                                        );
                                        callback(null, stdout);
                                    }
                                }
                            );
                        },
                        function (callback) {
                            exec(
                                "wpa_cli -i wlan0 save_config",
                                function (error, stdout) {
                                    if (error) {
                                        console.error(error);
                                    } else {
                                        console.log(
                                            "save_config result: " + stdout
                                        );
                                        callback(null, stdout);
                                    }
                                }
                            );
                        },
                    ],
                    // eslint-disable-next-line no-unused-vars
                    function (errs, results) {
                        if (errs) throw errs; // errs = [err1, err2, err3]
                        exec(
                            "wpa_cli -i wlan0 reconfigure",
                            // eslint-disable-next-line no-unused-vars
                            function (error, stdout) {
                                if (error) {
                                    log.error(error);
                                } else {
                                    this.confirmIP((err, ipaddress) => {
                                        if (err) {
                                            callback(err);
                                        } else {
                                            var wifiInfo = {
                                                ssid: SSID,
                                                ip: ipaddress,
                                            };
                                            callback(null, wifiInfo);
                                        }
                                    });
                                }
                            }.bind(this)
                        );
                    }.bind(this)
                );
            }
        }.bind(this)
    );
};

// Do the actual work of dropping out of AP mode
//   callback - Callback called when AP mode has been exited or with error if error
RaspberryPiNetworkManager.prototype._unjoinAP = function (callback) {
    log.info("Turning off AP mode...");
    // eslint-disable-next-line no-unused-vars
    commands.stopAP((err, result) => {
        if (err) {
            callback(err);
        } else {
            commands.takeDown("uap0", (err, result) => {
                callback(err, result);
            });
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
            this.unjoinAP();
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
            // TODO - discuss about this issue. it may be not recommended to do this as a
            //        reboot would remove wifi and the tool would be lost if you don't have a ethernet access.
            // ;this.disableWifi();
            break;
    }
};

/*
 * PUBLIC API BELOW HERE
 */

// Initialize the network manager.  This kicks off the state machines that process commands from here on out
RaspberryPiNetworkManager.prototype.init = function () {
    setInterval(() => {
        this.returnWifiNetworks();
        this.checkWifiHealth();
        // this.checkEthernetHealth();
        // this.runEthernet();
    }, 10000);
};

// Get a list of the available wifi networks.  (The "scan results")
//   callback - Called with list of wifi networks or error if error
RaspberryPiNetworkManager.prototype.getAvailableWifiNetworks = function (
    callback
) {
    // TODO should use setImmediate here
    callback(null, this.networks);
};

// Connect to the specified wifi network.
//   ssid - The network ssid to connect to
//    key - The network key
RaspberryPiNetworkManager.prototype.connectToAWifiNetwork = function (
    ssid,
    key,
    callback
) {
    // TODO a callback is passed here, but is not used.  If this function must have a callback, we should setImmediate after issuing the wifi command
    this._joinWifi(ssid, key, callback);
};

// Stubbing this in as a new forget function based on some stubbs already in place for call
// Forget a specified wifi network.
//   ssid - The network ssid to connect to
//    key - The network key
RaspberryPiNetworkManager.prototype.forgetAWifiNetwork = function (
    ssid,
    key,
    callback
) {
    // TODO a callback is passed here, but is not used.  If this function must have a callback, we should setImmediate after issuing the wifi command
    this._forgetWifi(ssid, key, callback);
};

// Enable the wifi
//   callback - Called when wifi is enabled or with error if error
RaspberryPiNetworkManager.prototype.turnWifiOn = function (callback) {
    ifconfig.status(
        wifiInterface,
        function (err, status) {
            if (!status.up) {
                ifconfig.up(
                    wifiInterface,
                    // eslint-disable-next-line no-unused-vars
                    function (err, data) {
                        callback(err);
                    }.bind(this)
                );
            } else {
                callback();
            }
        }.bind(this)
    );
};

// Disable the wifi
//   callback - Called when wifi is disabled or with error if error
// eslint-disable-next-line no-unused-vars
RaspberryPiNetworkManager.prototype.turnWifiOff = function (callback) {
    this.disableWifi();
};

// Get the history of connected wifi networks
//   callback - Called with a list of networks
RaspberryPiNetworkManager.prototype.getWifiHistory = function (callback) {
    callback(null, this.network_history);
};

// Enter AP mode
//   callback - Called once the command has been issued (but does not wait for the system to enter AP)
RaspberryPiNetworkManager.prototype.turnWifiHotspotOn = function (callback) {
    log.info("Going to turn wifi hotspot");
    this.joinAP();
    callback(null);
};

// Get network status
//   callback - Called with network status or with error if error
RaspberryPiNetworkManager.prototype.getStatus = function (callback) {
    ifconfig.status(callback);
};

// Set the network identity
// This sets the hostname, SSID to `name` and the root password/network key to `password`
//    identity - Object of this format {name : 'thisismyname', password : 'thisismypassword'}
//               Identity need not contain both values - only the values specified will be changed
//    callback - Called when identity has been changed or with error if error
RaspberryPiNetworkManager.prototype.setIdentity = function (
    identity,
    callback
) {
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
                    log.info(
                        "Setting network password to " + identity.password
                    );
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

// Check to see if this host is online
//   callback - Called back with the online state, or with error if error
RaspberryPiNetworkManager.prototype.isOnline = function (callback) {
    setImmediate(callback, null, this.mode === "station");
};

// Turn the ethernet interface on
//   callback - Called when the ethernet interface is up or with error if error
RaspberryPiNetworkManager.prototype.turnEthernetOn = function (callback) {
    ifconfig.up(ethernetInterface, callback);
};

// Turn the ethernet interface off
//   callback - Called when the ethernet interface is up or with error if error
RaspberryPiNetworkManager.prototype.turnEthernetOff = function (callback) {
    ifconfig.down(ethernetInterface, callback);
};

// Enable DHCP for the provided interface
//   interface - The interface to update
//   callback - Called when complete, or with error if error
RaspberryPiNetworkManager.prototype.enableDHCP = function (
    interface,
    callback
) {
    log.debug("Enabling DHCP on " + interface);
    udhcpc.enable({ interface: interface }, callback);
};

// Disable DHCP for the provided interface
//   interface - The interface to update
//    callback - Called when complete, or with error if error
RaspberryPiNetworkManager.prototype.disableDHCP = function (
    interface,
    callback
) {
    log.debug("Disabling DHCP on " + interface);
    udhcpc.disable(interface, callback);
};

// Start the internal DHCP server on the provided interface
//   interface - The interface on which to start the DHCP server
//    callback - Called when the DHCP server has been started, or with error if error
RaspberryPiNetworkManager.prototype.startDHCPServer = function () /* interface,
    callback */
{
    // rmackie: invocation of udhcpd removed because this is now handled by the OS and R-Pi UI
};

// Stop the internal DHCP server on the provided interface
//   interface - The interface on which to stop the DHCP server
//    callback - Called when the DHCP server has been stopped, or with error if error
RaspberryPiNetworkManager.prototype.stopDHCPServer = function () /* interface,
    callback */
{
    // rmackie: deliberately removed code - this is now handled by the OS services and the
    // rotary switch
};

// Set the ip address for the provided interface to the provided value
//   interface - The interface to update
//          ip - The IP address, eg: '192.168.44.50'
//    callback - Called when the address has been set or with error if error
RaspberryPiNetworkManager.prototype.setIpAddress = function (
    interface,
    ip,
    callback
) {
    if (!ip) return callback("no ip specified !");
    ifconfig.status(interface, function (err, status) {
        if (err) return callback(err, status);
        var options = {
            interface: interface,
            ipv4_address: ip,
            ipv4_broadcast: status.ipv4_broadcast || DEFAULT_BROADCAST,
            ipv4_subnet_mask: status.ipv4_subnet_mask || DEFAULT_NETMASK,
        };
        ifconfig.up(options, callback);
    });
};

// Set the netmask for the provided interface to the provided value
//   interface - The interface to update
//     netmask - The netmask, eg: '255.255.255.0'
//    callback - Called when the netmask has been set or with error if error
RaspberryPiNetworkManager.prototype.setNetmask = function (
    interface,
    netmask,
    callback
) {
    if (!netmask) return callback("no netmask specified !");
    ifconfig.status(interface, function (err, status) {
        if (err) return callback(err, status);
        if (!status.ipv4_address)
            return callback("interface ip address not configured !");
        var options = {
            interface: interface,
            ipv4_address: status.ipv4_address,
            ipv4_broadcast: netmask,
            ipv4_subnet_mask: status.ipv4_subnet_mask || DEFAULT_NETMASK,
        };
        ifconfig.up(options, callback);
    });
};
// Set the gateway IP for the provided interface to the provided value
//   interface - The interface to update
//     gateway - The gateway, eg: '255.255.255.0'
//    callback - Called when the gateway has been set or with error if error
RaspberryPiNetworkManager.prototype.setGateway = function (gateway, callback) {
    // eslint-disable-next-line no-unused-vars
    exec("route add default gw " + gateway, function (s) {
        callback(null);
    });
};

// Take the configuration stored in the network config and apply it to the currently running instance
// This function returns immediately
RaspberryPiNetworkManager.prototype.applyNetworkConfig = function () {
    this.applyWifiConfig();
    // TODO - Why is this commented out?
    // this.applyEthernetConfig();
};

// Take the ethernet configuration stored in the network config and apply it to the currently running instance
// TODO - Cleanup indentation below
// This function returns immediately (but takes a while to complete)
RaspberryPiNetworkManager.prototype.applyEthernetConfig = function () {
    var self = this;
    var ethernet_config = config.engine.get("network").ethernet;
    ifconfig.status(
        ethernetInterface,
        function (err, status) {
            if (status.up && status.running) {
                async.series(
                    [
                        self.disableDHCP.bind(this, ethernetInterface),
                        self.stopDHCPServer.bind(this, ethernetInterface),
                    ],
                    // eslint-disable-next-line no-unused-vars
                    function (err, results) {
                        if (err) {
                            log.warn(err);
                        }
                        this.emit("network", { mode: "ethernet" });
                        log.info(
                            "ethernet is in " + ethernet_config.mode + " mode"
                        );
                        switch (ethernet_config.mode) {
                            case "static":
                                async.series(
                                    [
                                        self.setIpAddress.bind(
                                            this,
                                            ethernetInterface,
                                            ethernet_config.default_config
                                                .ip_address
                                        ),
                                        self.setNetmask.bind(
                                            this,
                                            ethernetInterface,
                                            ethernet_config.default_config
                                                .netmask
                                        ),
                                        self.setGateway.bind(
                                            this,
                                            ethernet_config.default_config
                                                .gateway
                                        ),
                                    ],
                                    // eslint-disable-next-line no-unused-vars
                                    function (err, results) {
                                        if (err) log.warn(err);
                                        else
                                            log.info(
                                                "Ethernet static configuration is set"
                                            );
                                    }
                                );
                                break;

                            case "dhcp":
                                self.enableDHCP(
                                    ethernetInterface,
                                    function (err) {
                                        if (err) return log.warn(err);
                                        log.info(
                                            "Ethernet dynamic configuration is set"
                                        );
                                    }
                                );
                                break;

                            case "magic":
                                self.enableDHCP(
                                    ethernetInterface,
                                    // eslint-disable-next-line no-unused-vars
                                    function (err) {
                                        setTimeout(
                                            function () {
                                                ifconfig.status(
                                                    ethernetInterface,
                                                    function (err, status) {
                                                        if (err) log.warn(err);
                                                        if (
                                                            status.ipv4_address !==
                                                            undefined
                                                        ) {
                                                            // we got a lease !
                                                            this.networkInfo.wired =
                                                                status.ipv4_address;
                                                            log.info(
                                                                "[magic mode] An ip address was assigned to the ethernet interface : " +
                                                                    status.ipv4_address
                                                            );
                                                            return;
                                                        } else {
                                                            // no lease, stop the dhcp client, set a static config and launch a dhcp server.
                                                            async.series(
                                                                [
                                                                    self.disableDHCP.bind(
                                                                        this,
                                                                        ethernetInterface
                                                                    ),
                                                                    self.setIpAddress.bind(
                                                                        this,
                                                                        ethernetInterface,
                                                                        ethernet_config
                                                                            .default_config
                                                                            .ip_address
                                                                    ),
                                                                    self.setNetmask.bind(
                                                                        this,
                                                                        ethernetInterface,
                                                                        ethernet_config
                                                                            .default_config
                                                                            .netmask
                                                                    ),
                                                                    self.setGateway.bind(
                                                                        this,
                                                                        ethernet_config
                                                                            .default_config
                                                                            .gateway
                                                                    ),
                                                                    self.startDHCPServer.bind(
                                                                        this,
                                                                        ethernetInterface
                                                                    ),
                                                                ],
                                                                function (
                                                                    err,
                                                                    // eslint-disable-next-line no-unused-vars
                                                                    results
                                                                ) {
                                                                    if (err)
                                                                        log.warn(
                                                                            err
                                                                        );
                                                                    else
                                                                        log.info(
                                                                            "[magic mode] No dhcp server found, switched to static configuration and launched a dhcp server..."
                                                                        );
                                                                }
                                                            );
                                                        }
                                                    }.bind(this)
                                                );
                                            }.bind(this),
                                            DHCP_MAGIC_TTL
                                        );
                                    }.bind(this)
                                );
                                break;

                            case "off":
                            default:
                                break;
                        }
                    }.bind(this)
                );
            }
        }.bind(this)
    );
};

// This function is the main process for ethernet.
// Basically, it looks for media to be plugged or unplugged, and applies the correct
// configuration accordingly.
RaspberryPiNetworkManager.prototype.runEthernet = function () {
    function checkEthernetState() {
        var oldState = this.ethernetState;
        ifconfig.status(
            ethernetInterface,
            function (err, status) {
                if (!err && status.up && status.running) {
                    try {
                        this.network_history[null] = {
                            ssid: null,
                            ipaddress: status.ipv4_address,
                            last_seen: Date.now(),
                        };
                        this.networkInfo.wired = status.ipv4_address;
                    } catch (e) {
                        log.warn(
                            "Could not save ethernet address in network history."
                        );
                    }
                    this.ethernetState = "plugged";
                    var network_config = config.engine.get("network");
                    try {
                        if (!network_config.wifi.enabled) {
                            if (this.wifiStatus != "disabled") {
                                this.turnWifiOff();
                            }
                        }
                    } catch (e) {
                        log.error(e);
                    }
                } else {
                    this.ethernetState = "unplugged";
                }
                if (this.ethernetState !== oldState) {
                    switch (this.ethernetState) {
                        case "plugged":
                            log.info("ethernet cable was plugged");
                            this.applyEthernetConfig();
                            break;
                        case "unplugged":
                            log.info("Ethernet cable was unplugged.");
                            this.enableWifi();
                            break;
                        default:
                            log.error("Unknown ethernet state. (Bad error)");
                            break;
                    }
                }
            }.bind(this)
        );
    }
    checkEthernetState.bind(this)();
    setInterval(checkEthernetState.bind(this), ETHERNET_SCAN_INTERVAL);
};

exports.NetworkManager = RaspberryPiNetworkManager;
