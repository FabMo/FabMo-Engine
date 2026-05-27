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
var wheel = require("./wheel");
var display = require("./display");
var actions = require("../../actions");

var VENDOR_ID = 0x10ce;
var PRODUCT_ID = 0xeb93;
var DEFAULT_MAX_IPM = 60;
var TICK_HZ = wheel.TUNABLES.TICK_HZ;

// Button → action binding. Hardcoded for v1; edit here to remap. Macro IDs
// reference the user's macro numbers (visible in the Macros app). Set to null
// to leave a button unbound.
//
// Browse-mode overload (axis selector in OFF position): the wheel scrolls
// the file browser instead of jogging, and start-pause submits the
// currently-highlighted file rather than acting as smartStartPause.
var BINDINGS = {
    "start-pause": function (machine, fnHeld, ctx, axisOff) {
        if (axisOff && ctx && ctx.fileBrowser && ctx.fileBrowser.current()) {
            ctx.fileBrowser.select();
            return;
        }
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
    // Override buttons deferred to v2 (need FRO/SRO support).
    "feed-plus": null,
    "feed-minus": null,
    "spindle-plus": null,
    "spindle-minus": null,
    // Mode buttons toggle manual mode — wheel jogging only works while in it.
    "mode-continuous": function (machine) {
        actions.manualEnter(machine, { hideKeypad: false });
    },
    "mode-step": function (machine) {
        actions.manualExit(machine);
    },
};

// Read the configured manual XY feedrate ceiling, in IPM. xy_speed is stored
// in IPS (units/sec); the manual runtime / G2 expects IPM. Mirrors the F310's
// jogSpeed() conversion.
function readMaxIpm() {
    try {
        var manualCfg = config.machine && config.machine.get && config.machine.get("manual");
        if (manualCfg && manualCfg.xy_speed) return manualCfg.xy_speed * 60;
    } catch (e) {
        // fall through
    }
    return DEFAULT_MAX_IPM;
}

// Read whether the LCD display loop should be active. Default OFF — the
// encoder is derived from LinuxCNC's reference driver and has not been
// validated against the physical pendant yet. Flip
// config.machine.pendant.lcd_enabled true to send display frames.
function readLcdEnabled() {
    try {
        var pCfg = config.machine && config.machine.get && config.machine.get("pendant");
        return !!(pCfg && pCfg.lcd_enabled);
    } catch (e) {
        return false;
    }
}

function open(machine, ctx) {
    ctx = ctx || {};
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
    var wheelSM = wheel.create();
    var latestAxis = null;
    var latestFeed = null;
    var latestSeed = 0;

    var displayHandle = null;
    if (readLcdEnabled()) {
        displayHandle = display.create(machine, device, {
            getSeed: function () { return latestSeed; },
            getWheelMode: function () {
                if (!latestFeed) return null;
                return latestFeed.stepSize != null ? "step" : "velocity";
            },
        });
        log.info("XHC LHB04B-6 LCD display loop enabled");
    }

    function dispatchIntents(intents) {
        if (!intents || !intents.length) return;
        for (var i = 0; i < intents.length; i++) {
            var it = intents[i];
            if (it.type === "stop") {
                actions.jogStop(machine);
            } else if (it.type === "start") {
                actions.jogStart(machine, it.axis, it.speed, null, 0, it.ratio, 0);
            } else if (it.type === "nudge") {
                actions.jog(machine, it.axis, it.ticks, it.stepSize, it.speed);
            }
        }
    }

    device.on("data", function (buf) {
        var raw = parser.parse(buf);
        if (!raw) return;
        latestSeed = raw.seed;
        var event = mapping.interpret(raw);
        if (!event) return;

        // Rising-edge button dispatch: act only on buttons that weren't in the
        // previous report. Bindings receive (machine, fnHeld, ctx, axisOff)
        // so they can implement context-sensitive overloads.
        var fnHeld = event.buttons.indexOf("fn") !== -1;
        var axisOff = event.axis == null;
        for (var i = 0; i < event.buttons.length; i++) {
            var b = event.buttons[i];
            if (previousButtons.indexOf(b) !== -1) continue;
            if (b === "fn") continue;
            var binding = BINDINGS[b];
            if (typeof binding === "function") {
                log.debug("pendant button: " + b + (fnHeld ? " (fn)" : "") + (axisOff ? " (browse)" : ""));
                binding(machine, fnHeld, ctx, axisOff);
            }
        }
        previousButtons = event.buttons;

        // Axis-change immediate stop: if the rotary moved off the previously-
        // active axis while a jgv is in flight, stop the cycle now and drop
        // any pulses that were destined for the old axis. The new axis won't
        // start moving until the next fresh pulse arrives (handled in tick).
        if (latestAxis !== event.axis) {
            var stopIntent = wheelSM.onAxisChange(event.axis);
            if (stopIntent) dispatchIntents([stopIntent]);
            latestAxis = event.axis;
        }
        latestFeed = event.feed;

        if (event.wheelDelta !== 0) {
            // Browse mode: axis selector OFF and a file browser is wired in
            // → wheel scrolls the file list instead of jogging. One detent
            // per scroll step; we don't accumulate or rate-shape here.
            if (event.axis == null && ctx.fileBrowser) {
                ctx.fileBrowser.scroll(event.wheelDelta > 0 ? 1 : -1);
            } else {
                wheelSM.recordPulse(event.wheelDelta, Date.now());
            }
        }
    });

    // ~20 Hz ticker — converts queued pulses + current selector state into
    // manual-runtime intents. The firmware velocity-jog cycle has its own
    // 500 ms watchdog, so re-issuing jgvStart every tick during a fast spin
    // is what keeps the cycle alive across the gesture.
    var processTimer = setInterval(function () {
        if (machine.status.state !== "manual") {
            // Manual mode lost (or never entered) — drop in-flight motion.
            var st = wheelSM.getState();
            if (st.activeMode === "jgv") {
                actions.jogStop(machine);
            }
            wheelSM.reset();
            return;
        }
        var intents = wheelSM.tick(latestAxis, latestFeed, readMaxIpm(), Date.now());
        dispatchIntents(intents);
    }, Math.round(1000 / TICK_HZ));

    device.on("error", function (err) {
        log.error("XHC pendant error: " + err.message);
    });

    return {
        name: "xhc-lhb04b-6",
        path: match.path,
        close: function () {
            clearInterval(processTimer);
            if (displayHandle) displayHandle.close();
            var st = wheelSM.getState();
            if (st.activeMode === "jgv") actions.jogStop(machine);
            wheelSM.reset();
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
    BINDINGS: BINDINGS,
};
