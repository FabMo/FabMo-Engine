/*jshint esversion: 6 */
const evdev = require("../pendant/devices/logitech-f310/evdev");
const mapping = require("../pendant/devices/logitech-f310/mapping");

// Helper: build a 24-byte input_event (64-bit layout). Tests are skipped on
// 32-bit hosts where the struct is 16 bytes — the parser handles both, but
// fixtures here assume 64-bit (which is the Pi/aarch64 deployment target).
function event64(type, code, value) {
    if (evdev.EVENT_SIZE !== 24) {
        return null; // skip on non-64-bit
    }
    const buf = Buffer.alloc(24);
    // tv_sec and tv_usec are ignored by the parser; leave zero.
    buf.writeUInt16LE(type, 16);
    buf.writeUInt16LE(code, 18);
    buf.writeInt32LE(value, 20);
    return buf;
}

describe("evdev parser", () => {
    test("rejects short / missing buffer", () => {
        expect(evdev.parseEvent(null)).toBe(null);
        expect(evdev.parseEvent(Buffer.alloc(evdev.EVENT_SIZE - 1))).toBe(null);
    });

    test("parses a single KEY press event (A button, X mode)", () => {
        const buf = event64(evdev.EV.KEY, mapping.BTN_X.A, 1);
        if (!buf) return;
        expect(evdev.parseEvent(buf)).toEqual({
            type: evdev.EV.KEY,
            code: mapping.BTN_X.A,
            value: 1,
        });
    });

    test("parses an ABS event with negative value (stick down)", () => {
        const buf = event64(evdev.EV.ABS, mapping.ABS.LY, -25000);
        if (!buf) return;
        const ev = evdev.parseEvent(buf);
        expect(ev.type).toBe(evdev.EV.ABS);
        expect(ev.code).toBe(mapping.ABS.LY);
        expect(ev.value).toBe(-25000);
    });

    test("parseEvents yields multiple events from one chunk", () => {
        if (evdev.EVENT_SIZE !== 24) return;
        const buf = Buffer.concat([
            event64(evdev.EV.KEY, mapping.BTN_X.A, 1),
            event64(evdev.EV.SYN, 0, 0),
            event64(evdev.EV.KEY, mapping.BTN_X.A, 0),
        ]);
        const events = evdev.parseEvents(buf);
        expect(events.length).toBe(3);
        expect(events[0].value).toBe(1);
        expect(events[2].value).toBe(0);
    });
});

describe("F310 deflection / deadzone", () => {
    const dead = mapping.TUNABLES.DEADZONE;

    test("zero raw -> zero deflection", () => {
        expect(mapping.deflection(0)).toBe(0);
    });

    test("raw inside deadzone -> zero deflection", () => {
        expect(mapping.deflection(dead - 1)).toBe(0);
        expect(mapping.deflection(-(dead - 1))).toBe(0);
    });

    test("raw at deadzone edge -> near-zero positive/negative deflection", () => {
        const d = mapping.deflection(dead);
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThan(0.01);
    });

    test("raw at full positive -> +1.0", () => {
        expect(mapping.deflection(mapping.TUNABLES.AXIS_MAX)).toBeCloseTo(1.0, 5);
    });

    test("raw at full negative -> -1.0", () => {
        expect(mapping.deflection(-mapping.TUNABLES.AXIS_MAX)).toBeCloseTo(-1.0, 5);
    });

    test("clamps values past AXIS_MAX to ±1.0", () => {
        expect(mapping.deflection(mapping.TUNABLES.AXIS_MAX * 2)).toBe(1.0);
        expect(mapping.deflection(-mapping.TUNABLES.AXIS_MAX * 2)).toBe(-1.0);
    });

    test("deflection scales linearly between deadzone and AXIS_MAX", () => {
        const half = dead + (mapping.TUNABLES.AXIS_MAX - dead) / 2;
        expect(mapping.deflection(half)).toBeCloseTo(0.5, 5);
    });
});

describe("F310 PID-based button table selection", () => {
    test("X-mode PID returns the X-mode button table (A=0x130)", () => {
        expect(mapping.buttonsForPid(0xc21d).A).toBe(0x130);
    });
    test("D-mode PID returns the D-mode button table (A=0x121)", () => {
        expect(mapping.buttonsForPid(0xc216).A).toBe(0x121);
    });
});
