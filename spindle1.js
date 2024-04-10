// turn off prettier for this file
/* eslint-disable */
var SerialPort = require("serialport");
var fs = require("fs");
var events = require("events");
var async = require("async");
var util = require("util");
var u = require("./util")
var log = require("./log").logger("spindleVFD");
var process = require("process");
var stream = require("stream");

// spindle1.js
var vfdBusy = false;

// At this time only using the Modbus-Serial library for VFD control of RPM and reading registers and status
// RUN/STOP is implemented as and OUPUT 1 from FabMo to RUN input on VFD (Delta = M1); FWD/REV is optional and also implemented as OUTPUT#? (Delta=M0)
// Only spindleVFD1 is implemented; spindleVFD2 is a placeholder for future expansion

const ModbusRTU = require("modbus-serial");
const client = new ModbusRTU();

let spindleVFD1 = {
    status: {
        vfdStatus: 0,
        vfdDesgFreq: 0,
        vfdAchvFreq: 0,
        vfdAmps: 0
    }
};

function connectVFD() {
    return new Promise((resolve, reject) => {
        client.connectRTUBuffered( vfdSettings.COM_PORT, { baudRate: vfdSettings.BAUDRATE, parity: vfdSettings.PARITY, dataBits: vfdSettings.BYTESIZE, stopBits: vfdSettings.STOPBITS })
            .then(() => {
                client.setID(vfdSettings.MB_ADDRESS);
                log.info("Connected to VFD via MODBUS");
                startSpindleVFD();
                resolve();
            })
            .catch((error) => {
                log.error("***Error connecting to VFD:", error);
                reject(error);
            });
    });
}

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
                log.error("***Error reading VFD:", error);
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
                log.error("***Error disconnecting from VFD:", error);
                reject(error);
            });
    });
}

// ==================================================  Handlers for TR Command

function getSpindleVFDStatus() {
    // keys used here correspond to those in main status report, should just fold in;
    return spindleVFD1.status;
}
function setSpindleVFDFreq(data) {
    vfdBusy = true;
    writeVFD(vfdSettings.Registers.SET_FREQUENCY, data)
        .then((data) => {
        // log.info("VFD Data after setting:" + JSON.stringify(data));
        })
        .catch((error) => {
            log.error("Error reading VFD after Freq:", error);
        });
    vfdBusy = false;
}

// function setSpindleVFDDirection(data) {
//     var dir = 8;
//     vfdBusy=true;
//     if (data === "R") {
//         var dir = 16;
//     }
//     writeVFD(vfdSettings.Registers.SET_DIRECTION, dir)
//     .then((data) => {
//         log.info("***---VFD Data before 2 seconds:" + JSON.stringify(data));
//     })
//     .catch((error) => {
//         log.error("Error reading VFD after Dir:", error);
//     });
//     vfdBusy=false;
// }

// Load the VFD settings from the config file
function loadVFDSettings() {
    const configFile = './vfd_settings.json';
    const rawData = fs.readFileSync(configFile);
    const settings = JSON.parse(rawData);
    return settings.VFD_Settings;
}

// Set up 2-second updates to spindleVFD status (sort of a model for other accessory drivers)
function startSpindleVFD() {
    setInterval(() => {
        // 5 sec error protection
        // if vfdBusy then return
        if (vfdBusy) {
            log.error("VFD is busy; skipping update");
            return;
        }
        Promise.race([
            readVFD(vfdSettings.Registers.READ_STATUS),
            new Promise((_, reject) => setTimeout(() => reject(new Error('VFD not responding; ON? PRESENT?')), 5000)) // 5 seconds timeout
        ])
            .then((data) => {
                var vOnDir = "off-F";
                if (data[0] & 3) {vOnDir = "ON-"} else {vOnDir = "off-"}
                if (data[0] & 24) {vOnDir += "REV"} else {vOnDir += "FWD"}
                spindleVFD1.status.vfdStatus = vOnDir;
                spindleVFD1.status.vfdDesgFreq = data[1];
                spindleVFD1.status.vfdAchvFreq = data[2];
                spindleVFD1.status.vfdAmps = (data[3] * 0.01).toFixed(2);
                log.info("VFD update:" + JSON.stringify(spindleVFD1.status));
            })
            .catch((error) => {
                log.error("Error reading VFD:", error);
            });
        // log.info("***---VFD update TRIGGERED");
    }, 2000);
}

// ===================================== Spindle/VFD action on Startup ===========================
// Load the VFD settings from the config file
const vfdSettings = loadVFDSettings();

// Export spindleVFD functions (started from engine, polled from machine)
module.exports = {
    spindleVFD1,
    getSpindleVFDStatus,
    setSpindleVFDFreq,
    //setSpindleVFDDirection,
    connectVFD
};
