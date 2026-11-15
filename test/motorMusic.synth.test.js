/*
 * Motor Music app — voice engine: pitch -> axis speed, voice allocation,
 * the play-area bounce, vibrato, and the manualStart ratio form.
 */
const { Synth, noteName, noteFreq, stepsPerUnit } = require("../dashboard/apps/motor_music.fma/js/synth.js");

const SU = 2482.81713; // PRSalpha X/Y steps per inch
const mk = (extra) =>
    new Synth(Object.assign({ axes: [{ axis: "X", su: SU }, { axis: "Y", su: SU }], box: 1, maxSpeed: 150 }, extra || {}));
const axisSpeed = (cmd, which) => cmd.speed * (which === 0 ? cmd.primary_ratio : cmd.secondary_ratio);

describe("motor music: pitch", () => {
    test("note names and frequencies", () => {
        expect(noteName(69)).toBe("A4");
        expect(noteName(60)).toBe("C4");
        expect(noteName(61)).toBe("C#4");
        expect(noteFreq(69)).toBeCloseTo(440, 6);
        expect(noteFreq(57)).toBeCloseTo(220, 6);
        expect(noteFreq(69, { transpose: 12 })).toBeCloseTo(880, 6);
        expect(noteFreq(69, { cents: 100 })).toBeCloseTo(noteFreq(70), 6);
    });

    test("A4 becomes the axis speed whose step rate is 440 Hz", () => {
        const s = mk();
        s.noteOn(69);
        const f = s.frame(0);
        expect(Math.abs(axisSpeed(f.cmd, 0))).toBeCloseTo((440 * 60) / SU, 6); // ~10.6 in/min
        expect(axisSpeed(f.cmd, 1)).toBe(0);
        expect((Math.abs(f.voices[0].speed) / 60) * SU).toBeCloseTo(440, 6);
    });

    test("speed ceiling holds", () => {
        const s = mk({ maxSpeed: 20 });
        s.noteOn(108); // C8, 4186 Hz -> ~101 in/min uncapped
        expect(s.frame(0).cmd.speed).toBe(20);
    });

    test("steps-per-unit read from the driver config by motor mapping", () => {
        expect(stepsPerUnit({ "1ma": 0, "1su": 100, "2ma": 1, "2su": 200, "3ma": 2, "3su": 300, "4ma": 1, "4su": 999 })).toEqual({
            X: 100,
            Y: 200,
            Z: 300,
        });
        expect(stepsPerUnit(null)).toEqual({});
    });
});

describe("motor music: voices", () => {
    test("two notes sound on two axes at independent speeds", () => {
        const s = mk();
        s.noteOn(60);
        s.noteOn(67);
        const f = s.frame(0);
        expect(f.cmd.axis).toBe("X");
        expect(f.cmd.second_axis).toBe("Y");
        expect(Math.abs(axisSpeed(f.cmd, 0))).toBeCloseTo((noteFreq(60) * 60) / SU, 6);
        expect(Math.abs(axisSpeed(f.cmd, 1))).toBeCloseTo((noteFreq(67) * 60) / SU, 6);
        expect(Math.max(Math.abs(f.cmd.primary_ratio), Math.abs(f.cmd.secondary_ratio))).toBeCloseTo(1, 9);
    });

    test("a third note steals the oldest voice; release silences only its own", () => {
        const s = mk();
        s.noteOn(60);
        s.noteOn(64);
        s.noteOn(67); // steals 60
        expect(s.held().sort()).toEqual([64, 67]);
        s.noteOff(60); // already gone: no effect
        expect(s.held().length).toBe(2);
        s.noteOff(64);
        const f = s.frame(0);
        expect(s.held()).toEqual([67]);
        expect(f.voices.filter((v) => v.speed !== 0).length).toBe(1);
    });

    test("repeated key does not take a second voice; silence gives no command", () => {
        const s = mk();
        s.noteOn(60);
        s.noteOn(60);
        expect(s.held()).toEqual([60]);
        s.allOff();
        expect(s.frame(0).cmd).toBe(null);
    });

    test("single-axis setup plays one voice with no second axis", () => {
        const s = new Synth({ axes: [{ axis: "Y", su: SU }] });
        s.noteOn(60);
        s.noteOn(62);
        const f = s.frame(0);
        expect(s.held()).toEqual([62]);
        expect(f.cmd.axis).toBe("Y");
        expect(f.cmd.second_axis).toBeUndefined();
        expect(Math.abs(f.cmd.primary_ratio)).toBe(1);
    });
});

describe("motor music: staying in the play area", () => {
    test("a held note bounces inside the box", () => {
        const s = mk({ box: 0.5 });
        s.noteOn(81); // A5: ~21 in/min, crosses the box in ~1.4 s
        let maxOff = 0,
            flips = 0,
            last = 0;
        for (let t = 0; t <= 20; t += 0.04) {
            const f = s.frame(t);
            const v = f.voices[0];
            maxOff = Math.max(maxOff, Math.abs(v.offset));
            if (last && Math.sign(v.speed) !== Math.sign(last)) flips++;
            last = v.speed;
            expect(Math.abs(v.speed)).toBeGreaterThan(0); // pitch never drops out
        }
        expect(flips).toBeGreaterThan(3);
        expect(maxOff).toBeLessThan(0.5 + 0.03); // one tick of overshoot at most
    });

    test("new notes head back toward the centre; at the centre they alternate", () => {
        const s = new Synth({ axes: [{ axis: "X", su: SU }], box: 1 });
        s.setOffset("X", 0.6);
        s.noteOn(60);
        expect(s.frame(0).voices[0].speed).toBeLessThan(0);
        s.noteOff(60);
        s.setOffset("X", -0.6);
        s.noteOn(60);
        expect(s.frame(0.04).voices[0].speed).toBeGreaterThan(0);
        s.noteOff(60);
        s.setOffset("X", 0);
        s.noteOn(60);
        const d1 = Math.sign(s.frame(0.08).voices[0].speed);
        s.noteOff(60);
        s.setOffset("X", 0);
        s.noteOn(60);
        expect(Math.sign(s.frame(0.12).voices[0].speed)).toBe(-d1);
    });

    test("status position overrides dead reckoning", () => {
        const s = new Synth({ axes: [{ axis: "X", su: SU }], box: 1 });
        s.noteOn(69);
        s.frame(0);
        s.frame(0.2);
        s.setOffset("X", 0.25);
        expect(s.frame(0.2).voices[0].offset).toBeCloseTo(0.25, 9);
    });
});

describe("motor music: vibrato", () => {
    test("pitch wobbles by the set depth at the set rate, centred on the note", () => {
        const s = mk({ vibrato: { rate: 5, depth: 0.5 } });
        s.noteOn(69);
        let lo = Infinity,
            hi = 0;
        for (let t = 0; t < 1; t += 0.005) {
            const f = s.frame(t, true).voices[0].freq;
            lo = Math.min(lo, f);
            hi = Math.max(hi, f);
        }
        expect(hi).toBeCloseTo(440 * Math.pow(2, 0.5 / 12), 1);
        expect(lo).toBeCloseTo(440 * Math.pow(2, -0.5 / 12), 1);
        expect(s.frame(2, false).voices[0].freq).toBeCloseTo(440, 6);
    });
});
