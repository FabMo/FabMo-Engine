// turn off prettier for this file
/* eslint-disable */
var SerialPort = require("serialport");
var fs = require("fs");
var events = require("events");
var async = require("async");
var util = require("util");
var log = require("./log").logger("g2");
var process = require("process");
var stream = require("stream");

// spindle.js
const ModbusRTU = require("modbus-serial");
const client = new ModbusRTU();

function connectVFD() {
    return new Promise((resolve, reject) => {
        client.connectRTUBuffered( vfdSettings.COM_PORT, { baudRate: vfdSettings.BAUDRATE, parity: vfdSettings.PARITY, dataBits: vfdSettings.BYTESIZE, stopBits: vfdSettings.STOPBITS })
            .then(() => {
                client.setID(vfdSettings.MB_ADDRESS);
                log.info("***---***Connected to VFD via MODBUS");
                resolve();
            })
            .catch((error) => {
                log.error("***---***Error connecting to VFD:", error);
                reject(error);
            });
    });
}

function readVFD(data) {
    return new Promise((resolve, reject) => {
        client.readHoldingRegisters(data, 4)
            .then((data) => {
                if (data && data.data) {
                    log.info("***---***VFD Data:" + JSON.stringify(data.data[1]));
                    spindleStatusReport(data.data)
                    resolve(data.data);
                } else {
                    log.error("***---***No data returned from VFD");
                    reject(new Error("No data returned from VFD"));
                }
            })
            .catch((error) => {
                log.error("***---***Error reading VFD:", error);
                reject(error);
            });
    });
}

function writeVFD(data) {
    return new Promise((resolve, reject) => {
        // we are only writing to the speed register at the moment
        client.writeRegister( vfdSettings.Registers.SET_FREQUENCY , data)
            .then(() => {
                log.info("***---***VFD Data written:", data);
                resolve(data);
            })
            .catch((error) => {
                log.error("***---***Error writing VFD:", error);
                reject(error);
            });
    });
}

function disconnectVFD() {
    return new Promise((resolve, reject) => {
        client.close()
            .then(() => {
                log.info("***---***Disconnected from VFD");
                resolve();
            })
            .catch((error) => {
                log.error("***---***Error disconnecting from VFD:", error);
                reject(error);
            });
    });
}

// Handler for Spindle status reports
//   status - The status report as sent by the spindle VFD
function spindleStatusReport (status) {
    if (!machine.connected) {
        log.warn("Spindle status report while disconnected.");
        return;
    }

    // Update the machine of the spindle status
    for (var key in this.machine.status) {
        if (key in status) {
            this.machine.status[key] = status[key];
        }
    }
    // Update the machine copy of spindle status variables
    for (key in status) {
        this.status_report[key] = status[key];
    }

    // TODO: separation of concerns dictates this should be part of an update method on the machine.
    this.machine.emit("status", this.machine.status);
};

function loadVFDSettings() {
    const configFile = './vfd_settings.json';
    const rawData = fs.readFileSync(configFile);
    const settings = JSON.parse(rawData);
    return settings.VFD_Settings;
}

// ===================================== Spindle/VFD action ===========================


const vfdSettings = loadVFDSettings();

log.info("testing>>>>>>>:" + JSON.stringify(vfdSettings.Registers.SET_FREQUENCY, null, 4));

// start an interval time to poll read the VFD every 5 seconds and display the data in the console
// but create a 20 second delay before we start polling
// setTimeout(() => {
//     writeVFD(2);
// }, 21000);

// setTimeout(() => {
//     writeVFD(1);
// }, 41000);

// This sets up the primary automatic reading of the VFD (todo: if there is one)
setInterval(() => {
    var data_freqTarget = readVFD(vfdSettings.Registers.READ_STATUS);
    log.info("Spindle Data - > " + data_freqTarget);
//    var data_freqAttained = readVFD(vfdSettings.Registers.READ_ATTAINED_FREQUENCY);
//    var data_amps = readVFD(vfdSettings.Registers.READ_OUTPUT_CURRENT);
//    var data_direction = readVFD(vfdSettings.Registers.READ_STATUS);

//    log.info("Spindle Data - > " + data);
//    log.info("Spindle Data (t,a,a,d) - > ", data_freqTarget, data_freqAttained, data_amps, data_direction);
}, 10000);


// Export the connectVFD function
module.exports = {
    connectVFD,
    readVFD,
    writeVFD,
    // any others ...?
};
