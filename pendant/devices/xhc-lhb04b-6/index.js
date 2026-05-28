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
        // C3 — HOME TOOL (auto-set XYZ zero + position tool)
        actions.runMacro(machine, 3);
    },
    "safe-z": function (machine) {
        actions.runMacro(machine, 72);
    },
    "w-home": function (machine) {
        // JH — built-in SBP Jog Home (go to work zero in current WCS)
        actions.runSbp(machine, "JH");
    },
    "spindle-on-off": function (machine) {
        // Toggle output 1 — same path as the dashboard manual-control
        // spindle button (action-5). Requires manual mode (the manual
        // runtime's output command does).
        actions.toggleOutput(machine, 1);
    },
    "probe-z": function (machine) {
        // C2 — Z-ZERO (Set Z-Zero with Zeroing Plate)
        actions.runMacro(machine, 2);
    },
    "macro-10": function (machine) {
        actions.runMacro(machine, 10);
    },
    // fn is a modifier — handled in dispatch, not as a direct binding
    fn: null,
    // FRO ±5% (5..200), same step as the dashboard arrow keys.
    "feed-plus": function (machine) {
        actions.adjustFro(machine, +5);
    },
    "feed-minus": function (machine) {
        actions.adjustFro(machine, -5);
    },
    // Spindle RPM setpoint ±100, sent straight to the VFD; matches the
    // dashboard "+"/"_" keys' step. Acts as a live setpoint adjust during
    // a running job (and is harmless when idle).
    "spindle-plus": function (machine) {
        actions.adjustSpindleRpm(machine, +100);
    },
    "spindle-minus": function (machine) {
        actions.adjustSpindleRpm(machine, -100);
    },
    // Mode buttons pick wheel behavior. They also enter manual mode if needed
    // so a single press from idle is enough to start jogging. The actual
    // wheelMode flag is owned by the adapter (see open()) — these placeholders
    // are overridden per-device so they can mutate that closure.
    "mode-continuous": null,
    "mode-step": null,
};

// Read the manual feedrate ceiling for `axis`, in IPM. Mirrors the per-axis
// split the manual runtime uses in driver.js:638-655 — XY (and unspecified
// axes) follow manual.xy_speed (= the keypad's FR field); Z follows
// manual.z_fast_speed; rotaries follow opensbp.move{a,b,c}_speed. All those
// fields are stored in IPS and we convert to IPM for the manual runtime / G2.
function readMaxIpm(axis) {
    try {
        var manualCfg = config.machine && config.machine.get && config.machine.get("manual");
        if (!manualCfg) return DEFAULT_MAX_IPM;
        var ax = (axis || "").toUpperCase();
        if (ax === "Z" && manualCfg.z_fast_speed) {
            return manualCfg.z_fast_speed * 60;
        }
        if (ax === "A" || ax === "B" || ax === "C") {
            var sbpCfg = config.opensbp && config.opensbp.get && config.opensbp.get();
            var key = "move" + ax.toLowerCase() + "_speed";
            if (sbpCfg && sbpCfg[key]) return sbpCfg[key] * 60;
        }
        if (manualCfg.xy_speed) return manualCfg.xy_speed * 60;
    } catch (e) {
        // fall through
    }
    return DEFAULT_MAX_IPM;
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
    // Wheel-mode is owned here so the Continuous/Step buttons can mutate it.
    // Default to continuous (the joystick-like feel) so first-press behavior
    // is predictable; the user can switch any time.
    var wheelMode = "continuous";

    // Per-instance overrides for the mode buttons. They both enter manual
    // mode (idempotent) and flip the wheelMode flag the tick loop reads.
    var instanceBindings = Object.assign({}, BINDINGS, {
        "mode-continuous": function (m) {
            wheelMode = "continuous";
            actions.manualEnter(m, { hideKeypad: false });
        },
        "mode-step": function (m) {
            wheelMode = "step";
            actions.manualEnter(m, { hideKeypad: false });
        },
    });

    var displayHandle = display.create(machine, device, {
        getSeed: function () { return latestSeed; },
        getWheelMode: function () { return wheelMode; },
    });

    function dispatchIntents(intents) {
        if (!intents || !intents.length) return;
        for (var i = 0; i < intents.length; i++) {
            var it = intents[i];
            if (it.type === "stop") {
                actions.jogStop(machine);
            } else if (it.type === "start") {
                actions.jogStart(machine, it.axis, it.speed, null, 0, it.ratio, 0);
            } else if (it.type === "nudge") {
                // The wheel state machine has already done the snap-to-grid
                // (in step mode), tracking a planned position so back-to-back
                // detents walk consecutive grid lines instead of all snapping
                // to the same one. Pass through the precomputed distance and
                // tell the driver to skip its own snap pass.
                actions.jog(machine, it.axis, it.ticks, it.stepSize, it.speed, {
                    snap: false,
                    distance: it.distance,
                });
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
            var binding = instanceBindings[b];
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
                // consumePulse records the pulse AND, in step mode with a
                // valid selector, returns an immediate nudge intent so each
                // detent dispatches without waiting for the next tick.
                // Continuous-mode pulses just get recorded for the tick loop.
                var posKey = latestAxis ? "pos" + latestAxis.toLowerCase() : null;
                var currentPos = posKey ? machine.status[posKey] : null;
                var immediate = wheelSM.consumePulse(
                    event.wheelDelta,
                    latestAxis,
                    latestFeed,
                    readMaxIpm(latestAxis),
                    wheelMode,
                    Date.now(),
                    currentPos
                );
                if (immediate.length && machine.status.state === "manual") {
                    dispatchIntents(immediate);
                }
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
        var posKey = latestAxis ? "pos" + latestAxis.toLowerCase() : null;
        var currentPos = posKey ? machine.status[posKey] : null;
        var intents = wheelSM.tick(latestAxis, latestFeed, readMaxIpm(latestAxis), Date.now(), wheelMode, currentPos);
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
