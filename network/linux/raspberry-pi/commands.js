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

    // Bring up the AP profile (NetworkManager runs the AP; hostapd is not used)
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
    //
    // NetworkManager owns the AP: the wlan0_ap profile is run by NM through
    // wpa_supplicant. The standalone hostapd service must NOT be started here;
    // it attaches to the same interface, and when it later lets go the AP goes
    // off the air while NM still reports wlan0_ap as connected.
    //
    // Order of events:
    //   1. Stop a stray standalone hostapd if one is running (left by an older
    //      engine). Stopping it takes the AP down, so the profile is then
    //      re-activated in step 3 even if NM believes it is active.
    //   2. Make sure the wlan0_ap interface exists.
    //   3. If the wlan0_ap profile is already active, leave it alone (an engine
    //      restart must not bounce a working AP). Otherwise set its SSID and
    //      bring it up.
    //   4. Record wifi.enabled and make sure dnsmasq is running (start, not
    //      restart; stopAP is the only thing here that stops it).
    // On a cold boot step 3 usually fails because NM has not yet seen the
    // interface created in step 2; NM then auto-activates the profile itself a
    // few seconds later. That is the long-standing behavior and is unchanged.
    static startAP(callback) {
        let forceActivate = false;

        // Step 1: Remove a stray standalone hostapd
        exec("systemctl is-active --quiet hostapd", (notActive) => {
            if (notActive) {
                return ensureInterface();
            }
            console.warn("Standalone hostapd is running; stopping it (NetworkManager manages the AP).");
            exec("systemctl stop hostapd", (stopErr, stdout, stderr) => {
                if (stopErr) console.warn(`Warning: Could not stop hostapd: ${stderr}`);
                forceActivate = true;
                ensureInterface();
            });
        });

        // Step 2: Ensure the wlan0_ap interface exists
        function ensureInterface() {
            exec("iw dev | grep wlan0_ap", (err) => {
                if (!err) {
                    console.log("wlan0_ap interface already exists.");
                    return checkActive();
                }
                // If the interface does not exist, try to create it
                exec("iw dev wlan0 interface add wlan0_ap type __ap", (err, stdout, stderr) => {
                    if (err && !stderr.includes("File exists")) {
                        // Ignore "File exists" error
                        console.error(`Error creating wlan0_ap interface: ${stderr}`);
                        return callback(err);
                    }
                    console.log(`wlan0_ap interface created: ${stdout || stderr}`);
                    checkActive();
                });
            });
        }

        // Step 3: Bring up the wlan0_ap connection unless it is already active
        function checkActive() {
            exec("nmcli -t -f NAME connection show --active | grep -qx wlan0_ap", (notActive) => {
                if (!notActive && !forceActivate) {
                    console.log("wlan0_ap is already active; leaving it as is.");
                    return finish("wlan0_ap already active");
                }
                activate();
            });
        }

        function activate() {
            const machineName = config.engine.get("machine_name") || config.engine.get("machine_id") || "fabmoAP";
            exec("ip -4 addr show eth0 2>/dev/null | grep inet | awk '{print $2}' | cut -d/ -f1", (ipErr, ipStdout) => {
                const ethIp = (ipStdout || "").trim();
                const ssid = ethIp ? `${machineName}-LAN@${ethIp}` : `${machineName}-AP@192.168.42.1`;
                const truncatedSsid = ssid.substring(0, 32);
                // Set the SSID in the NM profile first so it is applied by the activation below
                exec(`nmcli con modify wlan0_ap 802-11-wireless.ssid "${truncatedSsid}"`, (modErr) => {
                    if (modErr) console.warn(`Warning: Could not update NM SSID: ${modErr}`);
                    exec("nmcli connection up wlan0_ap", (err, stdout, stderr) => {
                        if (err) {
                            console.error(`Error bringing up wlan0_ap: ${stderr}`);
                            return callback(err);
                        }
                        console.log(`wlan0_ap brought up: ${stdout}`);
                        finish(stdout);
                    });
                });
            });
        }

        // Step 4: Update config and make sure dnsmasq is running
        function finish(result) {
            const networkConfig = config.engine.get("network") || {};
            networkConfig.wifi = networkConfig.wifi || {};
            networkConfig.wifi.enabled = true;
            config.engine.set("network", networkConfig, (configErr) => {
                if (configErr) {
                    console.error("Failed to update network configuration:", configErr);
                    return callback(configErr);
                }
                console.log("Network configuration updated successfully.");
                // Non-fatal; a no-op when dnsmasq is already running
                exec("systemctl start dnsmasq", (dnsErr, dnsStdout, dnsStderr) => {
                    if (dnsErr) {
                        console.warn(`Note: dnsmasq start failed: ${dnsStderr}`);
                    }
                    callback(null, result);
                });
            });
        }
    }

    // Update the AP SSID in the NetworkManager profile. The running AP picks
    // the new name up when ip-reporting.py re-activates wlan0_ap, which it does
    // within a few seconds of a machine_name change. Standalone hostapd is not
    // used (see startAP).
    static updateSSID(name, callback) {
        exec("ip -4 addr show eth0 2>/dev/null | grep inet | awk '{print $2}' | cut -d/ -f1", (ipErr, ipStdout) => {
            const ethIp = (ipStdout || "").trim();
            const ssid = ethIp ? `${name}-LAN@${ethIp}` : `${name}-AP@192.168.42.1`;
            const truncatedSsid = ssid.substring(0, 32);
            exec(`nmcli con modify wlan0_ap 802-11-wireless.ssid "${truncatedSsid}"`, (modErr) => {
                if (modErr) console.warn(`Warning: Could not update NM SSID: ${modErr}`);
                callback(null, truncatedSsid);
            });
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
