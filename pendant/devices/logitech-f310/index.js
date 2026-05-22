// Logitech F310 gamepad adapter.
//
// Connects via Linux evdev (/dev/input/event*). Works in both modes:
//   D mode (switch on back, default):  PID 0xc216
//   X mode (Xbox 360 compatibility):   PID 0xc21d
//
// The mode determines which BTN_* code-set is used (see mapping.js).
//
// Mapping (user-requested for v1):
//   Left stick X       → continuous jog on X
//   Left stick Y       → continuous jog on Y (inverted: stick up = +Y)
//   Right stick Y      → continuous jog on Z (inverted: stick up = +Z)
//   D-pad              → fixed-step jog on X / Y (0.1" per press)
//   A                  → smart start/pause/authorize
//   B                  → quit
//   X                  → authorize (explicit)
//   Y                  → run macro 10
//   Start              → smart start/pause/authorize
//   Back/Select        → quit
//   LB / RB / LT / RT  → unbound (reserved for future spindle/feed overrides)
//
// Because the manual runtime's `stop` halts all motion, the adapter enforces
// single-axis-at-a-time jogging: pushing a new stick away from center stops
// whatever was previously jogging and starts the new axis. This is a v1
// simplification — true simultaneous XY needs the manual runtime's two-axis
// `start` form.

var fs = require("fs");
var log = require("../../../log").logger("pendant");
var config = require("../../../config");
var evdev = require("./evdev");
var mapping = require("./mapping");
var actions = require("../../actions");

// Per-axis raw values from the latest events; updated on every ABS event.
function makeAxisState() {
    return { LX: 0, LY: 0, RY: 0 };
}

// Returns the action handler for a given BTN code, given the active code set.
function bindingsFor(BTN) {
    var byCode = {};
    byCode[BTN.A] = function (m) { actions.smartStartPause(m); };
    byCode[BTN.B] = function (m) { actions.quit(m); };
    byCode[BTN.X] = function (m) { actions.authorize(m); };
    byCode[BTN.Y] = function (m) { actions.runMacro(m, 10); };
    byCode[BTN.START] = function (m) { actions.smartStartPause(m); };
    byCode[BTN.SELECT] = function (m) { actions.quit(m); };
    return byCode;
}

function jogSpeed() {
    try {
        var manualCfg = config.machine && config.machine.get && config.machine.get("manual");
        if (manualCfg && manualCfg.xy_speed) return manualCfg.xy_speed;
    } catch (e) {
        // fall through
    }
    return mapping.TUNABLES.JOG_SPEED_MAX;
}

function open(machine) {
    var devPath = evdev.findDevice(mapping.MATCHERS);
    if (!devPath) {
        log.info("Logitech F310 not detected");
        return null;
    }

    var ids = evdev.getDeviceIds(devPath);
    if (!ids) {
        log.warn("Found F310 at " + devPath + " but failed to read sysfs IDs");
        return null;
    }

    var BTN = mapping.buttonsForPid(ids.product);
    var bindings = bindingsFor(BTN);
    var modeLabel = ids.product === 0xc21d ? "X" : "D";

    var stream;
    try {
        stream = fs.createReadStream(devPath);
    } catch (e) {
        log.error("Failed to open F310 evdev stream at " + devPath + ": " + e.message);
        return null;
    }

    log.info("Logitech F310 connected (" + modeLabel + " mode) at " + devPath);

    var axisState = makeAxisState();
    var jogActive = null; // currently-jogging axis name ("X" | "Y" | "Z" | null)
    var jogSign = 0;      // -1 or +1, used to detect direction reversal
    var leftover = Buffer.alloc(0);

    function dispatchAxis() {
        // Find the largest-magnitude deflection across the three sticks.
        var candidates = [
            { axis: "X", defl: mapping.deflection(axisState.LX) },
            { axis: "Y", defl: -mapping.deflection(axisState.LY) }, // invert: stick up = +Y
            { axis: "Z", defl: -mapping.deflection(axisState.RY) }, // invert: stick up = +Z
        ];
        var winner = null;
        for (var i = 0; i < candidates.length; i++) {
            if (candidates[i].defl === 0) continue;
            if (!winner || Math.abs(candidates[i].defl) > Math.abs(winner.defl)) {
                winner = candidates[i];
            }
        }
        if (!winner) {
            // Everything in deadzone — stop if we were jogging.
            if (jogActive) {
                actions.jogStop(machine);
                jogActive = null;
                jogSign = 0;
            }
            return;
        }
        var newSign = winner.defl > 0 ? 1 : -1;
        // Re-issue jogStart only on axis change or direction reversal — the
        // manual runtime keeps moving at the speed of the last `start`, so we
        // don't pelt it with redundant starts on every wiggle.
        if (jogActive !== winner.axis || jogSign !== newSign) {
            if (jogActive) actions.jogStop(machine);
            var speed = winner.defl * jogSpeed();
            actions.jogStart(machine, winner.axis, speed);
            jogActive = winner.axis;
            jogSign = newSign;
        }
    }

    function handleEvent(ev) {
        if (ev.type === evdev.EV.KEY) {
            // Buttons: value 1 = press, 0 = release, 2 = autorepeat. Act on
            // press only.
            if (ev.value !== 1) return;
            var handler = bindings[ev.code];
            if (handler) {
                log.debug("F310 button code 0x" + ev.code.toString(16));
                handler(machine);
            }
        } else if (ev.type === evdev.EV.ABS) {
            switch (ev.code) {
                case mapping.ABS.LX:
                    axisState.LX = ev.value;
                    dispatchAxis();
                    break;
                case mapping.ABS.LY:
                    axisState.LY = ev.value;
                    dispatchAxis();
                    break;
                case mapping.ABS.RY:
                    axisState.RY = ev.value;
                    dispatchAxis();
                    break;
                case mapping.ABS.HAT_X:
                    if (ev.value !== 0) {
                        actions.jog(machine, "X", ev.value, mapping.TUNABLES.DPAD_STEP_SIZE, mapping.TUNABLES.DPAD_SPEED);
                    }
                    break;
                case mapping.ABS.HAT_Y:
                    if (ev.value !== 0) {
                        // Invert so up = +Y
                        actions.jog(machine, "Y", -ev.value, mapping.TUNABLES.DPAD_STEP_SIZE, mapping.TUNABLES.DPAD_SPEED);
                    }
                    break;
            }
        }
    }

    stream.on("data", function (chunk) {
        var buf = leftover.length ? Buffer.concat([leftover, chunk]) : chunk;
        var consumed = 0;
        while (buf.length - consumed >= evdev.EVENT_SIZE) {
            var ev = evdev.parseEvent(buf, consumed);
            if (ev) handleEvent(ev);
            consumed += evdev.EVENT_SIZE;
        }
        leftover = consumed < buf.length ? buf.slice(consumed) : Buffer.alloc(0);
    });

    stream.on("error", function (err) {
        log.error("F310 evdev stream error: " + err.message);
    });

    stream.on("close", function () {
        log.info("F310 evdev stream closed");
    });

    return {
        name: "logitech-f310",
        path: devPath,
        close: function () {
            try {
                stream.destroy();
            } catch (e) {
                // ignore
            }
            if (jogActive) {
                actions.jogStop(machine);
                jogActive = null;
            }
        },
    };
}

module.exports = {
    name: "logitech-f310",
    open: open,
};
