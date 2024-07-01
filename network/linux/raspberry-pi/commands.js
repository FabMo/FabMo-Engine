const { exec } = require("child_process");
const fs = require("fs");
const tmp = require("tmp");

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
        this.executeMonitoringScript("nmcli radio wifi on", "turn-on-wifi", (err) => {
            if (err) {
                return callback(err);
            }
            // Then bring up the profile
            this.executeMonitoringScript("bring_up_profile", "wifi-connection", callback);
        });
    }

    // Stop WiFi by bringing down the profile and disabling the device
    static stopWifi(callback) {
        // Bring down the profile
        this.executeMonitoringScript("bring_down_profile", "wifi-connection", (err) => {
            if (err) {
                return callback(err);
            }
            // Remove all saved WiFi connections
            this.executeMonitoringScript(
                "nmcli --fields UUID,TYPE con show | grep wifi | awk '{print $1}' | xargs -r nmcli con delete uuid",
                "remove-wifi-connections",
                (err) => {
                    if (err) {
                        return callback(err);
                    }
                    // Finally, turn off WiFi radio
                    this.executeMonitoringScript("nmcli radio wifi off", "turn-off-wifi", callback);
                }
            );
        });
    }

    // Start AP by starting hostapd and dnsmasq, then bring up the interface
    static startAP(callback) {
        this.executeMonitoringScript("bring_up_profile", "wlan0_ap", (err, stdout) => {
            if (err) {
                return callback(err);
            }
            exec("systemctl start hostapd dnsmasq", (err, stdout, stderr) => {
                if (err) {
                    console.error(`Error starting hostapd and dnsmasq: ${stderr}`);
                    return callback(err);
                }
                console.log(`hostapd and dnsmasq started: ${stdout}`);
                callback(null, stdout);
            });
        });
    }

    // Stop AP by stopping hostapd and dnsmasq, then bring down the interface
    static stopAP(callback) {
        exec("systemctl stop hostapd dnsmasq", (err, stdout, stderr) => {
            if (err) {
                console.error(`Error stopping hostapd and dnsmasq: ${stderr}`);
                return callback(err);
            }
            console.log(`hostapd and dnsmasq stopped: ${stdout}`);
            this.executeMonitoringScript("bring_down_profile", "wlan0_ap", callback);
        });
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
        // });
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
