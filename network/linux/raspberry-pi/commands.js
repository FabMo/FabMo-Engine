const { exec } = require("child_process");
const fs = require("fs");
const tmp = require("tmp");

class commands {
    // Simple function for using the command line for taking down an interface.
    // static takeDown(iface) {
    //     return new Promise((resolve, reject) => {
    //         exec(`nmcli device disconnect ${iface}`, (err, stdout, stderr) => {
    //             if (err) {
    //                 reject(`Error disconnecting ${iface}: ${stderr}`);
    //             } else {
    //                 resolve(stdout);
    //             }
    //         });
    //     });
    // }
    static takeDown(iface, callback) {
        exec(`nmcli device disconnect ${iface} managed yes`, (err, stdout, stderr) => {
            if (err) {
                console.error(`Error disconnecting interface ${iface}: ${stderr}`);
                return callback(err);
            }
            console.log(`Interface ${iface} disconnected: ${stdout}`);
            callback(null, stdout);
        });
    }

    static bringUp(iface, callback) {
        exec(`nmcli device set ${iface} managed yes`, (err, stdout, stderr) => {
            if (err) {
                console.error(`Error bringing up interface ${iface}: ${stderr}`);
                return callback(err);
            }
            console.log(`Interface ${iface} brought up: ${stdout}`);
            callback(null, stdout);
        });
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

    static startAP(callback) {
        exec("systemctl start hostapd dnsmasq", (err, stdout, stderr) => {
            if (err) {
                console.error(`Error starting hostapd and dnsmasq: ${stderr}`);
                return callback(err);
            }
            console.log(`hostapd and dnsmasq started: ${stdout}`);
            exec("nmcli connection up wlan0_ap", (err, stdout, stderr) => {
                if (err) {
                    console.error(`Error bringing up AP interface: ${stderr}`);
                    return callback(err);
                }
                console.log(`AP interface brought up: ${stdout}`);
                callback(null, stdout);
            });
        });
    }

    static stopAP(callback) {
        exec("systemctl stop hostapd dnsmasq", function (err, stdout, stderr) {
            if (err) {
                console.error(`Error stopping hostapd and dnsmasq: ${stderr}`);
                callback(err);
            } else {
                console.log(`hostapd and dnsmasq stopped: ${stdout}`);
                exec("nmcli connection down wlan0_ap", function (err, stdout, stderr) {
                    if (err) {
                        console.error(`Error bringing down AP interface: ${stderr}`);
                        callback(err);
                    } else {
                        console.log(`AP interface brought down: ${stdout}`);
                        callback(null, stdout);
                    }
                });
            }
        });
    }

    // Simplified function for making use of ifconfig command line tool.
    static ifconfig(iface, addressType, address, callback) {
        exec(`nmcli connection modify ${iface} ${addressType} ${address}`, callback);
    }

    // Simplified interface to iptables.
    static iptables(iface, flagString, callback) {
        var command = `iptables -o ${iface} ${flagString}`;
        exec(command, callback);
    }

    // Function for making hostapd available to nodejs.  Has basic options
    // for the AP, but also allows for pass-in configuration parameters.
    static hostapd(options, callback) {
        var commands = [];

        // Known good options for the Raspberry PI 3.
        var defaultOptions = {
            driver: "nl80211",
            channel: 6,
            hw_mode: "g",
            interface: "wlan0_ap",
            ssid: "fa3mo",
        };

        var finalOptions = Object.assign(defaultOptions, options);
        if (options.password) {
            finalOptions.wpa_passphrase = finalOptions.password;
            delete finalOptions.password;
        }

        Object.getOwnPropertyNames(finalOptions).forEach(function (key) {
            commands.push(key + "=" + finalOptions[key]);
        });

        // The tmp package does nice things for you, like creating a tmp file in the proper
        // location and making sure its deleted after the fact.  Hostapd really wants to
        // take its configurations as a file.  So we shove all the options into one and
        // pass it along.
        tmp.file((err, path, fd) => {
            if (err) throw err;

            // In case you want to look at the config file:
            console.log("File: ", path);

            // We then write in the configurations...
            fs.write(fd, commands.join("\n"), function (err) {
                if (err) {
                    console.log(err);
                }
            });

            console.log("Commands being executed: ", commands);

            // Then execute the hostapd with the file and boom - AP should be started.
            exec(`hostapd ${path}`, (err, stdout, stderr) => {
                if (err) {
                    console.error(`Error starting hostapd: ${stderr}`);
                    if (callback) callback(err);
                } else {
                    console.log(`hostapd started: ${stdout}`);
                    if (callback) callback(null, stdout);
                }
            });
        });
    }

    // Simplified access to dnsmasq - the fellow responsible for handing out IP
    // addresses to your wifi clients.  This can take commands as parameters
    // but this function again takes advantage of the file configuration method.
    static dnsmasq(/*options, callback*/) {
        // deliberately removed so that os services can manage this based on the rotary switch
    }

    static dnsmasqETH(/*options, callback*/) {
        // deliberately removed so that os services can manage this based on the rotary switch
    }
}

module.exports = commands;
