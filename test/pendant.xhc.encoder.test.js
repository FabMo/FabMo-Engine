/*jshint esversion: 6 */
const encoder = require("../pendant/devices/xhc-lhb04b-6/encoder");

describe("XHC LCD encoder: coordinate encoding", () => {
    function readCoord(buf, off) {
        const intVal = buf.readUInt16LE(off);
        const fracLo = buf[off + 2];
        const fracHi = buf[off + 3] & 0x7f;
        const sign = (buf[off + 3] & 0x80) ? -1 : 1;
        return {
            integerVal: intVal,
            fraction: (fracHi << 8) | fracLo,
            sign: sign,
        };
    }

    test("encodes positive integer", () => {
        const buf = Buffer.alloc(4);
        encoder.encodeCoordinate(12, buf, 0);
        const c = readCoord(buf, 0);
        expect(c.integerVal).toBe(12);
        expect(c.fraction).toBe(0);
        expect(c.sign).toBe(1);
    });

    test("encodes zero", () => {
        const buf = Buffer.alloc(4);
        encoder.encodeCoordinate(0, buf, 0);
        expect(buf.equals(Buffer.from([0, 0, 0, 0]))).toBe(true);
    });

    test("encodes negative value with high bit set", () => {
        const buf = Buffer.alloc(4);
        encoder.encodeCoordinate(-3.5, buf, 0);
        const c = readCoord(buf, 0);
        expect(c.integerVal).toBe(3);
        expect(c.fraction).toBe(5000);
        expect(c.sign).toBe(-1);
        expect(buf[3] & 0x80).toBe(0x80);
    });

    test("encodes fractional value (1.2345 → frac=2345)", () => {
        const buf = Buffer.alloc(4);
        encoder.encodeCoordinate(1.2345, buf, 0);
        const c = readCoord(buf, 0);
        expect(c.integerVal).toBe(1);
        expect(c.fraction).toBe(2345);
        expect(c.sign).toBe(1);
    });

    test("encodes max-fraction value (0.9999)", () => {
        const buf = Buffer.alloc(4);
        encoder.encodeCoordinate(0.9999, buf, 0);
        const c = readCoord(buf, 0);
        expect(c.integerVal).toBe(0);
        expect(c.fraction).toBe(9999);
        expect(c.sign).toBe(1);
    });
});

describe("XHC LCD encoder: display flags", () => {
    test("step mode CON = 0", () => {
        expect(encoder.encodeFlags({ stepMode: encoder.STEP_MODE.CON })).toBe(0x00);
    });
    test("step mode STEP = 1", () => {
        expect(encoder.encodeFlags({ stepMode: encoder.STEP_MODE.STEP })).toBe(0x01);
    });
    test("isReset sets bit 6", () => {
        expect(encoder.encodeFlags({ stepMode: 0, isReset: true })).toBe(0x40);
    });
    test("isRelative sets bit 7", () => {
        expect(encoder.encodeFlags({ stepMode: 0, isRelative: true })).toBe(0x80);
    });
    test("all bits combined", () => {
        expect(encoder.encodeFlags({
            stepMode: encoder.STEP_MODE.PERCENT,
            isReset: true,
            isRelative: true,
        })).toBe(0xc3);
    });
});

describe("XHC LCD encoder: payload layout", () => {
    test("21-byte payload with header + seed", () => {
        const buf = encoder.encodePayload({ seed: 0xab });
        expect(buf.length).toBe(21);
        expect(buf[0]).toBe(0xfe);   // header low byte
        expect(buf[1]).toBe(0xfd);   // header high byte
        expect(buf[2]).toBe(0xab);   // seed
    });

    test("axis coordinates at offsets 4, 8, 12", () => {
        const buf = encoder.encodePayload({
            coordinates: [1.5, -2.25, 0.001],
        });
        // X = 1.5 → int=1, frac=5000, sign=+
        expect(buf.readUInt16LE(4)).toBe(1);
        expect(buf[6]).toBe(5000 & 0xff);
        expect(buf[7]).toBe((5000 >> 8) & 0x7f);
        expect(buf[7] & 0x80).toBe(0);
        // Y = -2.25 → int=2, frac=2500, sign=-
        expect(buf.readUInt16LE(8)).toBe(2);
        expect(buf[11] & 0x80).toBe(0x80);
        // Z = 0.001 → int=0, frac=10
        expect(buf.readUInt16LE(12)).toBe(0);
        expect(buf[14]).toBe(10);
    });

    test("feedRate and spindleSpeed encoded little-endian at 16/18", () => {
        const buf = encoder.encodePayload({
            feedRate: 1234,
            spindleSpeed: 5678,
        });
        expect(buf.readUInt16LE(16)).toBe(1234);
        expect(buf.readUInt16LE(18)).toBe(5678);
        expect(buf[20]).toBe(0); // padding
    });

    test("clamps oversize feedRate/spindleSpeed to uint16 max", () => {
        const buf = encoder.encodePayload({
            feedRate: 1e9,
            spindleSpeed: -5,
        });
        expect(buf.readUInt16LE(16)).toBe(0xffff);
        expect(buf.readUInt16LE(18)).toBe(0);
    });
});

describe("XHC LCD encoder: report framing", () => {
    test("produces 3 reports of 8 bytes each, all prefixed with 0x06", () => {
        const reports = encoder.encode({});
        expect(reports.length).toBe(3);
        reports.forEach((r) => {
            expect(r.length).toBe(8);
            expect(r[0]).toBe(0x06);
        });
    });

    test("reports concatenate (minus prefix) back to the 21-byte payload", () => {
        const state = {
            seed: 0x42,
            stepMode: encoder.STEP_MODE.STEP,
            coordinates: [7.5, -1.25, 0.5],
            feedRate: 100,
            spindleSpeed: 12000,
        };
        const reports = encoder.encode(state);
        const reassembled = Buffer.concat(reports.map((r) => r.slice(1)));
        expect(reassembled.length).toBe(21);
        expect(reassembled.equals(encoder.encodePayload(state))).toBe(true);
    });
});
