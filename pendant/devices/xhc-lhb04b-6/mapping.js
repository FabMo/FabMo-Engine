// XHC LHB04B-6 button-code / rotary-position → semantic name mapping.
//
// Codes verified against LinuxCNC's xhc-whb04b-6 pendant.cc constant tables.
// Bindings to FabMo actions are hardcoded for v1 — see ./dispatch.js for the
// fn-modifier alternate layer.

// Button codes (bytes 2 and 3 of the input report).
var BUTTONS = {
    0x00: null, // none / released
    0x01: "reset",
    0x02: "stop",
    0x03: "start-pause",
    0x04: "feed-plus",
    0x05: "feed-minus",
    0x06: "spindle-plus",
    0x07: "spindle-minus",
    0x08: "m-home",
    0x09: "safe-z",
    0x0a: "w-home",
    0x0b: "spindle-on-off",
    0x0c: "fn", // modifier — ships in byte 3 alongside another button code
    0x0d: "probe-z",
    0x0e: "mode-continuous",
    0x0f: "mode-step",
    0x10: "macro-10",
};

// Axis selector rotary (byte 5).
var AXIS_ROTARY = {
    0x06: null, // OFF position
    0x11: "X",
    0x12: "Y",
    0x13: "Z",
    0x14: "A",
    0x15: "B",
    0x16: "C",
};

// Feedrate / step-size rotary (byte 4). The device labels each position with
// two values — a fixed-step distance (for step mode) and a percentage (for
// continuous mode). We carry both so the dispatcher can choose based on the
// current jog mode.
//
// stepSize is in machine units (inches or mm — applied as-is to manualMoveFixed).
// percent is for feed-override or continuous-jog speed.
var FEED_ROTARY = {
    0x0d: { stepSize: 0.001, percent: 2 },
    0x0e: { stepSize: 0.01, percent: 5 },
    0x0f: { stepSize: 0.1, percent: 10 },
    0x10: { stepSize: 1.0, percent: 30 },
    0x1a: { stepSize: null, percent: 60 },
    0x1b: { stepSize: null, percent: 100 },
    0x1c: { stepSize: null, percent: null, lead: true },
    0x9b: { stepSize: null, percent: null, lead: true }, // alternate code seen on some firmwares
};

// Translate a raw parsed event into semantic fields. Returns an object with
// nulls where the device reports "none" / "off" — the dispatcher decides what
// to do with them.
function interpret(raw) {
    if (!raw) return null;
    return {
        buttons: [BUTTONS[raw.button1] || null, BUTTONS[raw.button2] || null].filter(function (b) {
            return b !== null;
        }),
        axis: AXIS_ROTARY[raw.axisRotary] !== undefined ? AXIS_ROTARY[raw.axisRotary] : null,
        feed: FEED_ROTARY[raw.feedRotary] || null,
        wheelDelta: raw.wheelDelta,
    };
}

module.exports = {
    BUTTONS: BUTTONS,
    AXIS_ROTARY: AXIS_ROTARY,
    FEED_ROTARY: FEED_ROTARY,
    interpret: interpret,
};
