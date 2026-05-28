/*jshint esversion: 6 */
const wheel = require("../pendant/devices/xhc-lhb04b-6/wheel");

// Helper: feed a pulse stream through the state machine with a synthetic
// clock. Each event represents one tick interval. Returns the concatenated
// list of intents emitted across all ticks.
function run(sm, events, opts) {
    opts = opts || {};
    const tickMs = opts.tickMs != null ? opts.tickMs : 50; // 20 Hz
    const maxIpm = opts.maxIpm != null ? opts.maxIpm : 60;
    const wheelMode = opts.wheelMode === undefined ? "continuous" : opts.wheelMode;
    let now = 0;
    const intents = [];
    events.forEach((step) => {
        for (let i = 0; i < (step.pulses || 0); i++) {
            sm.recordPulse(step.delta || 1, now);
        }
        now += tickMs;
        const stepMode = step.wheelMode === undefined ? wheelMode : step.wheelMode;
        const out = sm.tick(
            step.axis || "X",
            step.feed || null,
            maxIpm,
            now,
            stepMode
        );
        if (out && out.length) intents.push.apply(intents, out);
    });
    return intents;
}

// Selector positions are dual-labeled on the device. The step-zone positions
// (0.001 / 0.01 / 0.1 / 1.0) double as low continuous percents so the user
// can get a fine slow jog in continuous mode without changing knob position.
const STEP_FINE = { stepSize: 0.001, percent: 2 };
const STEP_COARSE = { stepSize: 0.1, percent: 10 };
const STEP_FULL = { stepSize: 1.0, percent: 30 };
const VEL_60 = { stepSize: null, percent: 60 };
const VEL_100 = { stepSize: null, percent: 100 };
const VEL_LEAD = { stepSize: null, percent: null, lead: true };

describe("wheel: step mode — one pulse-batch per tick is one nudge", () => {
    test("each tick with pulses emits exactly one nudge of stepSize", () => {
        const sm = wheel.create();
        const intents = run(
            sm,
            [
                { axis: "X", feed: STEP_COARSE, pulses: 1 },
                { axis: "X", feed: STEP_COARSE, pulses: 1 },
                { axis: "X", feed: STEP_COARSE, pulses: 1 },
            ],
            { wheelMode: "step" }
        );
        const nudges = intents.filter((i) => i.type === "nudge");
        const starts = intents.filter((i) => i.type === "start");
        expect(nudges.length).toBe(3);
        expect(starts.length).toBe(0);
        nudges.forEach((n) => {
            expect(n.axis).toBe("X");
            expect(n.stepSize).toBe(0.1);
            expect(n.ticks).toBe(1);
        });
    });

    test("fast spin does NOT escalate to jgv — still pure nudges", () => {
        const sm = wheel.create();
        const intents = run(
            sm,
            [
                { axis: "X", feed: STEP_COARSE, pulses: 8 },
                { axis: "X", feed: STEP_COARSE, pulses: 8 },
                { axis: "X", feed: STEP_COARSE, pulses: 8 },
            ],
            { wheelMode: "step" }
        );
        expect(intents.filter((i) => i.type === "start").length).toBe(0);
        const nudges = intents.filter((i) => i.type === "nudge");
        expect(nudges.length).toBeGreaterThan(0);
        nudges.forEach((n) => expect(n.stepSize).toBe(0.1));
    });

    test("step mode with continuous-zone selector clamps to 1.0", () => {
        const sm = wheel.create();
        const intents = run(
            sm,
            [
                { axis: "X", feed: VEL_60, pulses: 1 },
                { axis: "X", feed: VEL_60, pulses: 1 },
            ],
            { wheelMode: "step" }
        );
        const nudges = intents.filter((i) => i.type === "nudge");
        expect(nudges.length).toBe(2);
        nudges.forEach((n) => expect(n.stepSize).toBe(1.0));
    });

    test("stepSize selection is honored: fine vs coarse vs full", () => {
        function nudgeStepSize(feed) {
            const sm = wheel.create();
            const out = run(
                sm,
                [{ axis: "X", feed: feed, pulses: 1 }],
                { wheelMode: "step" }
            );
            return out[0].stepSize;
        }
        expect(nudgeStepSize(STEP_FINE)).toBe(0.001);
        expect(nudgeStepSize(STEP_COARSE)).toBe(0.1);
        expect(nudgeStepSize(STEP_FULL)).toBe(1.0);
    });

    test("negative pulses produce negative ticks", () => {
        const sm = wheel.create();
        const intents = run(
            sm,
            [{ axis: "X", feed: STEP_COARSE, pulses: 3, delta: -1 }],
            { wheelMode: "step" }
        );
        const nudges = intents.filter((i) => i.type === "nudge");
        expect(nudges.length).toBe(1);
        expect(nudges[0].ticks).toBe(-3);
    });
});

describe("wheel: continuous mode — selector picks fraction of max IPM", () => {
    test("60% selector → jgv at 60% of max, ratio follows last pulse sign", () => {
        const sm = wheel.create();
        const intents = run(
            sm,
            [
                { axis: "Y", feed: VEL_60, pulses: 1 },
                { axis: "Y", feed: VEL_60, pulses: 1 },
                { axis: "Y", feed: VEL_60, pulses: 1 },
            ],
            { wheelMode: "continuous" }
        );
        const starts = intents.filter((i) => i.type === "start");
        const nudges = intents.filter((i) => i.type === "nudge");
        expect(starts.length).toBeGreaterThan(0);
        expect(nudges.length).toBe(0);
        starts.forEach((s) => {
            expect(s.speed).toBeCloseTo(36, 5); // 60 * 0.6
            expect(s.ratio).toBe(1);
            expect(s.axis).toBe("Y");
        });
    });

    test("100% selector → jgv at full max", () => {
        const sm = wheel.create();
        const intents = run(
            sm,
            [
                { axis: "Z", feed: VEL_100, pulses: 1 },
                { axis: "Z", feed: VEL_100, pulses: 1 },
            ],
            { wheelMode: "continuous" }
        );
        const starts = intents.filter((i) => i.type === "start");
        expect(starts.length).toBeGreaterThan(0);
        starts.forEach((s) => expect(s.speed).toBeCloseTo(60, 5));
    });

    test("Lead selector → jgv at full max", () => {
        const sm = wheel.create();
        const intents = run(
            sm,
            [
                { axis: "Z", feed: VEL_LEAD, pulses: 1 },
                { axis: "Z", feed: VEL_LEAD, pulses: 1 },
            ],
            { wheelMode: "continuous" }
        );
        const starts = intents.filter((i) => i.type === "start");
        expect(starts.length).toBeGreaterThan(0);
        starts.forEach((s) => expect(s.speed).toBeCloseTo(60, 5));
    });

    test("step-zone selectors give slow continuous speeds (2/5/10/30%)", () => {
        function speedAt(feed) {
            const sm = wheel.create();
            const intents = run(
                sm,
                [
                    { axis: "X", feed: feed, pulses: 1 },
                    { axis: "X", feed: feed, pulses: 1 },
                ],
                { wheelMode: "continuous" }
            );
            const starts = intents.filter((i) => i.type === "start");
            expect(starts.length).toBeGreaterThan(0);
            return starts[0].speed;
        }
        expect(speedAt(STEP_FINE)).toBeCloseTo(60 * 0.02, 5); // 1.2 IPM
        expect(speedAt(STEP_COARSE)).toBeCloseTo(60 * 0.10, 5); // 6 IPM
        expect(speedAt(STEP_FULL)).toBeCloseTo(60 * 0.30, 5); // 18 IPM
    });

    test("negative pulses → ratio = -1", () => {
        const sm = wheel.create();
        const intents = run(
            sm,
            [
                { axis: "X", feed: VEL_100, pulses: 1, delta: -1 },
                { axis: "X", feed: VEL_100, pulses: 1, delta: -1 },
            ],
            { wheelMode: "continuous" }
        );
        const starts = intents.filter((i) => i.type === "start");
        expect(starts.length).toBeGreaterThan(0);
        starts.forEach((s) => expect(s.ratio).toBe(-1));
    });
});

describe("wheel: continuous mode idle timeout", () => {
    test("jgv stops after IDLE_MS of silence", () => {
        const sm = wheel.create();
        const spinUp = [
            { axis: "X", feed: VEL_100, pulses: 1 },
            { axis: "X", feed: VEL_100, pulses: 1 },
        ];
        const silent = [];
        for (let i = 0; i < 10; i++) {
            silent.push({ axis: "X", feed: VEL_100, pulses: 0 });
        }
        const intents = run(sm, spinUp.concat(silent), { wheelMode: "continuous" });
        const types = intents.map((i) => i.type);
        expect(types.indexOf("start")).toBeGreaterThanOrEqual(0);
        expect(types.indexOf("stop")).toBeGreaterThan(types.indexOf("start"));
    });
});

describe("wheel: no mode / no axis / no feed → no-op", () => {
    test("wheelMode null returns nothing even with pulses", () => {
        const sm = wheel.create();
        const intents = run(
            sm,
            [
                { axis: "X", feed: VEL_100, pulses: 2 },
                { axis: "X", feed: VEL_100, pulses: 2 },
            ],
            { wheelMode: null }
        );
        expect(intents.length).toBe(0);
    });

    test("null axis stops in-flight jgv", () => {
        const sm = wheel.create();
        run(
            sm,
            [
                { axis: "X", feed: VEL_100, pulses: 2 },
                { axis: "X", feed: VEL_100, pulses: 2 },
            ],
            { wheelMode: "continuous" }
        );
        expect(sm.getState().activeMode).toBe("jgv");
        const out = sm.tick(null, VEL_100, 60, 1000, "continuous");
        expect(out).toEqual([{ type: "stop" }]);
    });
});

describe("wheel: axis-change immediate stop", () => {
    test("onAxisChange returns stop when jgv active on different axis", () => {
        const sm = wheel.create();
        run(
            sm,
            [
                { axis: "X", feed: VEL_100, pulses: 1 },
                { axis: "X", feed: VEL_100, pulses: 1 },
            ],
            { wheelMode: "continuous" }
        );
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
});

describe("wheel: consumePulse — per-pulse step-mode dispatch", () => {
    test("step mode + valid selector → immediate nudge of ticks=delta", () => {
        const sm = wheel.create();
        const out = sm.consumePulse(1, "X", STEP_COARSE, 60, "step", 100);
        expect(out.length).toBe(1);
        expect(out[0]).toMatchObject({
            type: "nudge",
            axis: "X",
            ticks: 1,
            stepSize: 0.1,
        });
        // Accumulator drained — a follow-up tick should be a no-op.
        const tickOut = sm.tick("X", STEP_COARSE, 60, 150, "step");
        expect(tickOut).toEqual([]);
    });

    test("step mode + continuous-zone selector emits with stepSize=1.0", () => {
        const sm = wheel.create();
        const out = sm.consumePulse(1, "X", VEL_100, 60, "step", 100);
        expect(out.length).toBe(1);
        expect(out[0].stepSize).toBe(1.0);
        expect(sm.getState().accumulator).toBe(0);
    });

    test("continuous mode → consumePulse just records, no immediate emit", () => {
        const sm = wheel.create();
        const out = sm.consumePulse(1, "X", VEL_100, 60, "continuous", 100);
        expect(out).toEqual([]);
        expect(sm.getState().accumulator).toBe(1);
        // Tick should then emit the continuous start.
        const tickOut = sm.tick("X", VEL_100, 60, 150, "continuous");
        expect(tickOut.some((i) => i.type === "start")).toBe(true);
    });

    test("each step pulse emits one nudge even if called rapidly", () => {
        const sm = wheel.create();
        const intents = [];
        for (let i = 0; i < 5; i++) {
            intents.push.apply(intents, sm.consumePulse(1, "X", STEP_FINE, 60, "step", i));
        }
        const nudges = intents.filter((i) => i.type === "nudge");
        expect(nudges.length).toBe(5);
        nudges.forEach((n) => expect(n.ticks).toBe(1));
    });

    test("negative pulse → ticks = -1", () => {
        const sm = wheel.create();
        const out = sm.consumePulse(-1, "X", STEP_FINE, 60, "step", 100);
        expect(out[0].ticks).toBe(-1);
    });

    test("zero delta → no-op", () => {
        const sm = wheel.create();
        expect(sm.consumePulse(0, "X", STEP_FINE, 60, "step", 100)).toEqual([]);
        expect(sm.getState().accumulator).toBe(0);
    });
});

describe("wheel: mode switching mid-gesture", () => {
    test("continuous → step mid-spin emits stop then step nudges", () => {
        const sm = wheel.create();
        // Spin up continuous on X with VEL_100.
        sm.recordPulse(1, 0);
        let out = sm.tick("X", VEL_100, 60, 50, "continuous");
        expect(out[0].type).toBe("start");
        expect(sm.getState().activeMode).toBe("jgv");

        // User flips Step button + spins knob to step zone before next tick.
        sm.recordPulse(1, 60);
        out = sm.tick("X", STEP_COARSE, 60, 100, "step");
        // Mode change must stop the prior jgv, then step nudge can emit.
        expect(out[0]).toEqual({ type: "stop" });
        expect(out.some((i) => i.type === "nudge" && i.stepSize === 0.1)).toBe(true);
        expect(sm.getState().activeMode).toBeNull();
    });

    test("step → continuous mid-gesture clears step state cleanly", () => {
        const sm = wheel.create();
        sm.recordPulse(1, 0);
        let out = sm.tick("X", STEP_COARSE, 60, 50, "step");
        expect(out[0].type).toBe("nudge");

        // Switch to continuous + velocity-zone selector. No prior jgv → no stop.
        sm.recordPulse(1, 60);
        out = sm.tick("X", VEL_100, 60, 100, "continuous");
        expect(out.some((i) => i.type === "start")).toBe(true);
        expect(out.some((i) => i.type === "stop")).toBe(false);
    });
});

describe("wheel: step mode — snap-to-grid with planned position", () => {
    // These call consumePulse / tick directly so we can vary currentPos and
    // wall-clock between detents — the run() helper assumes a uniform stream.
    const APPROX = 1e-9;

    test("first detent snaps from live currentPos to the next grid line", () => {
        const sm = wheel.create();
        // Off-grid: 5.99964 with stepSize 0.1 should snap forward to 6.000
        const out = sm.consumePulse(1, "X", STEP_COARSE, 60, "step", 100, 5.99964);
        expect(out.length).toBe(1);
        expect(out[0].distance).toBeCloseTo(0.00036, 5);
        expect(out[0].axis).toBe("X");
        expect(out[0].stepSize).toBe(0.1);
    });

    test("subsequent detents walk grid lines using planned position, not live pos", () => {
        const sm = wheel.create();
        // Seed: 5.99964 -> 6.000  (delta 0.00036)
        const first = sm.consumePulse(1, "X", STEP_COARSE, 60, "step", 100, 5.99964);
        // Even if currentPos lags badly (still showing 5.99964), the second
        // detent must advance the plan by a full 0.100 -> 6.100.
        const second = sm.consumePulse(1, "X", STEP_COARSE, 60, "step", 150, 5.99964);
        expect(first[0].distance).toBeCloseTo(0.00036, 5);
        expect(second.length).toBe(1);
        expect(second[0].distance).toBeCloseTo(0.1, APPROX);
    });

    test("already-on-grid advances one full increment, not zero", () => {
        const sm = wheel.create();
        // Position 6.000 with stepSize 0.1 — without the "+= 1 line when on
        // grid" guard this would compute distance=0 and feel dead.
        const out = sm.consumePulse(1, "X", STEP_COARSE, 60, "step", 100, 6.000);
        expect(out.length).toBe(1);
        expect(out[0].distance).toBeCloseTo(0.1, APPROX);
    });

    test("negative detent snaps to grid line below current position", () => {
        const sm = wheel.create();
        // 5.99964 going negative -> 5.900, distance -0.09964
        const out = sm.consumePulse(-1, "X", STEP_COARSE, 60, "step", 100, 5.99964);
        expect(out.length).toBe(1);
        expect(out[0].distance).toBeCloseTo(-0.09964, 5);
    });

    test("multi-tick batch walks N grid lines, not one big snap", () => {
        const sm = wheel.create();
        // 5 pulses arrive in one HID report at 5.99964, stepSize 0.1
        // Should land on 6.400 (consecutive lines 6.000, 6.100, 6.200, 6.300,
        // 6.400), total distance ~0.40036 — NOT a single snap to "next 0.5
        // grid line" which would give 6.000 only.
        const out = sm.consumePulse(5, "X", STEP_COARSE, 60, "step", 100, 5.99964);
        expect(out.length).toBe(1);
        expect(out[0].distance).toBeCloseTo(0.40036, 5);
    });

    test("idle gap re-seeds plan from live currentPos", () => {
        const sm = wheel.create();
        sm.consumePulse(1, "X", STEP_COARSE, 60, "step", 100, 5.99964);
        // After PLANNED_POS_IDLE_MS, plan should clear. User moved axis to
        // 10.05 in the meantime via dashboard. Next detent must snap from
        // 10.05, not the stale plan at 6.000.
        const out = sm.consumePulse(1, "X", STEP_COARSE, 60, "step", 100 + 2000, 10.05);
        expect(out.length).toBe(1);
        // 10.05 snaps forward to 10.1: distance 0.05
        expect(out[0].distance).toBeCloseTo(0.05, APPROX);
    });

    test("axis change clears planned position for the old axis", () => {
        const sm = wheel.create();
        sm.consumePulse(1, "X", STEP_COARSE, 60, "step", 100, 5.99964);
        // Move to Y, then back to X — the X plan must re-seed from live pos.
        sm.onAxisChange("Y");
        sm.onAxisChange("X");
        const out = sm.consumePulse(1, "X", STEP_COARSE, 60, "step", 200, 7.234);
        expect(out.length).toBe(1);
        // 7.234 + snap to 7.3 = +0.066
        expect(out[0].distance).toBeCloseTo(0.066, 5);
    });

    test("switching to continuous and back to step re-seeds plan", () => {
        const sm = wheel.create();
        sm.consumePulse(1, "X", STEP_COARSE, 60, "step", 100, 5.99964);
        // The mode-change clear happens inside tick() by comparing
        // prevWheelMode (set on a previous tick) to the new wheelMode. The
        // real adapter calls tick() every 50ms, so prevWheelMode is always
        // primed; the test has to do the same to be representative.
        sm.tick("X", STEP_COARSE, 60, 120, "step", 6.000);   // prevWheelMode := "step"
        sm.tick("X", VEL_60, 60, 150, "continuous", 6.000);  // step → continuous: clears plan
        // Back to step. New detent at 8.234 must snap from 8.234, not 6.000.
        const out = sm.consumePulse(1, "X", STEP_COARSE, 60, "step", 200, 8.234);
        expect(out.length).toBe(1);
        // 8.234 + snap to 8.3 = +0.066
        expect(out[0].distance).toBeCloseTo(0.066, 5);
    });

    test("missing currentPos falls back to raw ticks*stepSize (no snap)", () => {
        const sm = wheel.create();
        // currentPos undefined → preserves legacy behavior for any caller
        // that doesn't supply live position. ticks*stepSize, no grid.
        const out = sm.consumePulse(1, "X", STEP_COARSE, 60, "step", 100);
        expect(out.length).toBe(1);
        expect(out[0].distance).toBeCloseTo(0.1, APPROX);
    });

    test("tick() path also snaps with currentPos", () => {
        const sm = wheel.create();
        sm.recordPulse(1, 100);
        const out = sm.tick("X", STEP_COARSE, 60, 150, "step", 5.99964);
        const nudges = out.filter((i) => i.type === "nudge");
        expect(nudges.length).toBe(1);
        expect(nudges[0].distance).toBeCloseTo(0.00036, 5);
    });
});
