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
//   Right stick (wedged): only one axis per gesture, decided by stick angle
//                        — within ±10° of horizontal → A (stick right = +A)
//                        — within ±10° of vertical   → Z (stick up    = +Z)
//                        — everywhere else (~70° dead band per quadrant) → no motion
//                        This guarantees A and Z can never run together.
//   Triggers (analog)  → B (proportional to pull): RT = +B, LT = −B
//                        Right stick wins if both are active.
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
//   LSTICK click       → canned-cut mode toggle (enter/exit)
//   RSTICK click       → canned-cut commit (execute the currently configured cut)
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
// LT/RT rest at 0 (one-sided 0..255), sticks rest at 0 (signed -32768..+32767).
function makeAxisState() {
    return { LX: 0, LY: 0, RX: 0, RY: 0, LT: 0, RT: 0 };
}


// Processor tick rate. ~20 Hz keeps the stick-to-tool latency under ~50ms while
// staying well under the manual driver's renew rate. The driver's startMotion
// deduplicates same-axis+same-speed calls internally so this is safe to run
// continuously while the device is open.
var PROCESS_HZ = 20;

// Returns the action handler for a given BTN code, given the active code set.
// ctx provides shared pendant state (fileBrowser, cannedCuts controller).
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
    if (BTN.LSTICK && ctx && ctx.cannedCuts) {
        byCode[BTN.LSTICK] = function () { ctx.cannedCuts.toggle(); };
    }
    if (BTN.RSTICK && ctx && ctx.cannedCuts) {
        byCode[BTN.RSTICK] = function () { ctx.cannedCuts.commit(); };
    }
    return byCode;
}

// Slow-mode (RB held) multiplies the effective jog speed by this fraction.
var SLOW_MODE_SCALE = 0.2;

// Read an opensbp speed config value (units/sec) safely. Returns null on
// any miss so callers can fall back.
function opensbpSpeed(key) {
    try {
        var v = config.opensbp && config.opensbp.get && config.opensbp.get(key);
        if (typeof v === "number" && v > 0) return v;
    } catch (e) {
        // fall through
    }
    return null;
}

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

// A-axis jog speed in units/min from opensbp.movea_speed. Falls back to the
// XY jog speed if movea_speed isn't configured (avoids zero-speed lockouts on
// a freshly initialized machine).
function jogSpeedA(slowMode) {
    var v = opensbpSpeed("movea_speed");
    var base = v != null ? v * 60 : jogSpeed(false);
    return slowMode ? base * SLOW_MODE_SCALE : base;
}

// B-axis jog speed in units/min from opensbp.moveb_speed (same fallback).
function jogSpeedB(slowMode) {
    var v = opensbpSpeed("moveb_speed");
    var base = v != null ? v * 60 : jogSpeed(false);
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
    //   Left stick (LX, LY)            → XY at any angle (analog)
    //   Right stick (RX, RY) in wedge  → A (horizontal wedge) or Z (vertical wedge)
    //                                    Wedges are ±RIGHT_WEDGE_DEG of a cardinal.
    //                                    The ~70° band between wedges is dead.
    //   Triggers (LT, RT)              → B, proportional to pull (RT=+, LT=−)
    //
    // Priority: left stick wins, then right stick, then triggers. Returns null
    // if everything is at rest.
    //
    // For analog stick gestures the toolpath F is always the configured jog
    // speed (or slowMode * full when RB is held); the stick angle is encoded
    // in the unit-vector ratios sent alongside speed. G2 handles arbitrary-
    // angle G1 segments natively. With F constant past the deadzone, the
    // renew batch size stays constant, which keeps the G2 planner queue stable.
    function computeMotion() {
        var defLX = mapping.deflection(axisState.LX);
        var defLY = -mapping.deflection(axisState.LY); // invert: stick up = +Y
        var defRX = mapping.deflection(axisState.RX);
        var defRY = -mapping.deflection(axisState.RY); // invert: stick up = +Z

        // 1. Left stick → XY.
        if (defLX !== 0 || defLY !== 0) {
            var xySpeed = jogSpeed(slowMode);
            // Always emit X as primary and Y as secondary for joystick motion
            // (even if one component is zero). Keeping the axis pair stable
            // across the cardinal/diagonal boundary means the driver can do
            // an in-place ratio update — no axis-swap restart on small tilts.
            var mag = Math.sqrt(defLX * defLX + defLY * defLY);
            return {
                axis: "X",
                speed: xySpeed,                   // toolpath F value (positive)
                secondAxis: "Y",
                secondSpeed: xySpeed,             // present so the driver sees a second axis
                primaryRatio: defLX / mag,        // signed in [-1, +1]
                secondaryRatio: defLY / mag,      // signed in [-1, +1]
            };
        }

        // 2. Right stick → A or Z, picked by wedge. Inside the wedge the
        //    cardinal direction wins at full configured speed; the band
        //    between wedges yields no motion (returns null).
        if (defRX !== 0 || defRY !== 0) {
            var absRX = Math.abs(defRX);
            var absRY = Math.abs(defRY);
            // Horizontal wedge: |RY| < |RX| * tan(wedge).
            if (defRX !== 0 && absRY < absRX * mapping.RIGHT_WEDGE_TAN) {
                return {
                    axis: "A",
                    speed: jogSpeedA(slowMode),
                    secondAxis: null,
                    secondSpeed: 0,
                    primaryRatio: defRX > 0 ? 1 : -1,
                    secondaryRatio: 0,
                };
            }
            // Vertical wedge: |RX| < |RY| * tan(wedge).
            if (defRY !== 0 && absRX < absRY * mapping.RIGHT_WEDGE_TAN) {
                return {
                    axis: "Z",
                    speed: jogSpeed(slowMode),
                    secondAxis: null,
                    secondSpeed: 0,
                    primaryRatio: defRY > 0 ? 1 : -1,
                    secondaryRatio: 0,
                };
            }
            // In the dead band between wedges — fall through to null so the
            // user gets clear feedback that the gesture is ambiguous.
            return null;
        }

        // 3. Triggers → B, proportional. RT is positive, LT is negative.
        //    If both are held, the larger pull wins (no opposing tug-of-war).
        var defLT = mapping.triggerDeflection(axisState.LT);
        var defRT = mapping.triggerDeflection(axisState.RT);
        if (defLT > 0 || defRT > 0) {
            var bDeflection = defRT >= defLT ? defRT : defLT;
            var bDir = defRT >= defLT ? 1 : -1;
            // Proportional: trigger pull scales the toolpath F directly. The
            // driver tolerates F changes inside the jog cycle (firmware JGV
            // accepts updated velocity setpoints without stop/restart).
            return {
                axis: "B",
                speed: jogSpeedB(slowMode) * bDeflection,
                secondAxis: null,
                secondSpeed: 0,
                primaryRatio: bDir,
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
        var defRX = mapping.deflection(axisState.RX);
        var defRY = -mapping.deflection(axisState.RY);
        var defLT = mapping.triggerDeflection(axisState.LT);
        var defRT = mapping.triggerDeflection(axisState.RT);
        // a/b are the *resolved* axis signals — what the right stick wedge or
        // the trigger pair would currently drive — so dashboard indicators
        // can show the actual selection rather than reproducing the wedge
        // math. x/y/z keep their raw stick deflection (legacy contract).
        var a = 0;
        var z = defRY;
        if (defRX !== 0 || defRY !== 0) {
            var absRX = Math.abs(defRX);
            var absRY = Math.abs(defRY);
            if (defRX !== 0 && absRY < absRX * mapping.RIGHT_WEDGE_TAN) {
                a = defRX > 0 ? 1 : -1;
                z = 0;
            } else if (defRY !== 0 && absRX < absRY * mapping.RIGHT_WEDGE_TAN) {
                a = 0;
                // z keeps its signed deflection
            } else {
                a = 0;
                z = 0;
            }
        }
        var b = defRT >= defLT ? defRT : -defLT;
        var state = { x: defLX, y: defLY, z: z, a: a, b: b };
        var EPSILON = 0.01;
        if (lastJoystickEmit &&
            Math.abs(state.x - lastJoystickEmit.x) < EPSILON &&
            Math.abs(state.y - lastJoystickEmit.y) < EPSILON &&
            Math.abs(state.z - lastJoystickEmit.z) < EPSILON &&
            Math.abs(state.a - lastJoystickEmit.a) < EPSILON &&
            Math.abs(state.b - lastJoystickEmit.b) < EPSILON) {
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
                case mapping.ABS.RX:
                    axisState.RX = ev.value;
                    break;
                case mapping.ABS.RY:
                    axisState.RY = ev.value;
                    break;
                case mapping.ABS.LT:
                    axisState.LT = ev.value;
                    break;
                case mapping.ABS.RT:
                    axisState.RT = ev.value;
                    break;
                case mapping.ABS.HAT_X:
                    if (ev.value !== 0) {
                        // Context switch: when a canned cut is active, the
                        // D-pad adjusts the depth parameter; otherwise it
                        // does its normal X-axis fixed-step jog.
                        if (ctx.cannedCuts && ctx.cannedCuts.state === "active") {
                            ctx.cannedCuts.adjustParam("depth", ev.value);
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
                        if (ctx.cannedCuts && ctx.cannedCuts.state === "active") {
                            ctx.cannedCuts.adjustParam("diameter", -ev.value);
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
