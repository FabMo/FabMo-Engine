// Device-agnostic action dispatcher for pendants and other input devices.
//
// Devices in pendant/devices/* translate raw input into semantic events and
// call into these helpers. The helpers wrap machine methods with the same
// arm-throw try/catch that routes/macros.js, routes/state.js, etc. use, since
// we're not in an HTTP request context — an uncaught synchronous throw would
// kill the engine.

var log = require("../log").logger("pendant");
var macros = require("../macros");

// State-aware "primary" button (the green start-pause button on most pendants).
// idle (auth required): authorize the machine
// idle (no auth):       no-op (caller may bind to something else)
// armed:                fire (proceed past the authorize gate)
// running, probing:     pause
// paused:               resume
// anything else:        log and ignore
function smartStartPause(machine) {
    var state = machine.status && machine.status.state;
    try {
        switch (state) {
            case "idle":
            case "armed":
                machine.authorize();
                break;
            case "running":
            case "probing":
                machine.pause();
                break;
            case "paused":
                machine.resume();
                break;
            default:
                log.debug("smartStartPause: ignoring in state '" + state + "'");
        }
    } catch (e) {
        log.error("smartStartPause threw: " + e.message);
    }
}

function pause(machine) {
    try {
        machine.pause();
    } catch (e) {
        log.error("pause threw: " + e.message);
    }
}

function resume(machine) {
    try {
        machine.resume();
    } catch (e) {
        log.error("resume threw: " + e.message);
    }
}

function quit(machine) {
    try {
        machine.quit();
    } catch (e) {
        log.error("quit threw: " + e.message);
    }
}

// Physical-presence authorize. Goes through the same Machine.authorize() path
// that the input-channel handleFireButton uses, so existing auth-timeout
// behavior applies.
function authorize(machine) {
    try {
        machine.authorize();
    } catch (e) {
        log.error("authorize threw: " + e.message);
    }
}

// Manual mode owns the runtime, so a runFile/runtime-switch issued from within
// manual mode races the exit and gets dropped. Mirror the dashboard keypad
// pattern (main.js calledFromModal): send exit, wait for the status update
// that shows we've left manual, then dispatch the action. fn() is called once.
function runAfterManualExit(machine, fn) {
    if (machine.status.state !== "manual") {
        fn();
        return;
    }
    var fired = false;
    var fire = function () {
        if (fired) return;
        fired = true;
        machine.removeListener("status", onStatus);
        clearTimeout(timer);
        fn();
    };
    var onStatus = function (status) {
        if (status.state !== "manual") fire();
    };
    machine.on("status", onStatus);
    // Fallback: if no status update transitions us out within 2 s, give up
    // listening so we don't pin the handler forever. fn() does NOT fire on
    // timeout — that would race the still-in-flight exit.
    var timer = setTimeout(function () {
        if (fired) return;
        fired = true;
        machine.removeListener("status", onStatus);
        log.warn("runAfterManualExit: timed out waiting for manual to exit; action dropped");
    }, 2000);
    sendManual(machine, { cmd: "exit" });
}

function runMacro(machine, id) {
    runAfterManualExit(machine, function () {
        try {
            macros.run(id);
        } catch (e) {
            log.error("runMacro(" + id + ") threw: " + e.message);
        }
    });
}

// Submit raw SBP code as a one-shot job. Use this for pendant buttons that
// map to a built-in SBP command (JH, JZ, etc.) rather than a numbered macro.
// machine.sbp() handles runtime selection.
function runSbp(machine, code) {
    runAfterManualExit(machine, function () {
        try {
            machine.sbp(code);
        } catch (e) {
            log.error("runSbp(" + JSON.stringify(code) + ") threw: " + e.message);
        }
    });
}

// Feedrate override — same path as the dashboard FRO arrows in events.js.
// machine.frOverride takes a percent 5..200; status.fro is a fraction.
// Step is in percent points (dashboard uses ±5; default that here).
function adjustFro(machine, deltaPercent) {
    var cur = (+machine.status.fro || 1) * 100;
    var snapped = Math.round(cur / 5) * 5;
    var next = Math.min(200, Math.max(5, snapped + deltaPercent));
    if (next === snapped) return;
    machine.frOverride(next);
}

// Spindle RPM setpoint adjust — same path as the dashboard SPINDLE arrows.
// machine.spindleSpeed takes RPM and pushes it straight to the VFD. We step
// from the VFD's designated frequency (already in RPM via RPM_MULT). If the
// VFD isn't reporting yet, fall back to a sensible idle so a single press
// doesn't lurch from 0; clamp to the machine's accepted 100..30000 range.
function adjustSpindleRpm(machine, deltaRpm) {
    var spStatus = machine.status.spindle;
    var cur = (spStatus && spStatus.vfdDesgFreq > 0) ? spStatus.vfdDesgFreq : 12000;
    var snapped = Math.round(cur / 100) * 100;
    var next = Math.min(30000, Math.max(100, snapped + deltaRpm));
    if (next === snapped) return;
    machine.spindleSpeed(next);
}

// Set a discrete output to 0 or 1. Uses the manual runtime's output command —
// same path as the dashboard's action-5 spindle button — so the machine must
// already be in manual mode (LB press).
function setOutput(machine, outNum, value) {
    if (machine.status.state !== "manual") {
        log.debug("setOutput ignored — machine not in manual mode");
        return;
    }
    sendManual(machine, { cmd: "output", out: { output: outNum, value: value } });
}

// Flip a discrete output's current state.
function toggleOutput(machine, outNum) {
    var current = machine.status["out" + outNum];
    setOutput(machine, outNum, current ? 0 : 1);
}

// All manual-runtime dispatch goes through machine.executeRuntimeCode (the same
// entry the dashboard uses via the websocket "code" event). That entry handles
// runtime selection, lazy connect, and the auth-gate (arming if not yet
// authorized). Calling manual_runtime.executeCode directly would skip the
// connect step and throw because this.machine is null inside the runtime.
function sendManual(machine, code) {
    try {
        machine.executeRuntimeCode("manual", code);
    } catch (e) {
        log.error("manual " + code.cmd + " threw: " + e.message);
    }
}

// Enter manual mode explicitly (e.g. from a dedicated pendant button).
function manualEnter(machine, opts) {
    if (machine.status.state === "manual") return; // already in manual
    sendManual(machine, {
        cmd: "enter",
        mode: (opts && opts.mode) || undefined,
        hideKeypad: opts && opts.hideKeypad !== undefined ? opts.hideKeypad : true,
    });
}

function manualExit(machine) {
    if (machine.status.state !== "manual") return;
    sendManual(machine, { cmd: "exit" });
}

// Toggle manual mode: enter if not in manual, exit if already in manual.
function manualToggle(machine, opts) {
    if (machine.status.state === "manual") {
        manualExit(machine);
    } else {
        manualEnter(machine, opts);
    }
}

// Continuous jog: start moving along one or two axes at constant signed speeds.
// Used by joystick devices when sticks deflect past the deadzone. The manual
// driver's startMotion deduplicates same-axis+same-speed calls and handles
// smooth axis/speed transitions, so callers can re-issue this freely at any
// rate without churning G2.
//
// Requires the machine to be in manual mode already (entered via LB).
function jogStart(machine, axis, speed, secondAxis, secondSpeed, primaryRatio, secondaryRatio) {
    if (!axis || !speed) return;
    if (machine.status.state !== "manual") {
        log.debug("jogStart ignored — machine is in state '" + machine.status.state + "', not 'manual'");
        return;
    }
    var code = { cmd: "start", axis: axis, speed: speed };
    if (secondAxis && secondSpeed) {
        code.second_axis = secondAxis;
        code.second_speed = secondSpeed;
    }
    // Optional analog vector form: ratios carry the toolpath unit vector
    // components (signed, sum-of-squares = 1). When present, the driver uses
    // them to scale per-axis segments instead of the legacy ±1 / second-sign
    // mapping, which only encoded cardinals and 45° diagonals.
    if (primaryRatio !== undefined) {
        code.primary_ratio = primaryRatio;
        code.secondary_ratio = secondaryRatio || 0;
    }
    sendManual(machine, code);
}

function jogStop(machine) {
    if (machine.status.state !== "manual") return;
    sendManual(machine, { cmd: "stop" });
}

// Jog by wheel-tick (or D-pad press). Sends a fixed-distance move through the
// manual runtime. Same single-state precondition as jogStart: the machine must
// already be in manual mode (entered via a dedicated pendant button).
function jog(machine, axis, ticks, stepSize, speed, opts) {
    if (!axis || !ticks || !stepSize) {
        return;
    }
    if (machine.status.state !== "manual") {
        log.debug("jog ignored — machine is in state '" + machine.status.state + "', not 'manual'");
        return;
    }
    // opts.distance overrides ticks*stepSize for callers that have already
    // computed the exact move they want (e.g. the wheel state machine, which
    // does its own snap-to-grid using a planned-position cache). Stepsize is
    // still required up top so log/debug paths see what the caller intended.
    var distance = (opts && opts.distance !== undefined) ? opts.distance : ticks * stepSize;
    var cmd = {
        cmd: "fixed",
        axis: axis,
        speed: speed,
        dist: distance,
    };
    // opts.snap: false → caller has already snapped (or wants pure relative).
    // Default snap-to-grid in the driver suits keypad-style jogging where each
    // tap walks to the next round increment.
    if (opts && opts.snap === false) cmd.snap = false;
    sendManual(machine, cmd);
}

module.exports = {
    smartStartPause: smartStartPause,
    pause: pause,
    resume: resume,
    quit: quit,
    authorize: authorize,
    runMacro: runMacro,
    runSbp: runSbp,
    adjustFro: adjustFro,
    adjustSpindleRpm: adjustSpindleRpm,
    setOutput: setOutput,
    toggleOutput: toggleOutput,
    manualEnter: manualEnter,
    manualExit: manualExit,
    manualToggle: manualToggle,
    jog: jog,
    jogStart: jogStart,
    jogStop: jogStop,
};
