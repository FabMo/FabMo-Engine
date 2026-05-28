// XHC LHB04B-6 LCD display driver.
//
// Subscribes to the machine status stream, throttles to TICK_HZ, encodes via
// encoder.js, and writes the three HID OUT reports through the hidraw handle
// the device adapter opened. Skips writes when the encoded payload matches
// the last one sent, so an idle machine produces no USB traffic.

var encoder = require("./encoder");

var TICK_HZ = 5;
var IDLE_REPUSH_MS = 1500; // re-send even unchanged payload at this cadence
                           // so the pendant doesn't time-out the display

// Translate FabMo's machine status into the encoder's state object.
//   wheelMode: "step" | "continuous" | null  — picked by the Step/Continuous
//              buttons; drives the CON/STEP indicator on the LCD.
//              The MPG/PERCENT modes are reserved for v2 (jog-while-running).
function buildState(status, wheelMode, seed) {
    if (!status) status = {};
    var stepMode = wheelMode === "step" ? encoder.STEP_MODE.STEP : encoder.STEP_MODE.CON;
    return {
        seed: seed,
        stepMode: stepMode,
        isReset: status.state === "not_ready" || status.state === "interlock",
        isRelative: false,
        coordinates: [
            +status.posx || 0,
            +status.posy || 0,
            +status.posz || 0,
        ],
        feedRate: +status.feed || 0,
        // No reliable spindle-speed field in machine.status today; surface
        // override percentage instead so the user sees something meaningful.
        spindleSpeed: Math.round((+status.fro || 1) * 100),
    };
}

function payloadsEqual(a, b) {
    if (!a || !b) return false;
    if (a.length !== b.length) return false;
    return a.equals(b);
}

// Construct an LCD display driver bound to `machine` and `device` (a node-hid
// handle). `getSeed` is called on each tick to fetch the most recent input
// rolling byte; `getWheelMode` returns "step" | "velocity" | null from the
// wheel state machine.
function create(machine, device, opts) {
    opts = opts || {};
    var getSeed = opts.getSeed || function () { return 0; };
    var getWheelMode = opts.getWheelMode || function () { return null; };
    var lastPayload = null;
    var lastSentAt = 0;
    var stopped = false;

    function pushOnce() {
        if (stopped) return;
        var now = Date.now();
        var state = buildState(machine.status, getWheelMode(), getSeed());
        var payload = encoder.encodePayload(state);

        var same = payloadsEqual(payload, lastPayload);
        var stale = now - lastSentAt > IDLE_REPUSH_MS;
        if (same && !stale) return;

        var reports = encoder.encode(state);
        for (var i = 0; i < reports.length; i++) {
            try {
                device.write(Array.prototype.slice.call(reports[i]));
            } catch (e) {
                // A write failure usually means the device went away — surface
                // once, then keep trying (the adapter's reconnect path will
                // tear us down when it notices the disconnect).
                if (!stopped) {
                    require("../../../log").logger("pendant").warn(
                        "XHC LCD write failed: " + e.message
                    );
                }
                return;
            }
        }
        lastPayload = payload;
        lastSentAt = now;
    }

    var timer = setInterval(pushOnce, Math.round(1000 / TICK_HZ));

    return {
        close: function () {
            stopped = true;
            clearInterval(timer);
        },
        // Exposed for tests.
        _buildState: function () { return buildState(machine.status, getWheelMode(), getSeed()); },
    };
}

module.exports = {
    TICK_HZ: TICK_HZ,
    IDLE_REPUSH_MS: IDLE_REPUSH_MS,
    buildState: buildState,
    create: create,
};
