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

// Continuous jog: start moving an axis at a constant speed. Used by joystick
// devices when the stick crosses out of the deadzone. Caller must invoke
// jogStop when the stick returns to center.
function jogStart(machine, axis, speed) {
    if (!axis || !speed) return;
    var manual = machine.runtimes && machine.runtimes.manual;
    if (!manual) {
        log.warn("jogStart: manual runtime unavailable");
        return;
    }
    try {
        if (machine.status.state !== "manual") {
            manual.executeCode({ cmd: "enter", hideKeypad: true });
        }
        manual.executeCode({ cmd: "start", axis: axis, speed: speed });
    } catch (e) {
        log.error("jogStart threw: " + e.message);
    }
}

function jogStop(machine) {
    var manual = machine.runtimes && machine.runtimes.manual;
    if (!manual) return;
    try {
        manual.executeCode({ cmd: "stop" });
    } catch (e) {
        log.error("jogStop threw: " + e.message);
    }
}

// Jog by wheel-tick. Ensures the machine is in the manual runtime and dispatches
// a fixed move. ticks is the signed wheel delta; stepSize is the per-tick
// distance in current machine units. speed is a sensible jog speed.
function jog(machine, axis, ticks, stepSize, speed) {
    if (!axis || !ticks || !stepSize) {
        return;
    }
    var distance = ticks * stepSize;
    var manual = machine.runtimes && machine.runtimes.manual;
    if (!manual) {
        log.warn("jog: manual runtime unavailable");
        return;
    }
    try {
        // If we're not already in manual mode, enter (hideKeypad keeps the modal
        // off the screen — the operator is at the pendant, not the dashboard).
        if (machine.status.state !== "manual") {
            manual.executeCode({ cmd: "enter", hideKeypad: true });
        }
        manual.executeCode({
            cmd: "fixed",
            axis: axis,
            speed: speed,
            dist: distance,
        });
    } catch (e) {
        log.error("jog threw: " + e.message);
    }
}

module.exports = {
    smartStartPause: smartStartPause,
    pause: pause,
    resume: resume,
    quit: quit,
    authorize: authorize,
    runMacro: runMacro,
    jog: jog,
    jogStart: jogStart,
    jogStop: jogStop,
};
