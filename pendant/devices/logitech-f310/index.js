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

// Two motion vectors are "the same" if both axes match and the speeds differ
// by less than this many IPM. Below the threshold we skip re-sending to avoid
// burning bandwidth through the manual runtime when the stick is creeping.
var MOTION_EPSILON_IPM = 0.5;

function motionChanged(a, b) {
    if (!a && !b) return false;
    if (!a || !b) return true;
    if (a.axis !== b.axis) return true;
    if ((a.secondAxis || null) !== (b.secondAxis || null)) return true;
    if (Math.abs(a.speed - b.speed) > MOTION_EPSILON_IPM) return true;
    if (Math.abs((a.secondSpeed || 0) - (b.secondSpeed || 0)) > MOTION_EPSILON_IPM) return true;
    return false;
}

// Processor tick rate. ~20 Hz keeps the stick-to-tool latency under ~50ms while
// staying well under the manual driver's renew rate. The driver's startMotion
// deduplicates same-axis+same-speed calls internally so this is safe to run
// continuously while the device is open.
var PROCESS_HZ = 20;

// Returns the action handler for a given BTN code, given the active code set.
function bindingsFor(BTN) {
    var byCode = {};
    byCode[BTN.A] = function (m) { actions.authorize(m); };
    byCode[BTN.B] = function (m) { actions.quit(m); };
    byCode[BTN.X] = function (m) { actions.runMacro(m, 3); };
    byCode[BTN.Y] = function (m) { actions.toggleOutput(m, 1); };
    byCode[BTN.START] = function (m) { actions.smartStartPause(m); };
    byCode[BTN.SELECT] = function (m) { actions.quit(m); };
    // LB toggles manual mode (enter if idle, exit if in manual). Sticks and
    // D-pad only jog while in manual mode. RB is a held slow-mode modifier
    // (see press/release handling in handleEvent) rather than a press-action.
    if (BTN.LB) byCode[BTN.LB] = function (m) { actions.manualToggle(m, { hideKeypad: false }); };
    return byCode;
}

// Slow-mode (RB held) multiplies the effective jog speed by this fraction.
var SLOW_MODE_SCALE = 0.2;

// Returns the max XY jog speed in IPM (machine units per minute) for full
// stick deflection. Honors the manual-keypad speed slider, which writes its
// value to config.machine.manual.xy_speed in IPS. Dashboard multiplies by 60
// to get G2's feedrate units (units per minute); we do the same here.
function jogSpeed(slowMode) {
    var base;
    try {
        var manualCfg = config.machine && config.machine.get && config.machine.get("manual");
        if (manualCfg && manualCfg.xy_speed) {
            base = manualCfg.xy_speed * 60;
        }
    } catch (e) {
        // fall through
    }
    if (base == null) base = mapping.TUNABLES.JOG_SPEED_MAX;
    return slowMode ? base * SLOW_MODE_SCALE : base;
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
    var lastMotion = null;     // last motion vector sent to manual runtime
    var pendingStart = null;   // motion to issue once the manual driver's stop clears
    var slowMode = false;      // true while RB is held — caps jog speed at SLOW_MODE_SCALE
    var leftover = Buffer.alloc(0);

    // True while the manual driver is mid-stop (feedhold + queue flush). Calls
    // to startMotion during this window are silently dropped by the driver, so
    // we have to wait it out before issuing a new direction.
    function isStopPending() {
        var helper = machine.manual_runtime && machine.manual_runtime.helper;
        return !!(helper && helper.stop_pending);
    }

    // A motion change that requires a hard stop+restart (axis swap or direction
    // reversal) rather than the driver's smooth in-place feedrate update.
    function isDirectionChange(a, b) {
        if (!a || !b) return false;
        if (a.axis !== b.axis) return true;
        if (Math.sign(a.speed) !== Math.sign(b.speed)) return true;
        if ((a.secondAxis || null) !== (b.secondAxis || null)) return true;
        if (Math.sign(a.secondSpeed || 0) !== Math.sign(b.secondSpeed || 0)) return true;
        return false;
    }

    // Compute the current target motion from the joystick state:
    //   Left stick (LX, LY)  → XY combined or single-axis
    //   Right stick Y (RY)   → Z (only when no XY input)
    // Returns null if all sticks are in their deadzones.
    function computeMotion() {
        var defLX = mapping.deflection(axisState.LX);
        var defLY = -mapping.deflection(axisState.LY); // invert: stick up = +Y
        var defRY = -mapping.deflection(axisState.RY); // invert: stick up = +Z
        var maxSpeed = jogSpeed(slowMode);

        var hasXY = defLX !== 0 || defLY !== 0;
        if (hasXY) {
            if (defLX !== 0 && defLY !== 0) {
                return {
                    axis: "X",
                    speed: defLX * maxSpeed,
                    secondAxis: "Y",
                    secondSpeed: defLY * maxSpeed,
                };
            }
            if (defLX !== 0) {
                return { axis: "X", speed: defLX * maxSpeed, secondAxis: null, secondSpeed: 0 };
            }
            return { axis: "Y", speed: defLY * maxSpeed, secondAxis: null, secondSpeed: 0 };
        }
        if (defRY !== 0) {
            return { axis: "Z", speed: defRY * maxSpeed, secondAxis: null, secondSpeed: 0 };
        }
        return null;
    }

    function processMotion() {
        // No motion if not in manual mode — keep state clean so re-entering
        // manual picks up where the user has the sticks at that moment.
        if (machine.status.state !== "manual") {
            if (lastMotion) {
                actions.jogStop(machine);
                lastMotion = null;
            }
            pendingStart = null;
            return;
        }

        var motion = computeMotion();

        // Sticks back to neutral — stop and clear any pending direction change.
        if (!motion) {
            if (lastMotion) {
                actions.jogStop(machine);
                lastMotion = null;
            }
            pendingStart = null;
            return;
        }

        // Waiting for a previous stop (issued because direction changed) to
        // clear. Keep the pending motion in sync with the latest stick state
        // so we issue the right vector when the driver's queue drains.
        if (pendingStart) {
            pendingStart = motion;
            if (!isStopPending()) {
                actions.jogStart(machine, motion.axis, motion.speed, motion.secondAxis, motion.secondSpeed);
                lastMotion = motion;
                pendingStart = null;
            }
            return;
        }

        // Direction change requires a hard stop — the driver's smooth path only
        // updates feedrate, leaving already-queued G2 segments running in the
        // old direction. stopMotion does feedhold + queue flush so the new
        // direction takes effect promptly.
        if (lastMotion && isDirectionChange(motion, lastMotion)) {
            actions.jogStop(machine);
            pendingStart = motion;
            lastMotion = null;
            return;
        }

        // Speed-only change (same axis, same sign): smooth transition is fine.
        if (!motionChanged(motion, lastMotion)) return;
        actions.jogStart(machine, motion.axis, motion.speed, motion.secondAxis, motion.secondSpeed);
        lastMotion = motion;
    }

    var processTimer = setInterval(processMotion, Math.round(1000 / PROCESS_HZ));

    function handleEvent(ev) {
        if (ev.type === evdev.EV.KEY) {
            // Buttons: value 1 = press, 0 = release, 2 = autorepeat.
            // RB is a held modifier (slow mode), so we track press AND release.
            // Everything else acts on press only.
            if (ev.code === BTN.RB) {
                slowMode = ev.value !== 0;
                // Bump the next processMotion tick to apply the new scale to
                // the current motion vector promptly. lastMotion needs reset
                // so motionChanged sees the new speed as a difference.
                if (lastMotion) lastMotion = null;
                return;
            }
            if (ev.value !== 1) return;
            var handler = bindings[ev.code];
            if (handler) {
                log.debug("F310 button code 0x" + ev.code.toString(16));
                handler(machine);
            }
        } else if (ev.type === evdev.EV.ABS) {
            switch (ev.code) {
                // Joystick deflections — captured here; the throttled
                // processMotion timer turns them into manual-runtime calls.
                case mapping.ABS.LX:
                    axisState.LX = ev.value;
                    break;
                case mapping.ABS.LY:
                    axisState.LY = ev.value;
                    break;
                case mapping.ABS.RY:
                    axisState.RY = ev.value;
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
            clearInterval(processTimer);
            if (lastMotion) {
                actions.jogStop(machine);
                lastMotion = null;
            }
        },
    };
}

module.exports = {
    name: "logitech-f310",
    open: open,
};
