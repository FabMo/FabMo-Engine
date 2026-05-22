// Pendant subsystem entry point.
//
// Discovers and opens supported input devices (USB CNC pendants, gamepads,
// etc.). Each device adapter lives in pendant/devices/<name>/ and exports an
// open(machine) function that returns a handle ({name, close}) or null if the
// device isn't present. This module just iterates the registry — adding a new
// device type means dropping a new directory and adding it to DEVICES below.
//
// Called from engine.js startup after machine.connect(). Non-fatal: if no
// device matches, or if node-hid isn't installed, the engine starts normally.

var log = require("../log").logger("pendant");

var DEVICES = [require("./devices/xhc-lhb04b-6"), require("./devices/logitech-f310")];

var openHandles = [];

function start(machine) {
    if (!machine) {
        log.warn("pendant.start called without a machine instance");
        return;
    }
    for (var i = 0; i < DEVICES.length; i++) {
        var device = DEVICES[i];
        try {
            var handle = device.open(machine);
            if (handle) {
                openHandles.push(handle);
            }
        } catch (e) {
            log.error("Device adapter '" + device.name + "' threw during open: " + e.message);
        }
    }
    if (openHandles.length === 0) {
        log.info("No pendant devices connected");
    }
}

function stop() {
    while (openHandles.length) {
        var h = openHandles.pop();
        if (h && typeof h.close === "function") {
            try {
                h.close();
            } catch (e) {
                log.warn("Error closing pendant '" + h.name + "': " + e.message);
            }
        }
    }
}

module.exports = {
    start: start,
    stop: stop,
};
