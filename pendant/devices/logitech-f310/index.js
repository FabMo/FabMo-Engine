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
//                        OR (when cut mode active): up/down = diameter±,
//                        left/right = depth±
//   A                  → smart start/pause/authorize
//   B                  → quit
//   X                  → run macro 3
//   Y                  → toggle output 1
//   Start              → smart start/pause/authorize
//   Back/Select        → quit
//   LB                 → manual mode toggle
//   RB (held)          → slow-mode modifier (0.2x jog speed)
//   LSTICK click       → toolbox mode toggle (enter/exit)
//   RSTICK click       → toolbox commit (execute the currently configured cut)
//   LT / RT            → unbound (reserved)
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


// Processor tick rate. ~20 Hz keeps the stick-to-tool latency under ~50ms while
// staying well under the manual driver's renew rate. The driver's startMotion
// deduplicates same-axis+same-speed calls internally so this is safe to run
// continuously while the device is open.
var PROCESS_HZ = 20;

// Returns the action handler for a given BTN code, given the active code set.
// ctx provides shared pendant state (fileBrowser, toolbox controller).
function bindingsFor(BTN, ctx) {
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
    // Canned-cut bindings: LSTICK enters/exits cut mode, RSTICK commits the
    // currently configured cut (reads current XY/Z, generates G-code, runs
    // it as a temp file). D-pad behavior is context-sensitive (see
    // handleEvent below); these click bindings are toggles only.
    if (BTN.LSTICK && ctx && ctx.toolbox) {
        byCode[BTN.LSTICK] = function () { ctx.toolbox.toggle(); };
    }
    if (BTN.RSTICK && ctx && ctx.toolbox) {
        byCode[BTN.RSTICK] = function () { ctx.toolbox.commit(); };
    }
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

function open(machine, ctx) {
    ctx = ctx || {};
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
    var bindings = bindingsFor(BTN, ctx);
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
    var lastMotion = null;     // last motion vector sent to manual runtime (null while stick is at rest)
    var slowMode = false;      // true while RB is held — caps jog speed at SLOW_MODE_SCALE
    var leftover = Buffer.alloc(0);

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
            return;
        }

        var motion = computeMotion();

        // Sticks back to neutral — emit a single jogStop so the firmware can
        // ramp down and exit the cycle. lastMotion is the marker that we have
        // an in-flight cycle to stop.
        if (!motion) {
            if (lastMotion) {
                actions.jogStop(machine);
                lastMotion = null;
            }
            return;
        }

        // Re-send on every tick while the stick is deflected, regardless of
        // direction changes or whether the vector matches last tick. The
        // firmware velocity-jog cycle handles sign flips and angle changes
        // mid-flight — we do NOT need a host-side stop+restart dance for
        // reversals (that was a legacy G1-segment-streaming workaround).
        //
        // The firmware also has a 500 ms watchdog that auto-stops on host
        // silence, so a stick held steady would time out without the re-send.
        // At PROCESS_HZ=20 the bandwidth cost is trivial (~600 B/s of JSON)
        // and the firmware setter is a no-op when the velocity hasn't changed.
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
                // Clear lastMotion so the next processMotion tick treats this
                // as a fresh send rather than a no-op heartbeat — needed so
                // the new (slow-scaled) speed reaches the firmware promptly.
                if (lastMotion) lastMotion = null;
                return;
            }
            if (ev.value !== 1) return;
            var handler = bindings[ev.code];
            if (handler) {
                log.debug("F310 button code 0x" + ev.code.toString(16));
                handler(machine);
            } else {
                // Unbound buttons logged at debug so kernel-specific code
                // discovery is still possible without spamming on every press.
                log.debug("F310 unbound button code 0x" + ev.code.toString(16));
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
                        // Context switch: when a toolbox is active, the
                        // D-pad adjusts the depth parameter; otherwise it
                        // does its normal X-axis fixed-step jog.
                        if (ctx.toolbox && ctx.toolbox.state === "active") {
                            ctx.toolbox.adjustParam("depth", ev.value);
                        } else {
                            actions.jog(machine, "X", ev.value, mapping.TUNABLES.DPAD_STEP_SIZE, mapping.TUNABLES.DPAD_SPEED);
                        }
                    }
                    break;
                case mapping.ABS.HAT_Y:
                    if (ev.value !== 0) {
                        // Active cut: D-pad up/down adjusts diameter.
                        // (HAT_Y value -1 = up, +1 = down per evdev; invert
                        // so up = +diameter, down = -diameter.)
                        if (ctx.toolbox && ctx.toolbox.state === "active") {
                            ctx.toolbox.adjustParam("diameter", -ev.value);
                        } else {
                            // Invert so up = +Y for jog as well.
                            actions.jog(machine, "Y", -ev.value, mapping.TUNABLES.DPAD_STEP_SIZE, mapping.TUNABLES.DPAD_SPEED);
                        }
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
