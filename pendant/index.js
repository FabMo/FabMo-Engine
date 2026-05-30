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
var fileBrowser = require("./fileBrowser");
var toolboxController = require("./toolboxController");

var DEVICES = [require("./devices/xhc-lhb04b-6"), require("./devices/logitech-f310")];

var openHandles = [];
var sharedBrowser = null;
var sharedToolbox = null;

function start(machine) {
    if (!machine) {
        log.warn("pendant.start called without a machine instance");
        return;
    }
    // One file browser shared across devices — provides scroll/select state
    // for any pendant that wants to act as a remote for USB-file submission.
    sharedBrowser = fileBrowser.create(machine);
    // One toolbox controller shared across devices. Holds the current
    // cut type + parameter state; any device adapter can route button
    // presses to its toggle/adjustParam/commit methods. Bridges to the
    // dashboard via the toolbox_state event below.
    sharedToolbox = toolboxController.create(machine);
    sharedToolbox.on("toolbox_state", function (payload) {
        // Surface to any connected dashboard via the same machine event
        // bus used for pendant_joystick / pendant_file_select.
        machine.emit("toolbox_state", payload);
    });
    // Expose the shared controller on the machine so non-pendant inputs
    // (dashboard sidebar via WS) can drive the same state machine. All
    // device adapters and the WS layer end up calling the same toggle /
    // adjustParam / commit / cancel surface.
    machine.toolbox = sharedToolbox;
    var ctx = { fileBrowser: sharedBrowser, toolbox: sharedToolbox };
    for (var i = 0; i < DEVICES.length; i++) {
        var device = DEVICES[i];
        try {
            var handle = device.open(machine, ctx);
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
    if (sharedBrowser) {
        try { sharedBrowser.close(); } catch (e) { /* ignore */ }
        sharedBrowser = null;
    }
    if (sharedToolbox) {
        try { sharedToolbox.close(); } catch (e) { /* ignore */ }
        sharedToolbox = null;
    }
}

module.exports = {
    start: start,
    stop: stop,
};
