/*
 * MotionAudioModel — the pure math behind the "hear the machine" dev tool
 * (libs/motionaudio.js): per-axis velocity from the 10 Hz position stream,
 * scaled by steps-per-unit into the step-pulse frequency a bench speaker on
 * the G2 step pin would produce.
 */

/* eslint-env jest */

var lib = require("../dashboard/static/js/libs/motionaudio");
var MotionAudioModel = lib.MotionAudioModel;
var stepsPerUnitFromDriverConfig = lib.stepsPerUnitFromDriverConfig;

function status(x, y, z) {
    return { posx: x, posy: y, posz: z };
}

describe("MotionAudioModel", () => {
    test("first sample produces no tone (no velocity yet)", () => {
        var m = new MotionAudioModel({ stepsPerUnit: { z: 4000 } });
        expect(m.update(status(0, 0, 0), 1000)).toBeNull();
    });

    test("steady Z motion maps to the step rate of a bench speaker", () => {
        var m = new MotionAudioModel({ stepsPerUnit: { z: 4000 } });
        m.update(status(0, 0, 0), 1000);
        // 0.05 units in 100 ms = 0.5 units/s; at 4000 steps/unit -> 2 kHz
        var t = m.update(status(0, 0, -0.05), 1100);
        expect(t.z.on).toBe(true);
        expect(t.z.freq).toBeCloseTo(2000, 0);
        expect(t.x.on).toBe(false);
        expect(t.y.on).toBe(false);
    });

    test("direction doesn't matter, only speed (step pulses have no sign)", () => {
        var m = new MotionAudioModel({ stepsPerUnit: { z: 4000 } });
        m.update(status(0, 0, 0), 1000);
        var up = m.update(status(0, 0, 0.05), 1100);
        m.update(status(0, 0, 0.05), 1200);
        var dn = m.update(status(0, 0, 0), 1300);
        expect(up.z.freq).toBeCloseTo(dn.z.freq, 3);
    });

    test("stopped axes are silent, frequency pins at the audible ceiling", () => {
        var m = new MotionAudioModel({ stepsPerUnit: { x: 4000 } });
        m.update(status(0, 0, 0), 1000);
        var t = m.update(status(2, 0, 0), 1100); // 20 units/s * 4000 = 80 kHz -> pinned
        expect(t.x.freq).toBe(6000);
        expect(t.y.on).toBe(false);
        expect(t.z.on).toBe(false);
    });

    test("a coordinate jump (zeroing an axis) mutes instead of chirping", () => {
        var m = new MotionAudioModel({ stepsPerUnit: { x: 4000 } });
        m.update(status(30, 0, 0), 1000);
        // "Zero X" -> posx teleports 30 units in one 100ms sample
        expect(m.update(status(0, 0, 0), 1100)).toBeNull();
        // ...and the next real sample is measured against the new baseline
        var t = m.update(status(0.05, 0, 0), 1200);
        expect(t.x.on).toBe(true);
    });

    test("metric machines: a fast mm-mode rapid is motion, not a teleport", () => {
        var m = new MotionAudioModel({ stepsPerUnit: { x: 157.48 } }); // 4000/in in mm terms
        var mm = function (x) {
            return { posx: x, posy: 0, posz: 0, unit: 1 };
        };
        m.update(mm(0), 1000);
        // 254 mm/s (10 in/s rapid): way past the inch teleport ceiling, normal in mm
        var t = m.update(mm(25.4), 1100);
        expect(t).not.toBeNull();
        expect(t.x.on).toBe(true);
    });

    test("a stale gap (hidden tab, hold) produces no tone and rebases cleanly", () => {
        var m = new MotionAudioModel({ stepsPerUnit: { x: 4000 } });
        m.update(status(0, 0, 0), 1000);
        expect(m.update(status(0.5, 0, 0), 5000)).toBeNull(); // 4s gap
        var t = m.update(status(0.55, 0, 0), 5100);
        expect(t.x.on).toBe(true);
    });

    test("missing position fields mute and reset instead of throwing", () => {
        var m = new MotionAudioModel({ stepsPerUnit: {} });
        m.update(status(0, 0, 0), 1000);
        expect(m.update({ posx: 1, posy: null, posz: 0 }, 1100)).toBeNull();
        expect(m.update(status(1, 0, 0), 1200)).toBeNull(); // rebased: first sample again
    });
});

describe("stepsPerUnitFromDriverConfig", () => {
    test("derives per-axis steps/unit from the g2 motor config", () => {
        // Classic ShopBot-ish motor: 1.8deg, 10 microsteps, 1.25 units/rev
        // -> (360/1.8)*10/1.25 = 1600 steps/unit
        var spu = stepsPerUnitFromDriverConfig({
            "1ma": 0, "1sa": 1.8, "1mi": 10, "1tr": 1.25,
            "2ma": 1, "2sa": 1.8, "2mi": 10, "2tr": 1.25,
            "3ma": 2, "3sa": 1.8, "3mi": 10, "3tr": 0.5,
        });
        expect(spu.x).toBeCloseTo(1600, 3);
        expect(spu.y).toBeCloseTo(1600, 3);
        expect(spu.z).toBeCloseTo(4000, 3);
    });

    test("tolerates missing/partial config (falls back per axis)", () => {
        expect(stepsPerUnitFromDriverConfig(null)).toEqual({});
        var spu = stepsPerUnitFromDriverConfig({ "1ma": 0, "1sa": 1.8 }); // no mi/tr
        expect(spu.x).toBeUndefined();
    });

    test("first motor on a shared axis wins (dual-motor gantries)", () => {
        var spu = stepsPerUnitFromDriverConfig({
            "1ma": 1, "1sa": 1.8, "1mi": 10, "1tr": 1.25,
            "2ma": 1, "2sa": 1.8, "2mi": 5, "2tr": 1.25,
        });
        expect(spu.y).toBeCloseTo(1600, 3);
    });
});
