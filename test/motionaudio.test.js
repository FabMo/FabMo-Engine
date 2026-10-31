/*
 * MotionAudioModel — the pure math behind the "hear the machine" dev tool
 * (libs/motionaudio.js): per-axis velocity from position-DISTINCT report
 * pairs, scaled by steps-per-unit (through a /10 pitch prescaler) into the
 * tone a bench speaker on the G2 step pin would make.
 *
 * The evidence-based estimator exists because the dashboard status stream is
 * NOT a clean position feed: status emits happen for plenty of non-position
 * reasons, carrying positions identical to the last report milliseconds
 * later. Round 1 (pairwise velocity) read those as "stopped" and stuttered;
 * round 2 (sliding window + off-hold) fixed the stutter but let the tone
 * linger ~600ms past a real stop. Round 3 classifies instead of smoothing:
 * only distinct pairs produce pitch, an unchanged report within STILL_MS of
 * movement evidence is chatter (say nothing), and an unchanged report after
 * STILL_MS is proof of a stop (mute NOW). Both field-reported failure shapes
 * are replayed as regression tests below.
 *
 * Contract: update() returns per-axis targets; `undefined` = say nothing
 * (warm-up / chatter), `null` = hard-mute (bad data, teleport).
 */

/* eslint-env jest */

var lib = require("../dashboard/static/js/libs/motionaudio");
var MotionAudioModel = lib.MotionAudioModel;
var stepsPerUnitFromDriverConfig = lib.stepsPerUnitFromDriverConfig;

function status(x, y, z) {
    return { posx: x, posy: y, posz: z };
}

// Feed a sequence of [t, status] and collect non-undefined outputs as [t, targets].
function feed(m, seq) {
    var out = [];
    seq.forEach(function (s) {
        var r = m.update(s[1], s[0]);
        if (r !== undefined) out.push([s[0], r]);
    });
    return out;
}

describe("MotionAudioModel", () => {
    test("warming up: the first sample says nothing", () => {
        var m = new MotionAudioModel({ stepsPerUnit: { z: 4000 } });
        expect(m.update(status(0, 0, 0), 1000)).toBeUndefined();
    });

    test("steady Z motion maps to the step rate through the /10 prescaler", () => {
        var m = new MotionAudioModel({ stepsPerUnit: { z: 4000 } });
        m.update(status(0, 0, 0), 1000);
        // 0.05 units / 100ms = 0.5 units/s; 4000 steps/unit = 2 kHz raw -> 200 Hz at /10
        var t = m.update(status(0, 0, -0.05), 1100);
        expect(t.z.on).toBe(true);
        expect(t.z.freq).toBeCloseTo(200, 0);
        expect(t.x.on).toBe(false);
        expect(t.y.on).toBe(false);
    });

    test("REGRESSION: duplicate-position status chatter cannot stutter the tone", () => {
        // Real stream shape: 10Hz position reports with non-position status
        // emits (identical positions) interleaved a few ms after each one.
        var m = new MotionAudioModel({ stepsPerUnit: { z: 4000 } });
        var z = 0;
        var seq = [];
        for (var t = 1000; t <= 2000; t += 100) {
            z -= 0.05;
            seq.push([t, status(0, 0, z)]);
            seq.push([t + 15, status(0, 0, z)]); // chatter: same position
            seq.push([t + 40, status(0, 0, z)]); // more chatter
        }
        var outs = feed(m, seq);
        // Every spoken target after warm-up keeps Z sounding - chatter is
        // silent (undefined), never an off.
        var settled = outs.filter(function (o) {
            return o[0] >= 1100;
        });
        expect(settled.length).toBeGreaterThan(8);
        settled.forEach(function (o) {
            expect(o[1].z.on).toBe(true);
            expect(o[1].z.freq).toBeGreaterThan(150);
        });
    });

    test("REGRESSION: a stop is silent on the first report that proves it", () => {
        // Field report round 2: the tone lingered ~600ms past key release.
        // Now: motion reports, then an unchanged report >= STILL_MS after the
        // last movement evidence must mute IMMEDIATELY.
        var m = new MotionAudioModel({ stepsPerUnit: { z: 4000 } });
        m.update(status(0, 0, 0), 1000);
        m.update(status(0, 0, -0.05), 1100);
        m.update(status(0, 0, -0.1), 1200); // last movement evidence
        // stat-change emit lands 160ms later with the same position: proof of stop
        var t = m.update(status(0, 0, -0.1), 1360);
        expect(t).not.toBeUndefined();
        expect(t.z.on).toBe(false);
        expect(t.z.freq).toBe(0);
    });

    test("an unchanged report right after a moving one is chatter, not a stop", () => {
        var m = new MotionAudioModel({ stepsPerUnit: { z: 4000 } });
        m.update(status(0, 0, 0), 1000);
        m.update(status(0, 0, -0.05), 1100);
        expect(m.update(status(0, 0, -0.05), 1120)).toBeUndefined(); // 20ms later: chatter
    });

    test("direction doesn't matter, only speed (step pulses have no sign)", () => {
        var up = new MotionAudioModel({ stepsPerUnit: { z: 4000 } });
        up.update(status(0, 0, 0), 1000);
        var tu = up.update(status(0, 0, 0.05), 1100);
        var dn = new MotionAudioModel({ stepsPerUnit: { z: 4000 } });
        dn.update(status(0, 0, 0), 1000);
        var td = dn.update(status(0, 0, -0.05), 1100);
        expect(tu.z.freq).toBeCloseTo(td.z.freq, 3);
    });

    test("frequency pins at the audible ceiling", () => {
        var m = new MotionAudioModel({ stepsPerUnit: { x: 4000 } });
        m.update(status(0, 0, 0), 1000);
        var t = m.update(status(2, 0, 0), 1100); // 20 u/s * 4000 / 10 = 8 kHz -> pinned
        expect(t.x.freq).toBe(6000);
    });

    test("a coordinate jump (zeroing an axis) hard-mutes instead of chirping", () => {
        var m = new MotionAudioModel({ stepsPerUnit: { x: 4000 } });
        m.update(status(30, 0, 0), 1000);
        // "Zero X" -> posx teleports 30 units in one 100ms sample
        expect(m.update(status(0, 0, 0), 1100)).toBeNull();
        // the next distinct pair measures from the new baseline
        var t = m.update(status(0.05, 0, 0), 1200);
        expect(t.x.on).toBe(true);
        expect(t.x.freq).toBeCloseTo(200, 0);
    });

    test("metric machines: a fast mm-mode rapid is motion, not a teleport", () => {
        var m = new MotionAudioModel({ stepsPerUnit: { x: 157.48 } }); // 4000/in in mm terms
        var mm = function (x) {
            return { posx: x, posy: 0, posz: 0, unit: 1 };
        };
        m.update(mm(0), 1000);
        var t = m.update(mm(25.4), 1100); // 254 mm/s (10 in/s rapid)
        expect(t).not.toBeNull();
        expect(t.x.on).toBe(true);
    });

    test("a stale gap (hidden tab, hold) rebases instead of guessing", () => {
        var m = new MotionAudioModel({ stepsPerUnit: { x: 4000 } });
        m.update(status(0, 0, 0), 1000);
        expect(m.update(status(0.5, 0, 0), 5000)).toBeUndefined(); // 4s gap: rebase
        var t = m.update(status(0.55, 0, 0), 5100);
        expect(t.x.on).toBe(true);
    });

    test("missing position fields hard-mute and reset instead of throwing", () => {
        var m = new MotionAudioModel({ stepsPerUnit: {} });
        m.update(status(0, 0, 0), 1000);
        expect(m.update({ posx: 1, posy: null, posz: 0 }, 1100)).toBeNull();
        expect(m.update(status(1, 0, 0), 1200)).toBeUndefined(); // warming up again
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
