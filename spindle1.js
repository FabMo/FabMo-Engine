// turn off prettier for this file
/* eslint-disable */
// spindle1.js
const EventEmitter = require('events').EventEmitter;
const util = require("util");
const ModbusRTU = require("modbus-serial");
const client = new ModbusRTU();
const fs = require("fs");
const log = require("./log").logger("spindleVFD");

// At this time only using the Modbus-Serial library for VFD control of RPM and reading registers and status
// RUN/STOP is still implemented as and OUPUT 1 from FabMo to RUN input on VFD (Delta = M1); FWD/REV is optional,
// ... also to be implemented as OUTPUT#? (Delta=M0)
// Only Spin is implemented for spindle1'spindleVFD1; spindleVFD2 is a placeholder for future expansion

// Constructor for Spin
function Spin() {
    EventEmitter.call(this);
    this.status = {
        vfdDesgFreq: 0,
        vfdAchvFreq: 0,
        vfdAmps: 0
    };
    this.vfdSettings = {};
    this.vfdBusy = false;
    this.laststatus = {};
    this.unlockRequired = false;
}

// Inherit from EventEmitter
util.inherits(Spin, EventEmitter);

// Load settings for a VFD
Spin.prototype.loadVFDSettings = function() {
    const configFile = "./spindles/spindle1_settings.json"; // contains VFD settings
    return new Promise((resolve, reject) => {
        fs.readFile(configFile, "utf8", (err, data) => {
            if (err) {
                log.error("Failed to load VFD settings from settings file: " + err + "\nDisabling Spindle RPM Control for this session!");
                reject(err);
            } else {
                this.settings = JSON.parse(data);
                log.info("VFD Settings loaded from settings file:", this.settings.VFD_Settings);
                resolve();
            }
        });
    });
};

// Connect to a VFD
Spin.prototype.connectVFD = function() {
    return new Promise((resolve, reject) => {
        // Access settings from this.settings.VFD_Settings per JSON file setup
        const settings = this.settings.VFD_Settings;
        this.vfdSettings = settings;

        client.connectRTUBuffered(settings.COM_PORT, {
            baudRate: settings.BAUDRATE,
            parity: settings.PARITY,
            dataBits: settings.BYTESIZE,
            stopBits: settings.STOPBITS
        })
        .then(() => {
            client.setID(settings.MB_ADDRESS);
            log.info("Connected to VFD via MODBUS");
            if (settings.Registers.UNLOCK_PARAMETERS !== null) {
                this.unlockRequired = true;
            }
            log.info("Unlock required: " + this.unlockRequired);
            this.startSpindleVFD();
            resolve();
        })
        .catch((error) => {
            log.error("***Error connecting to VFD:  " + error + "\nDisabling Spindle RPM Control for this session!");
            reject(error);
        });
    });
};

// Set up 1-second UPDATES to spindleVFD status (sort of a model for other accessory drivers)
Spin.prototype.startSpindleVFD = function() {
    const settings = this.settings.VFD_Settings;
    let vfdFailures = 0;
    var MAX_VFD_FAILS = 3;
    const intervalId = setInterval(() => {
        if (this.vfdBusy) {
            log.error("VFD is busy; skipping update");
            this.vfdBusy = false;  // ? really turn off busy flag here?
            return;
        }
        Promise.race([
            readVFD(settings.Registers.TRIG_READ_FREQ, settings.READ_LENGTH), // <<==== YOUR BASIC DATA READ
            new Promise((_, reject) => setTimeout(() => reject(new Error("VFD not responding > ON? PRESENT?")), 5000)) // 5 seconds timeout
        ])
        .then((data) => {
            // DELTA (uses the exact numbers provided in manual)
            // LENZE (uses the numbers described as the "driver registers" not MODBUS registers or mults)
            // See additional notes on VFDs and Spindles in Spindle folder
            this.status.vfdDesgFreq = data[0] * settings.Registers.RPM_MULT;
            this.status.vfdAchvFreq = data[1] * settings.Registers.RPM_MULT;
            if (settings.Registers.READ_AMPS_HI === true) {
                // get the high byte of data[2] shifted low for single byte for vfdAmps (LENZE)
                var vCur = ((data[2] >> 8) & 0xFF);
            } else {
                var vCur = data[2];
            }
            vCur = vCur * settings.Registers.AMP_MULT;
            this.status.vfdAmps = vCur;
            this.updateStatus(this.status); // initiate change-check and global status change if warranted
            // log.info("VFD update:" + JSON.stringify(this.status));
        })
        .catch((error) => {
            vfdFailures++;
            //log.error("Error reading VFD:" + error);
            // Aggregate and handle VFD errors here
            if (vfdFailures >= MAX_VFD_FAILS) {
                log.error("Too many Spindle/VFD/MODBUS errors (3).");
                log.error("Last Error: " + error + "\nDisabling Spindle RPM Control for this session!");
                this.status.vfdDesgFreq = -1;
                this.updateStatus(this.status);

                clearInterval(intervalId); // Stop the interval

                // ** explore why not working
                // disconnectVFD()
                //     .then(() => {
                //         log.info("Disconnected from VFD");
                //         this.emit('statusChanged', this.status); // Emit status change to trigger event on machine
                //     })
                //     .catch((error) => {
                //         log.error("Error disconnecting from VFD: " + error);
                //     });

                // Notify clients about the error
                //** NOTIFY is actually of no use here because it occurs before client is up; I would like to figure out how
                //  to make it work and use the NOTIFY-toaster from the server side */
                // const server = require("./server"); 
                // server.io.of("/private").emit("vfd_error", { message: 'Too many VFD errors; stopping updates. Last Error: ' + error.message });
            }
        });
    }, 1000);
};
  
// Method to update VFD status Globally via "machine"
Spin.prototype.updateStatus = function(newStatus) {
    // for the change-check here, probably most efficient to just do this manual comparison
    if (this.laststatus.vfdDesgFreq !== newStatus.vfdDesgFreq || 
        this.laststatus.vfdAchvFreq !== newStatus.vfdAchvFreq ||
        this.laststatus.vfdAmps !== newStatus.vfdAmps) {
        this.status = Object.assign({}, this.status, newStatus);
        this.emit('statusChanged', this.status); // Emit status change to trigger event on machine
        log.info("VFD Status Changed:", JSON.stringify(this.status));
        this.laststatus = {...this.status};
    }
};

Spin.prototype.setSpindleVFDFreq = function(data) {
    this.vfdBusy = true;
    return new Promise((resolve, reject) => {
        const unlockAndSetFrequency = () => {
            // Unlock VFD first, if required
            if (this.unlockRequired) {
                return writeVFD(this.vfdSettings.Registers.UNLOCK_PARAMETERS, this.vfdSettings.Registers.PASSWORD)
                    .then(() => {
                        log.info("VFD Unlocked");
                        // Once unlocked, proceed to set frequency
                        return this.setFrequency(data);
                    });
            } else {
                // If no unlock needed, go straight to setting frequency
                return this.setFrequency(data);
            }
        };

        unlockAndSetFrequency()
            .then(result => {
                this.vfdBusy = false;
                resolve(result);
            })
            .catch(error => {
                log.error("Error in setting frequency: ", error);
                this.vfdBusy = false;
                reject(error);
            });
    });
};

Spin.prototype.setFrequency = function(data) {
    var vfd_req = Math.round(data / this.vfdSettings.Registers.RPM_MULT);    
    return writeVFD(this.vfdSettings.Registers.SET_FREQUENCY, vfd_req)
        .then(data => {
            log.info("VFD Data after setting:" + JSON.stringify(data));
            return data;  // return data to resolve
        });
};


// ------------------- Calls to ModbusRTU ------------------
function readVFD(data, length) {
    return new Promise((resolve, reject) => {
        client.readHoldingRegisters(data, length)
            .then((data) => {
                if (data && data.data) {
                    resolve(data.data);
                } else {
                    log.error("***No data returned from VFD");
                    reject(new Error("No data returned from VFD"));
                }
            })
            .catch((error) => {
                log.error("***Error reading VFD: " + error);
                reject(error);
            });
    });
}

function writeVFD(reg, data) {
    return new Promise((resolve, reject) => {
        client.writeRegister(reg, data)
            .then(() => resolve(data))
            .catch(error => {
                log.error("***Error writing VFD:", error);
                reject(error);
            });
    });
}

function disconnectVFD() {
    return new Promise((resolve, reject) => {
        client.close()
            .then(() => {
                log.info("Disconnected from VFD");
                resolve();
            })
            .catch((error) => {
                log.error("***Error disconnecting from VFD: " + error);
                reject(error);
            });
    });
}


// Setting up a single instance of Spindle
const singletonInstance = new Spin();

module.exports = singletonInstance;