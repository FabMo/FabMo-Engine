// XHC LHB04B-6 (wired) pendant adapter.
//
// Reads 8-byte HID input reports from the device, parses them, and dispatches
// to pendant/actions.js. node-hid is an optional dependency — if absent, the
// adapter logs and returns null so the engine starts fine without it.
//
// USB IDs: VID 0x10ce ("KTURT.LTD") / PID 0xeb93. The wired LHB04B-6 enumerates
// with the same IDs as the wireless WHB04B-6 and uses the identical HID format.
// udev rule template lives at pendant/udev/99-fabmo-pendant.rules.

var log = require("../../../log").logger("pendant");
var config = require("../../../config");
var parser = require("./parser");
var mapping = require("./mapping");
var actions = require("../../actions");

var VENDOR_ID = 0x10ce;
var PRODUCT_ID = 0xeb93;
var DEFAULT_JOG_SPEED = 60; // IPM, used if config doesn't specify

// Button → action binding. Hardcoded for v1; edit here to remap. Macro IDs
// reference the user's macro numbers (visible in the Macros app). Set to null
// to leave a button unbound.
var BINDINGS = {
    "start-pause": function (machine) {
        actions.smartStartPause(machine);
    },
    stop: function (machine) {
        actions.quit(machine);
    },
    reset: function (machine) {
        actions.authorize(machine);
    },
    "m-home": function (machine) {
        actions.runMacro(machine, 71);
    },
    "safe-z": function (machine) {
        actions.runMacro(machine, 72);
    },
    "w-home": function (machine) {
        actions.runMacro(machine, 73);
    },
    "spindle-on-off": function (machine) {
        actions.runMacro(machine, 78);
    },
    "probe-z": function (machine) {
        actions.runMacro(machine, 79);
    },
    "macro-10": function (machine) {
        actions.runMacro(machine, 10);
    },
    // fn is a modifier — handled in dispatch, not as a direct binding
    fn: null,
    // Override and mode buttons deferred to v2 (need FRO/SRO support).
    "feed-plus": null,
    "feed-minus": null,
    "spindle-plus": null,
    "spindle-minus": null,
    "mode-continuous": null,
    "mode-step": null,
};

function open(machine) {
    var hid;
    try {
        hid = require("node-hid");
    } catch (e) {
        log.warn("node-hid unavailable; XHC LHB04B-6 pendant disabled (" + e.message + ")");
        return null;
    }

    var devices;
    try {
        devices = hid.devices();
    } catch (e) {
        log.warn("hid.devices() failed: " + e.message);
        return null;
    }

    var match = devices.find(function (d) {
        return d.vendorId === VENDOR_ID && d.productId === PRODUCT_ID;
    });
    if (!match) {
        log.info("XHC LHB04B-6 pendant not detected");
        return null;
    }

    var device;
    try {
        device = new hid.HID(match.path);
    } catch (e) {
        log.error("Failed to open XHC pendant at " + match.path + ": " + e.message);
        return null;
    }

    log.info("XHC LHB04B-6 pendant connected at " + match.path);

    var previousButtons = [];

    device.on("data", function (buf) {
        var raw = parser.parse(buf);
        if (!raw) return;
        var event = mapping.interpret(raw);
        if (!event) return;

        // Rising-edge button dispatch: act only on buttons that weren't in the
        // previous report.
        var fnHeld = event.buttons.indexOf("fn") !== -1;
        for (var i = 0; i < event.buttons.length; i++) {
            var b = event.buttons[i];
            if (previousButtons.indexOf(b) !== -1) continue;
            if (b === "fn") continue;
            var binding = BINDINGS[b];
            if (typeof binding === "function") {
                log.debug("pendant button: " + b + (fnHeld ? " (fn)" : ""));
                binding(machine, fnHeld);
            }
        }
        previousButtons = event.buttons;

        // Wheel jog. Requires an axis selected (left rotary off OFF) and a
        // non-zero delta. Step size comes from the right rotary; if the rotary
        // is in a percent-only position (60/100/Lead), fall back to 0.01.
        if (event.wheelDelta !== 0 && event.axis) {
            var stepSize = event.feed && event.feed.stepSize != null ? event.feed.stepSize : 0.01;
            var speed = DEFAULT_JOG_SPEED;
            try {
                var manualCfg = config.machine && config.machine.get && config.machine.get("manual");
                if (manualCfg && manualCfg.xy_speed) speed = manualCfg.xy_speed;
            } catch (e) {
                // fall through to default
            }
            actions.jog(machine, event.axis, event.wheelDelta, stepSize, speed);
        }
    });

    device.on("error", function (err) {
        log.error("XHC pendant error: " + err.message);
    });

    return {
        name: "xhc-lhb04b-6",
        path: match.path,
        close: function () {
            try {
                device.close();
            } catch (e) {
                // ignore
            }
        },
    };
}

module.exports = {
    name: "xhc-lhb04b-6",
    vendorId: VENDOR_ID,
    productId: PRODUCT_ID,
    open: open,
    BINDINGS: BINDINGS, // exported for tests / future config UI
};
