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
// ... also to be implemented as OUTPUT#? (Delta=M0) [see Lenze notes for info on that VFD]
// Only Spin is implemented for spindle1'spindleVFD1; spindleVFD2 is a placeholder for future expansion

// Constructor for Spin
function Spin() {
    EventEmitter.call(this);
    this.status = {
        vfdEnabled: true,
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
    const configFile = "./spindles/spindle1_settings.json";
    return new Promise((resolve, reject) => {
        fs.readFile(configFile, "utf8", (err, data) => {
            if (err) {
                this.disableSpindle(`Settings file error: ${err.message}`, true);
                reject(err);
            } else {
                try {
                    this.settings = JSON.parse(data);
                    log.info("VFD Settings loaded from settings file:", this.settings.VFD_Settings);
                    resolve();
                } catch (parseErr) {
                    this.disableSpindle(`Settings file parse error: ${parseErr.message}`, true);
                    reject(parseErr);
                }
            }
        });
    });
};

// Connect to a VFD
Spin.prototype.connectVFD = function() {
    return new Promise((resolve, reject) => {
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
            this.disableSpindle(`Connection failed: ${error.message}`, true);
            reject(error);
        });
    });
};

let vfdFailures = 0;
// Set up 1-second UPDATES to spindleVFD status 
Spin.prototype.startSpindleVFD = function() {
    const settings = this.settings.VFD_Settings;
    const MAX_VFD_FAILS = 3;
    
    // Store intervalId as instance property so it can be cleared properly
    if (this.vfdInterval) {
        clearInterval(this.vfdInterval);
    }
    
    if (this.status.vfdEnabled) {
        this.vfdInterval = setInterval(() => {
            if (this.vfdBusy) {
                log.error("VFD is busy; skipping update");
                this.vfdBusy = false;
                return;
            }
            
            // Check if we've been disabled - stop the interval
            if (!this.status.vfdEnabled || this.status.vfdDesgFreq === -1) {
                clearInterval(this.vfdInterval);
                this.vfdInterval = null;
                return;
            }
            
            Promise.race([
                readVFD(settings.Registers.TRIG_READ_FREQ, settings.READ_LENGTH),
                new Promise((_, reject) => setTimeout(() => reject(new Error("VFD not responding > USB?")), 5000))
            ])
            .then((data) => {
                // Success - process data
                this.status.vfdDesgFreq = data[0] * settings.Registers.RPM_MULT;
                this.status.vfdAchvFreq = data[1] * settings.Registers.RPM_MULT;
                
                if (settings.Registers.READ_AMPS_HI === true) {
                    var vCur = ((data[2] >> 8) & 0xFF);
                } else {
                    var vCur = data[2];
                }
                vCur = vCur * settings.Registers.AMP_MULT;
                this.status.vfdAmps = vCur;
                
                this.updateStatus(this.status);
                vfdFailures = 0; // Reset failure count on success
            })
            .catch((error) => {
                // Handle errors here where 'error' is actually defined
                vfdFailures++;
                log.error(`***Error reading VFD: ${error.message}`);
                
                if (vfdFailures >= MAX_VFD_FAILS) {
                    log.error(`Last Error (of ${MAX_VFD_FAILS}): ${error.message}`);
                    
                    // Handle specific error types
                    if (error.message.includes("Illegal data address")) {
                        this.disableSpindle(`Invalid VFD register configuration: ${error.message}`);
                    } else {
                        this.disableSpindle(`Too many communication errors (${MAX_VFD_FAILS}): ${error.message}`);
                    }
                    
                    // Clear the interval using instance property
                    clearInterval(this.vfdInterval);
                    this.vfdInterval = null;
                }
            });
        }, 1000);
    }
};

// Method to update VFD status Globally via "machine"
Spin.prototype.updateStatus = function(newStatus) {
    // for the change-check here, probably most efficient to just do this manual comparison
    if (this.laststatus.vfdDesgFreq !== newStatus.vfdDesgFreq || 
        this.laststatus.vfdAchvFreq !== newStatus.vfdAchvFreq ||
        this.laststatus.vfdAmps !== newStatus.vfdAmps) {
        this.status = Object.assign({}, this.status, newStatus);
        this.emit('statusChanged', this.status); // Emit status change to trigger event on machine
        // log.info("VFD Status Changed: " + JSON.stringify(this.status));
        this.laststatus = {...this.status};
    }
};

Spin.prototype.disableSpindle = function(reason, isInitialFailure = false) {
    if (this.status.vfdEnabled === false && this.status.vfdDesgFreq === -1) {
        // Already disabled, don't spam logs
        return;
    }
    
    this.status.vfdEnabled = false;
    this.status.vfdDesgFreq = -1;
    this.status.vfdAchvFreq = 0;
    this.status.vfdAmps = 0;
    
    // Clear any running interval
    if (this.vfdInterval) {
        clearInterval(this.vfdInterval);
        this.vfdInterval = null;
    }
    
    // Single, clean disable message
    if (isInitialFailure) {
        log.warn(`Spindle/VFD initialization failed: ${reason}`);
        log.info("Spindle RPM control disabled for this session.");
    } else {
        log.warn(`Spindle/VFD connection lost: ${reason}`);
        log.info("Spindle RPM control disabled due to communication errors.");
    }
    
    this.updateStatus(this.status);
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
                // Lets just log and continue for the moment
                resolve (null);
                //reject(error);
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
                // log.error("***Error reading VFD: " + error);
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
                // Lets just log and continue for the moment
                resolve (null);
                //reject(error);
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