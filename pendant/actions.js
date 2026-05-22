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

function runMacro(machine, id) {
    try {
        macros.run(id);
    } catch (e) {
        log.error("runMacro(" + id + ") threw: " + e.message);
    }
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

// Continuous jog: start moving an axis at a constant speed. Used by joystick
// devices when the stick crosses out of the deadzone. Caller must invoke
// jogStop when the stick returns to center.
//
// Requires the machine to be in manual mode already. The pendant exposes a
// dedicated button (LB on the F310) for entering manual; we don't auto-enter
// here because a one-shot enter+move+nothing-else leaves the manual stream
// open with no follow-up exit, parking the state machine in "running".
function jogStart(machine, axis, speed) {
    if (!axis || !speed) return;
    if (machine.status.state !== "manual") {
        log.debug("jogStart ignored — machine is in state '" + machine.status.state + "', not 'manual'");
        return;
    }
    sendManual(machine, { cmd: "start", axis: axis, speed: speed });
}

function jogStop(machine) {
    if (machine.status.state !== "manual") return;
    sendManual(machine, { cmd: "stop" });
}

// Jog by wheel-tick (or D-pad press). Sends a fixed-distance move through the
// manual runtime. Same single-state precondition as jogStart: the machine must
// already be in manual mode (entered via a dedicated pendant button).
function jog(machine, axis, ticks, stepSize, speed) {
    if (!axis || !ticks || !stepSize) {
        return;
    }
    if (machine.status.state !== "manual") {
        log.debug("jog ignored — machine is in state '" + machine.status.state + "', not 'manual'");
        return;
    }
    var distance = ticks * stepSize;
    sendManual(machine, {
        cmd: "fixed",
        axis: axis,
        speed: speed,
        dist: distance,
    });
}

module.exports = {
    smartStartPause: smartStartPause,
    pause: pause,
    resume: resume,
    quit: quit,
    authorize: authorize,
    runMacro: runMacro,
    manualEnter: manualEnter,
    manualExit: manualExit,
    manualToggle: manualToggle,
    jog: jog,
    jogStart: jogStart,
    jogStop: jogStop,
};
