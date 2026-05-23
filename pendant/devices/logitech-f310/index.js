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

// Two motion vectors are "the same" if both axes match and the toolpath speed
// (F) and per-axis ratios are nearly identical. Below the thresholds we skip
// re-sending to avoid churn through the manual runtime when the stick creeps.
var MOTION_EPSILON_IPM = 0.5;
var RATIO_EPSILON = 0.02; // ~1.1° angle change for analog tilt

function motionChanged(a, b) {
    if (!a && !b) return false;
    if (!a || !b) return true;
    if (a.axis !== b.axis) return true;
    if ((a.secondAxis || null) !== (b.secondAxis || null)) return true;
    if (Math.abs(a.speed - b.speed) > MOTION_EPSILON_IPM) return true;
    if (Math.abs((a.primaryRatio || 0) - (b.primaryRatio || 0)) > RATIO_EPSILON) return true;
    if (Math.abs((a.secondaryRatio || 0) - (b.secondaryRatio || 0)) > RATIO_EPSILON) return true;
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
    var stopWaiting = false;   // true after we've sent jogStop and are draining the helper
    var slowMode = false;      // true while RB is held — caps jog speed at SLOW_MODE_SCALE
    var leftover = Buffer.alloc(0);

    // True while the manual driver is mid-stop (feedhold + queue flush). Calls
    // to startMotion during this window are silently dropped by the driver, so
    // we have to wait it out before issuing a new direction.
    function isStopPending() {
        var helper = machine.manual_runtime && machine.manual_runtime.helper;
        return !!(helper && helper.stop_pending);
    }

    // A motion change that requires a hard stop+restart (axis swap or true
    // sign reversal on a component). Going from 0 to a non-zero ratio (cardinal
    // → diagonal) is NOT a flip — the driver can update component ratios in
    // place and let the renew cycle pick up the new angle.
    function isDirectionChange(a, b) {
        if (!a || !b) return false;
        if (a.axis !== b.axis) return true;
        if ((a.secondAxis || null) !== (b.secondAxis || null)) return true;
        var ap = a.primaryRatio || 0;
        var bp = b.primaryRatio || 0;
        if (ap !== 0 && bp !== 0 && Math.sign(ap) !== Math.sign(bp)) return true;
        var as = a.secondaryRatio || 0;
        var bs = b.secondaryRatio || 0;
        if (as !== 0 && bs !== 0 && Math.sign(as) !== Math.sign(bs)) return true;
        return false;
    }

    // Compute the current target motion from the joystick state:
    //   Left stick (LX, LY)  → XY at any angle (analog)
    //   Right stick Y (RY)   → Z (only when no XY input)
    // Returns null if all sticks are in their deadzones.
    //
    // The toolpath F is always the configured jog speed (or slowMode * full
    // when RB is held); the joystick angle is encoded in the unit-vector
    // ratios sent alongside speed. G2 handles arbitrary-angle G1 segments
    // natively, so we just feed it the per-segment X/Y components scaled by
    // those ratios. With F constant past the deadzone, the renew batch size
    // also stays constant, which keeps the G2 planner queue stable.
    function computeMotion() {
        var defLX = mapping.deflection(axisState.LX);
        var defLY = -mapping.deflection(axisState.LY); // invert: stick up = +Y
        var defRY = -mapping.deflection(axisState.RY); // invert: stick up = +Z
        var maxSpeed = jogSpeed(slowMode);

        if (defLX !== 0 || defLY !== 0) {
            // Always emit X as primary and Y as secondary for joystick motion
            // (even if one component is zero). Keeping the axis pair stable
            // across the cardinal/diagonal boundary means the driver can do
            // an in-place ratio update — no axis-swap restart on small tilts.
            var mag = Math.sqrt(defLX * defLX + defLY * defLY);
            return {
                axis: "X",
                speed: maxSpeed,                  // toolpath F value (positive)
                secondAxis: "Y",
                secondSpeed: maxSpeed,            // present so the driver sees a second axis
                primaryRatio: defLX / mag,        // signed in [-1, +1]
                secondaryRatio: defLY / mag,      // signed in [-1, +1]
            };
        }
        if (defRY !== 0) {
            return {
                axis: "Z",
                speed: maxSpeed,
                secondAxis: null,
                secondSpeed: 0,
                primaryRatio: defRY > 0 ? 1 : -1,
                secondaryRatio: 0,
            };
        }
        return null;
    }

    // Publish the post-deadzone joystick deflection to any listener (the
    // dashboard renders a direction indicator from this). Only emits when
    // the value moves enough to be perceptible — keeps idle socket traffic
    // to zero, and active gestures at well under the processMotion rate.
    var lastJoystickEmit = null;
    function emitJoystickState() {
        var defLX = mapping.deflection(axisState.LX);
        var defLY = -mapping.deflection(axisState.LY);
        var defRY = -mapping.deflection(axisState.RY);
        var state = { x: defLX, y: defLY, z: defRY };
        var EPSILON = 0.01;
        if (lastJoystickEmit &&
            Math.abs(state.x - lastJoystickEmit.x) < EPSILON &&
            Math.abs(state.y - lastJoystickEmit.y) < EPSILON &&
            Math.abs(state.z - lastJoystickEmit.z) < EPSILON) {
            return;
        }
        lastJoystickEmit = state;
        machine.emit("pendant_joystick", state);
    }

    function processMotion() {
        emitJoystickState();
        // No motion if not in manual mode — keep state clean so re-entering
        // manual picks up where the user has the sticks at that moment.
        if (machine.status.state !== "manual") {
            if (lastMotion) {
                actions.jogStop(machine);
                lastMotion = null;
            }
            pendingStart = null;
            stopWaiting = false;
            return;
        }

        var motion = computeMotion();

        // Sticks back to neutral — stop and clear any pending direction change.
        // Issue jogStop if anything is in flight: active motion OR a queued
        // restart whose jogStart hasn't fired yet. Without the pendingStart
        // check here, releasing the stick mid-direction-change leaves no
        // signal to halt motion that the pending restart might have started.
        if (!motion) {
            if (lastMotion || pendingStart) {
                actions.jogStop(machine);
                stopWaiting = true;
                lastMotion = null;
            }
            pendingStart = null;
            return;
        }

        // Any new motion that follows a stop must wait for the helper to clear
        // stop_pending before issuing jogStart. The driver's `moving` flag
        // lingers for up to 2 s after STAT_END (movement_timer fallback) — if
        // we restart during that window, we want the helper fully settled so
        // the smooth-transition path properly updates currentDirection.
        if (pendingStart || stopWaiting) {
            pendingStart = motion;
            if (!isStopPending()) {
                actions.jogStart(machine, motion.axis, motion.speed, motion.secondAxis, motion.secondSpeed, motion.primaryRatio, motion.secondaryRatio);
                lastMotion = motion;
                pendingStart = null;
                stopWaiting = false;
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
            stopWaiting = true;
            return;
        }

        // Speed-only change (same axis, same sign): smooth transition is fine.
        if (!motionChanged(motion, lastMotion)) return;
        actions.jogStart(machine, motion.axis, motion.speed, motion.secondAxis, motion.secondSpeed, motion.primaryRatio, motion.secondaryRatio);
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
            if (lastMotion || pendingStart) {
                actions.jogStop(machine);
                lastMotion = null;
            }
            pendingStart = null;
            stopWaiting = false;
        },
    };
}

module.exports = {
    name: "logitech-f310",
    open: open,
};
