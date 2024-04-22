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
// RUN/STOP is implemented as and OUPUT 1 from FabMo to RUN input on VFD (Delta = M1); FWD/REV is optional, also to be implemented as OUTPUT#? (Delta=M0)
// Only Spin is implemented; spindleVFD2 is a placeholder for future expansion

// Constructor for Spin
function Spin() {
    EventEmitter.call(this);
    this.status = {
        vfdStatus: 0,
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
    const configFile = "./spindle1_settings.json";
    return new Promise((resolve, reject) => {
        fs.readFile(configFile, "utf8", (err, data) => {
            if (err) {
                log.error("Failed to load VFD settings from settings file:", err);
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
            log.error("***Error connecting to VFD:", error);
            reject(error);
        });
    });
};

// Set up 1-second updates to spindleVFD status (sort of a model for other accessory drivers)
Spin.prototype.startSpindleVFD = function() {
    const settings = this.settings.VFD_Settings;
    setInterval(() => {
        if (this.vfdBusy) {
            log.error("VFD is busy; skipping update");
            return;
        }
        Promise.race([
            readVFD(settings.Registers.READ_STATUS), // Assumes readVFD is another method on Spin
            new Promise((_, reject) => setTimeout(() => reject(new Error("VFD not responding > ON? PRESENT?")), 5000)) // 5 seconds timeout
        ])
        .then((data) => {
            var vOnDir = "stop-F";
            if (data[0] & 3) {vOnDir = "RUN-"} else {vOnDir = "stop-"}
            if (data[0] & 24) {vOnDir += "REV"} else {vOnDir += "FWD"}
            this.status.vfdStatus = vOnDir;
            this.status.vfdDesgFreq = data[1];
            this.status.vfdAchvFreq = data[2];
            this.status.vfdAmps = data[3];
            this.updateStatus(this.status); // initiate change-check and global status change if warranted
            // log.info("VFD update:" + JSON.stringify(this.status));
        })
        .catch((error) => {
            log.error("Error reading VFD:" + error);
        });
    }, 1000);
};
  
// Method to update VFD status Globally via "machine"
Spin.prototype.updateStatus = function(newStatus) {
    // for the change-check here, probably most efficient to just do this manual comparison
    if (this.laststatus.vfdStatus !== newStatus.vfdStatus || 
        this.laststatus.vfdDesgFreq !== newStatus.vfdDesgFreq || 
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
        if (this.unlockRequired) {
            writeVFD(this.vfdSettings.Registers.UNLOCK_PARAMETERS, 225)
                .then(() => {
                    log.info("VFD Unlocked");
                    return setFrequency(data);
                })
                .catch((error) => {
                    log.error("Error unlocking VFD:", error);
                    this.vfdBusy = false;
                    reject(error);
                });
            }
        writeVFD(this.vfdSettings.Registers.SET_FREQUENCY, data)
            .then((data) => {
                log.info("VFD Data after setting:" + JSON.stringify(data));
                this.vfdBusy = false;
                resolve(data);
            })
            .catch((error) => {
                log.error("Error setting VFD frequency:", error);
                this.vfdBusy = false;
                reject(error);
            });
    });
}

// ------------------- Calls to ModbusRTU ------------------

function readVFD(data) {
    return new Promise((resolve, reject) => {
        client.readHoldingRegisters(data, 4)
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
            .then(() => {
                resolve(data);
            })
            .catch((error) => {
                log.error("***Error writing VFD: " + error);
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


// Setting up a single instance
const singletonInstance = new Spin();

module.exports = singletonInstance;