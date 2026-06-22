// Logitech F310 evdev key/axis codes and runtime tunables.
//
// The F310 has two modes selected by the back switch:
//   D mode (DirectInput):  VID 0x046d / PID 0xc216  — appears as "Logitech Gamepad F310"
//   X mode (XInput/Xbox):  VID 0x046d / PID 0xc21d  — appears as "Microsoft X-Box 360 pad"
//
// Both modes go through Linux's evdev layer with similar (but not identical)
// event codes. We support both; the device adapter prefers D mode because the
// axis-code mapping for the right stick differs.

// USB IDs for both modes — both registered so findDevice() catches either.
var MATCHERS = [
    { vendor: 0x046d, product: 0xc216 }, // D mode
    { vendor: 0x046d, product: 0xc21d }, // X mode
];

// evdev BTN_* codes differ between F310 modes; the adapter picks one set based
// on the PID it actually finds.

// X mode (XInput / Xbox 360 / xpad driver) — PID 0xc21d
var BTN_X = {
    A: 0x130,       // BTN_A
    B: 0x131,       // BTN_B
    X: 0x133,       // BTN_X
    Y: 0x134,       // BTN_Y
    LB: 0x136,      // BTN_TL  (left bumper)
    RB: 0x137,      // BTN_TR  (right bumper)
    SELECT: 0x13a,  // BTN_SELECT / Back
    START: 0x13b,   // BTN_START
    MODE: 0x13c,    // BTN_MODE / Logitech button
    LSTICK: 0x13d,  // BTN_THUMBL
    RSTICK: 0x13e,  // BTN_THUMBR
};

// D mode (DirectInput / hid-generic) — PID 0xc216
// Codes per typical hid-generic mapping; verify on hardware and adjust if a
// physical button reports a different code in your kernel.
var BTN_D = {
    X: 0x120,       // BTN_TRIGGER
    A: 0x121,       // BTN_THUMB
    B: 0x122,       // BTN_THUMB2
    Y: 0x123,       // BTN_TOP
    LB: 0x124,      // BTN_TOP2
    RB: 0x125,      // BTN_PINKIE
    LT: 0x126,      // BTN_BASE   (also reported as analog axis ABS_Z)
    RT: 0x127,      // BTN_BASE2  (also reported as analog axis ABS_RZ)
    SELECT: 0x128,  // BTN_BASE3 / Back
    START: 0x129,   // BTN_BASE4 / Start
    LSTICK: 0x12a,  // BTN_BASE5
    RSTICK: 0x12b,  // BTN_BASE6
};

function buttonsForPid(pid) {
    return pid === 0xc21d ? BTN_X : BTN_D;
}

// evdev ABS_* codes for axes
var ABS = {
    LX: 0x00,    // ABS_X        — left stick X
    LY: 0x01,    // ABS_Y        — left stick Y
    LT: 0x02,    // ABS_Z        — left trigger (D mode); also right-stick X (some modes)
    RX: 0x03,    // ABS_RX       — right stick X
    RY: 0x04,    // ABS_RY       — right stick Y
    RT: 0x05,    // ABS_RZ       — right trigger
    HAT_X: 0x10, // ABS_HAT0X    — D-pad horizontal (-1, 0, +1)
    HAT_Y: 0x11, // ABS_HAT0Y    — D-pad vertical   (-1, 0, +1)
};

// Joystick tunables.
//
// Joystick raw range on the F310 in D mode is roughly -32768..+32767 (signed).
// In X mode the axes are similar but the absinfo metadata differs. Either way
// the deadzone removes drift near center, and SPEED_SCALE converts deflection
// into a manual-jog speed in IPM (machine units per minute).
//
// JOG_SPEED_MAX is the speed sent to manualStart when the stick is fully
// deflected. Intermediate deflections produce proportional speeds.
//
// Right-stick A/Z wedge: the right stick disambiguates between A (horizontal
// jog) and Z (vertical jog) by angle. Within RIGHT_WEDGE_DEG of a cardinal
// axis the stick drives that axis at full configured speed; the ~70° band
// between wedges is a dead zone, so the user cannot accidentally drive A and
// Z simultaneously.
//
// Trigger range on the F310 (both modes) is 0..255 — a one-sided analog axis
// that rests at 0 and saturates at 255 on full pull.
var TUNABLES = {
    AXIS_MAX: 32767,
    DEADZONE: 8000,             // ~25% — absorbs worn-stick variable rest position
    JOG_SPEED_MAX: 60,          // IPM at full deflection (fallback if no config)
    DPAD_STEP_SIZE: 0.1,        // inches per D-pad press
    DPAD_SPEED: 30,             // IPM for D-pad fixed moves
    RIGHT_WEDGE_DEG: 10,        // half-angle of the A/Z active wedges (vs cardinal)
    TRIGGER_MAX: 255,           // raw range of LT/RT
    TRIGGER_DEADZONE: 16,       // ~6% — keeps spring-return noise from firing B
};

// tan(RIGHT_WEDGE_DEG) — precomputed so computeMotion can stay branch-light.
var RIGHT_WEDGE_TAN = Math.tan((TUNABLES.RIGHT_WEDGE_DEG * Math.PI) / 180);

// Pure: classify a raw axis value into a deflection in [-1.0, +1.0],
// returning 0 inside the deadzone.
function deflection(raw) {
    var v = raw;
    var dead = TUNABLES.DEADZONE;
    var max = TUNABLES.AXIS_MAX;
    if (v > -dead && v < dead) return 0;
    // Scale the remaining range (dead..max) linearly to (0..1).
    if (v >= dead) return Math.min(1.0, (v - dead) / (max - dead));
    return Math.max(-1.0, (v + dead) / (max - dead));
}

// Pure: classify a raw trigger value (one-sided, 0..TRIGGER_MAX) into a
// deflection in [0, 1.0]. Returns 0 below the deadzone.
function triggerDeflection(raw) {
    var dead = TUNABLES.TRIGGER_DEADZONE;
    var max = TUNABLES.TRIGGER_MAX;
    if (raw <= dead) return 0;
    return Math.min(1.0, (raw - dead) / (max - dead));
}

module.exports = {
    MATCHERS: MATCHERS,
    BTN_X: BTN_X,
    BTN_D: BTN_D,
    buttonsForPid: buttonsForPid,
    ABS: ABS,
    TUNABLES: TUNABLES,
    RIGHT_WEDGE_TAN: RIGHT_WEDGE_TAN,
    deflection: deflection,
    triggerDeflection: triggerDeflection,
};
