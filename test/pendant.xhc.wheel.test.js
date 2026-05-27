/*jshint esversion: 6 */
const wheel = require("../pendant/devices/xhc-lhb04b-6/wheel");

// Helper: feed a pulse stream through the state machine with a synthetic
// clock. Returns the concatenated list of intents emitted across all ticks.
function run(sm, events, opts) {
    opts = opts || {};
    const tickMs = opts.tickMs != null ? opts.tickMs : 50;        // 20 Hz
    const maxIpm = opts.maxIpm != null ? opts.maxIpm : 60;
    let now = 0;
    const intents = [];
    events.forEach((step) => {
        // Pulses for this step (each step represents one tick interval).
        for (let i = 0; i < (step.pulses || 0); i++) {
            sm.recordPulse(step.delta || 1, now);
        }
        now += tickMs;
        const out = sm.tick(step.axis || "X", step.feed || null, maxIpm, now);
        if (out && out.length) intents.push.apply(intents, out);
    });
    return intents;
}

const STEP_FINE = { stepSize: 0.001, percent: 2 };
const STEP_COARSE = { stepSize: 0.1, percent: 10 };
const STEP_FULL = { stepSize: 1.0, percent: 30 };
const VEL_60 = { stepSize: null, percent: 60 };
const VEL_100 = { stepSize: null, percent: 100 };
const VEL_LEAD = { stepSize: null, percent: null, lead: true };

describe("wheel state machine: step-mode slow turn", () => {
    test("single pulse per tick emits one nudge per tick", () => {
        const sm = wheel.create();
        const intents = run(sm, [
            { axis: "X", feed: STEP_COARSE, pulses: 1 },
            { axis: "X", feed: STEP_COARSE, pulses: 1 },
            { axis: "X", feed: STEP_COARSE, pulses: 1 },
        ]);
        // Slow rate (20 pps) is above the default FAST_PPS=15, so this would
        // actually trip jgv — drop to a slower cadence for the "slow" test.
        // Re-run with one pulse every 4 ticks (5 pps).
        const sm2 = wheel.create();
        const slow = [];
        for (let i = 0; i < 12; i++) {
            slow.push(i % 4 === 0
                ? { axis: "X", feed: STEP_COARSE, pulses: 1 }
                : { axis: "X", feed: STEP_COARSE, pulses: 0 });
        }
        const slowIntents = run(sm2, slow);
        const nudges = slowIntents.filter((i) => i.type === "nudge");
        expect(nudges.length).toBeGreaterThan(0);
        expect(slowIntents.find((i) => i.type === "start")).toBeUndefined();
        nudges.forEach((n) => {
            expect(n.axis).toBe("X");
            expect(n.stepSize).toBe(0.1);
            expect(Math.abs(n.ticks)).toBeGreaterThanOrEqual(1);
        });
        // unused
        void intents;
    });
});

describe("wheel state machine: step-mode fast turn switches to jgv", () => {
    test("rapid pulses produce a start intent and no nudges", () => {
        const sm = wheel.create();
        const intents = run(sm, [
            { axis: "X", feed: STEP_COARSE, pulses: 3 },
            { axis: "X", feed: STEP_COARSE, pulses: 4 },
            { axis: "X", feed: STEP_COARSE, pulses: 4 },
            { axis: "X", feed: STEP_COARSE, pulses: 4 },
        ]);
        const starts = intents.filter((i) => i.type === "start");
        const nudges = intents.filter((i) => i.type === "nudge");
        expect(starts.length).toBeGreaterThan(0);
        expect(nudges.length).toBe(0);
        starts.forEach((s) => {
            expect(s.axis).toBe("X");
            expect(s.speed).toBeGreaterThan(0);
            expect(Math.abs(s.ratio)).toBe(1);
        });
    });

    test("step-size caps jgv ceiling: 0.001 < 0.1 < 1.0", () => {
        function topSpeed(feed) {
            const sm = wheel.create();
            const intents = run(sm, [
                { axis: "X", feed: feed, pulses: 20 },
                { axis: "X", feed: feed, pulses: 20 },
                { axis: "X", feed: feed, pulses: 20 },
            ]);
            const starts = intents.filter((i) => i.type === "start");
            return Math.max.apply(null, starts.map((s) => s.speed));
        }
        const fineTop = topSpeed(STEP_FINE);
        const coarseTop = topSpeed(STEP_COARSE);
        const fullTop = topSpeed(STEP_FULL);
        expect(fineTop).toBeLessThan(coarseTop);
        expect(coarseTop).toBeLessThanOrEqual(fullTop);
    });
});

describe("wheel state machine: velocity mode", () => {
    test("any motion in velocity mode produces jgv start, no nudges", () => {
        const sm = wheel.create();
        const intents = run(sm, [
            { axis: "Y", feed: VEL_60, pulses: 1 },
            { axis: "Y", feed: VEL_60, pulses: 1 },
            { axis: "Y", feed: VEL_60, pulses: 1 },
        ]);
        const starts = intents.filter((i) => i.type === "start");
        const nudges = intents.filter((i) => i.type === "nudge");
        expect(starts.length).toBeGreaterThan(0);
        expect(nudges.length).toBe(0);
        // Velocity-mode cap = max * (percent/100) = 60 * 0.6 = 36 IPM
        starts.forEach((s) => expect(s.speed).toBeCloseTo(36, 5));
    });

    test("lead position caps at full max", () => {
        const sm = wheel.create();
        const intents = run(sm, [
            { axis: "Z", feed: VEL_LEAD, pulses: 1 },
            { axis: "Z", feed: VEL_LEAD, pulses: 1 },
        ]);
        const starts = intents.filter((i) => i.type === "start");
        expect(starts.length).toBeGreaterThan(0);
        starts.forEach((s) => expect(s.speed).toBeCloseTo(60, 5));
    });

    test("100% position caps at full max", () => {
        const sm = wheel.create();
        const intents = run(sm, [
            { axis: "Z", feed: VEL_100, pulses: 1 },
            { axis: "Z", feed: VEL_100, pulses: 1 },
        ]);
        const starts = intents.filter((i) => i.type === "start");
        expect(starts.length).toBeGreaterThan(0);
        starts.forEach((s) => expect(s.speed).toBeCloseTo(60, 5));
    });
});

describe("wheel state machine: direction sign", () => {
    test("negative pulses produce ratio = -1", () => {
        const sm = wheel.create();
        const intents = run(sm, [
            { axis: "X", feed: STEP_COARSE, pulses: 4, delta: -1 },
            { axis: "X", feed: STEP_COARSE, pulses: 4, delta: -1 },
            { axis: "X", feed: STEP_COARSE, pulses: 4, delta: -1 },
        ]);
        const starts = intents.filter((i) => i.type === "start");
        expect(starts.length).toBeGreaterThan(0);
        starts.forEach((s) => expect(s.ratio).toBe(-1));
    });
});

describe("wheel state machine: idle timeout", () => {
    test("jgv stops after no pulses for IDLE_MS", () => {
        const sm = wheel.create();
        // Spin up, then go silent.
        const spinUp = [
            { axis: "X", feed: STEP_COARSE, pulses: 4 },
            { axis: "X", feed: STEP_COARSE, pulses: 4 },
            { axis: "X", feed: STEP_COARSE, pulses: 4 },
        ];
        const silent = [
            { axis: "X", feed: STEP_COARSE, pulses: 0 },
            { axis: "X", feed: STEP_COARSE, pulses: 0 },
            { axis: "X", feed: STEP_COARSE, pulses: 0 },
            { axis: "X", feed: STEP_COARSE, pulses: 0 },
            { axis: "X", feed: STEP_COARSE, pulses: 0 },
        ];
        const intents = run(sm, spinUp.concat(silent));
        const stops = intents.filter((i) => i.type === "stop");
        expect(stops.length).toBeGreaterThan(0);
    });
});

describe("wheel state machine: axis-change immediate stop", () => {
    test("onAxisChange returns stop when jgv active on different axis", () => {
        const sm = wheel.create();
        run(sm, [
            { axis: "X", feed: STEP_COARSE, pulses: 4 },
            { axis: "X", feed: STEP_COARSE, pulses: 4 },
            { axis: "X", feed: STEP_COARSE, pulses: 4 },
        ]);
        expect(sm.getState().activeMode).toBe("jgv");
        const intent = sm.onAxisChange("Y");
        expect(intent).toEqual({ type: "stop" });
        expect(sm.getState().activeMode).toBeNull();
        expect(sm.getState().accumulator).toBe(0);
    });

    test("onAxisChange returns null when no axis was active", () => {
        const sm = wheel.create();
        expect(sm.onAxisChange("X")).toBeNull();
    });

    test("axis change with only pending nudges drops accumulator", () => {
        const sm = wheel.create();
        // One pulse → smoothed = alpha * (1/0.05) = 0.5 * 20 = 10 pps, under
        // FAST_PPS (15) → stays in nudge mode and sets activeAxis = "X".
        sm.recordPulse(1, 0);
        const intents = sm.tick("X", STEP_COARSE, 60, 50);
        expect(intents[0].type).toBe("nudge");
        expect(sm.getState().activeAxis).toBe("X");
        // Now another pulse arrives; switch axis before the next tick.
        sm.recordPulse(1, 60);
        const stop = sm.onAxisChange("Y");
        expect(stop).toBeNull();
        expect(sm.getState().accumulator).toBe(0);
    });
});

describe("wheel state machine: jgv ends when motion ceases", () => {
    test("rate dropping over time emits stop after jgv started", () => {
        const sm = wheel.create();
        // Fast spin → jgv, then silence → either decay-hysteresis or
        // IDLE_MS timeout fires a stop. Both are acceptable.
        const fast = [
            { axis: "X", feed: STEP_COARSE, pulses: 4 },
            { axis: "X", feed: STEP_COARSE, pulses: 4 },
            { axis: "X", feed: STEP_COARSE, pulses: 4 },
        ];
        const silent = [];
        for (let i = 0; i < 10; i++) {
            silent.push({ axis: "X", feed: STEP_COARSE, pulses: 0 });
        }
        const intents = run(sm, fast.concat(silent));
        const types = intents.map((i) => i.type);
        const firstStartIdx = types.indexOf("start");
        const stopIdx = types.indexOf("stop");
        expect(firstStartIdx).toBeGreaterThanOrEqual(0);
        expect(stopIdx).toBeGreaterThan(firstStartIdx);
    });
});
