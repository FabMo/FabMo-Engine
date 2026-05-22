/*jshint esversion: 6 */
const parser = require("../pendant/devices/xhc-lhb04b-6/parser");
const mapping = require("../pendant/devices/xhc-lhb04b-6/mapping");

// Helper: build an 8-byte XHC input report. Fields default to 0 (idle).
function report(fields) {
    const f = Object.assign(
        { header: 0x04, seed: 0x00, button1: 0x00, button2: 0x00, feedRotary: 0x00, axisRotary: 0x06, wheelDelta: 0, crc: 0x00 },
        fields || {}
    );
    const buf = Buffer.alloc(8);
    buf[0] = f.header;
    buf[1] = f.seed;
    buf[2] = f.button1;
    buf[3] = f.button2;
    buf[4] = f.feedRotary;
    buf[5] = f.axisRotary;
    buf.writeInt8(f.wheelDelta, 6);
    buf[7] = f.crc;
    return buf;
}

describe("XHC parser", () => {
    test("rejects null / wrong length", () => {
        expect(parser.parse(null)).toBe(null);
        expect(parser.parse(Buffer.alloc(7))).toBe(null);
        expect(parser.parse(Buffer.alloc(9))).toBe(null);
    });

    test("rejects buffer with wrong header byte", () => {
        const buf = report({ header: 0x05 });
        expect(parser.parse(buf)).toBe(null);
    });

    test("parses an idle report", () => {
        const buf = report({});
        const out = parser.parse(buf);
        expect(out).toEqual({
            header: 0x04,
            seed: 0,
            button1: 0,
            button2: 0,
            feedRotary: 0,
            axisRotary: 0x06,
            wheelDelta: 0,
            crc: 0,
        });
    });

    test("parses a single button press (start-pause, X axis, step 0.01)", () => {
        const buf = report({ button1: 0x03, axisRotary: 0x11, feedRotary: 0x0e });
        const out = parser.parse(buf);
        expect(out.button1).toBe(0x03);
        expect(out.axisRotary).toBe(0x11);
        expect(out.feedRotary).toBe(0x0e);
    });

    test("parses fn modifier + button (fn held while pressing macro-10)", () => {
        const buf = report({ button1: 0x10, button2: 0x0c }); // macro-10 + fn
        const out = parser.parse(buf);
        expect(out.button1).toBe(0x10);
        expect(out.button2).toBe(0x0c);
    });

    test("parses positive wheel delta", () => {
        const buf = report({ wheelDelta: 5 });
        expect(parser.parse(buf).wheelDelta).toBe(5);
    });

    test("parses negative wheel delta (signed int8)", () => {
        const buf = report({ wheelDelta: -3 });
        expect(parser.parse(buf).wheelDelta).toBe(-3);
    });

    test("parses extreme wheel deltas at signed-int8 bounds", () => {
        expect(parser.parse(report({ wheelDelta: 127 })).wheelDelta).toBe(127);
        expect(parser.parse(report({ wheelDelta: -128 })).wheelDelta).toBe(-128);
    });
});

describe("XHC mapping.interpret", () => {
    test("returns null on null input", () => {
        expect(mapping.interpret(null)).toBe(null);
    });

    test("idle report yields no buttons, no axis, no feed, zero delta", () => {
        const out = mapping.interpret(parser.parse(report({})));
        expect(out.buttons).toEqual([]);
        expect(out.axis).toBe(null);
        expect(out.feed).toBe(null);
        expect(out.wheelDelta).toBe(0);
    });

    test("single-button press maps to semantic name", () => {
        const out = mapping.interpret(parser.parse(report({ button1: 0x02 })));
        expect(out.buttons).toEqual(["stop"]);
    });

    test("two simultaneous buttons (fn + macro-10) map to both", () => {
        const out = mapping.interpret(parser.parse(report({ button1: 0x10, button2: 0x0c })));
        expect(out.buttons).toEqual(["macro-10", "fn"]);
    });

    test("axis rotary maps to axis name; OFF position yields null", () => {
        expect(mapping.interpret(parser.parse(report({ axisRotary: 0x06 }))).axis).toBe(null);
        expect(mapping.interpret(parser.parse(report({ axisRotary: 0x11 }))).axis).toBe("X");
        expect(mapping.interpret(parser.parse(report({ axisRotary: 0x13 }))).axis).toBe("Z");
        expect(mapping.interpret(parser.parse(report({ axisRotary: 0x16 }))).axis).toBe("C");
    });

    test("feed rotary in step positions yields stepSize and percent", () => {
        const out = mapping.interpret(parser.parse(report({ feedRotary: 0x0d })));
        expect(out.feed.stepSize).toBe(0.001);
        expect(out.feed.percent).toBe(2);
    });

    test("feed rotary in percent-only positions yields null stepSize", () => {
        const out = mapping.interpret(parser.parse(report({ feedRotary: 0x1b })));
        expect(out.feed.stepSize).toBe(null);
        expect(out.feed.percent).toBe(100);
    });

    test("unknown button codes are filtered out", () => {
        // 0xff is not in BUTTONS — interpret should drop it
        const out = mapping.interpret(parser.parse(report({ button1: 0xff })));
        expect(out.buttons).toEqual([]);
    });
});
