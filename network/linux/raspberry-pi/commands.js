const { exec } = require("child_process");
const fs = require("fs");
const tmp = require("tmp");

var config = require("../../../config");

// Heavily modified to work with the Raspberry Pi 5, Bookworm, and NetworkManager
//  ... some functions unused and historic
class commands {
    // Bring up the interface
    static bringUp(iface, callback) {
        this.executeMonitoringScript("bring_up_profile", iface, callback);
    }

    // Take down the interface *
    static takeDown(iface, callback) {
        this.executeMonitoringScript("take_down_profile", iface, callback);
    }

    static configureApIp(ip, callback) {
        exec(`nmcli connection modify wlan0_ap ipv4.addresses ${ip}/24 ipv4.method manual`, callback);
    }

    // Use this plus systemctl start hostapd to start the AP
    static addApInterface(callback) {
        exec(`nmcli connection up wlan0_ap`, callback);
    }

    static startWpaSupplicant(callback) {
        exec("nmcli device wifi list", callback);
    }

    static listNetworks(callback) {
        exec("nmcli device wifi list", callback);
    }

    // Scan for available networks
    static scanForNetworks(callback) {
        exec("nmcli dev wifi rescan", (err, stdout, stderr) => {
            if (err) {
                console.error(`Error scanning for WiFi networks: ${stderr}`);
                return callback(err);
            }
            console.log(`WiFi networks scanned: ${stdout}`);
            callback(null, stdout);
        });
    }

    static executeMonitoringScript(action, profile, callback) {
        const command = `/fabmo/files/network_conf_fabmo/network-monitor.sh ${action} ${profile}`;
        exec(command, (err, stdout, stderr) => {
            if (err) {
                console.error(`Error executing ${action} on profile ${profile}: ${stderr}`);
                return callback(err);
            }
            console.log(`${action} ${profile}: ${stdout}`);
            callback(null, stdout);
        });
    }

    // Start WiFi by enabling the device and bringing up the profile
    static startWifi(callback) {
        // Turn on WiFi radio
        exec("nmcli radio wifi on", (err) => {
            if (err) {
                console.error(`Error turning off WiFi radio`);
                return callback(err);
            }
        });
    }

    // Stop WiFi by disabling the WiFi radio
    static stopWifi(callback) {
        // Turn off the WiFi radio
        exec("nmcli radio wifi off", (err, stdout, stderr) => {
            if (err) {
                console.error(`Error turning off WiFi radio: ${stderr}`);
                return callback(err);
            }
            console.log(`WiFi radio turned off: ${stdout}`);
        });
    }

    // Stop AP mode
    static stopAP(callback) {
        exec("systemctl stop hostapd dnsmasq", (err, stdout, stderr) => {
            if (err) {
                console.error(`Error stopping hostapd and dnsmasq: ${stderr}`);
                return callback(err);
            }
            console.log(`hostapd and dnsmasq stopped: ${stdout}`);
            exec("nmcli connection down wlan0_ap", (err, stdout, stderr) => {
                if (err) {
                    console.error(`Error bringing down wlan0_ap: ${stderr}`);
                    return callback(err);
                }
                console.log(`wlan0_ap brought down: ${stdout}`);
                // Update the configuration
                const networkConfig = config.engine.get("network") || {};
                networkConfig.wifi = networkConfig.wifi || {};
                networkConfig.wifi.enabled = false; // Update the nested property
                config.engine.set("network", networkConfig, (err) => {
                    if (err) {
                        console.error("Failed to update network configuration:", err);
                        return callback(err);
                    }
                    console.log("Network configuration updated successfully.");
                    callback(null, stdout);
                });
            });
        });
    }

    // Start AP mode
    static startAP(callback) {
        // Step 1: Ensure the wlan0_ap interface exists
        exec("iw dev | grep wlan0_ap", (err, stdout, stderr) => {
            if (err) {
                // If the interface does not exist, try to create it
                exec("iw dev wlan0 interface add wlan0_ap type __ap", (err, stdout, stderr) => {
                    if (err && !stderr.includes("File exists")) {
                        // Ignore "File exists" error
                        console.error(`Error creating wlan0_ap interface: ${stderr}`);
                        return callback(err);
                    }
                    console.log(`wlan0_ap interface created: ${stdout || stderr}`);
                    proceedToStep2(); // Proceed to the next step
                });
            } else {
                console.log("wlan0_ap interface already exists.");
                proceedToStep2(); // Proceed to the next step
            }
        });
        // Step 2: Bring up the wlan0_ap connection
        function proceedToStep2() {
            exec("nmcli connection up wlan0_ap", (err, stdout, stderr) => {
                if (err) {
                    console.error(`Error bringing up wlan0_ap: ${stderr}`);
                    return callback(err);
                }
                console.log(`wlan0_ap brought up: ${stdout}`);
                // Step 3: Start or restart hostapd and dnsmasq
                exec("systemctl restart hostapd dnsmasq", (err, stdout, stderr) => {
                    if (err) {
                        console.error(`Error starting hostapd and dnsmasq: ${stderr}`);
                        return callback(err);
                    }
                    console.log(`hostapd and dnsmasq started: ${stdout}`);
                    // Step 4: Update the configuration
                    const networkConfig = config.engine.get("network") || {};
                    networkConfig.wifi = networkConfig.wifi || {};
                    networkConfig.wifi.enabled = true; // Update the nested property
                    config.engine.set("network", networkConfig, (err) => {
                        if (err) {
                            console.error("Failed to update network configuration:", err);
                            return callback(err);
                        }
                        console.log("Network configuration updated successfully.");
                        callback(null, stdout);
                    });
                });
            });
        }
    }

    // Join a WiFi network
    static joinWifiNetwork(ssid, password, callback) {
        // Scan for available networks
        this.scanForNetworks((err) => {
            if (err) {
                return callback(err);
            }
            // Attempt to connect to the specified SSID
            const addConnectionCommand = `nmcli dev wifi connect "${ssid}" password "${password}" ifname wlan0`;
            exec(addConnectionCommand, (err, stdout, stderr) => {
                if (err) {
                    console.error(`Error joining WiFi network ${ssid}: ${stderr}`);
                    return callback(err);
                }
                console.log(`Successfully joined WiFi network ${ssid}: ${stdout}`);
                callback(null, stdout);
            });
        });
    }

    // Forget a WiFi network
    static forgetWifiNetwork(ssid, callback) {
        // Find the connection associated with the SSID
        const findConnectionCommand = `nmcli -t -f NAME connection show | grep "${ssid}"`;
        exec(findConnectionCommand, (err, stdout, stderr) => {
            if (err) {
                console.error(`Error finding WiFi network ${ssid}: ${stderr}`);
                return callback(err);
            }
            const connectionName = stdout.trim();
            if (connectionName) {
                // Delete the connection
                const deleteConnectionCommand = `nmcli connection delete "${connectionName}"`;
                exec(deleteConnectionCommand, (err, stdout, stderr) => {
                    if (err) {
                        console.error(`Error forgetting WiFi network ${ssid}: ${stderr}`);
                        return callback(err);
                    }
                    console.log(`Successfully forgot WiFi network ${ssid}: ${stdout}`);
                    callback(null, stdout);
                });
            } else {
                console.error(`No connection found for SSID ${ssid}`);
                callback(new Error(`No connection found for SSID ${ssid}`));
            }
        });
    }
}

module.exports = commands;
