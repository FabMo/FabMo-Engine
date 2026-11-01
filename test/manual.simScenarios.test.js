/*
 * Manual-drive scenario tests against a simulated motion controller
 * (fixtures/simg2.js) — the timing-contract gate. Each scenario encodes a
 * CLASS of field bug as behavior over realistic move durations, status
 * latency, and wire transit, rather than pinning one reproduction:
 *
 *  - no deliberate tap is ever lost, whatever phase it lands at relative to
 *    the previous move's completion and status report (the tap-eating %)
 *  - a held fixed-mode key never bursts stacked steps (typematic coalescing)
 *  - a continuous jog whose client goes silent stops on the motion lease
 */
"use strict";

jest.mock("../config", () => ({
    machine: { _cache: { manual: { xy_speed: 2, z_fast_speed: 1 }, softlimits_on: false } },
    opensbp: { _cache: { movea_speed: 1, moveb_speed: 1, movec_speed: 1 } },
    driver: { _cache: {} },
}));

var SimG2 = require("./fixtures/simg2");
var ManualDriver = require("../runtime/manual/driver");

// Deterministic PRNG so awkward phases are reproducible.
function rng(seed) {
    return function () {
        seed |= 0;
        seed = (seed + 0x6d2b79f5) | 0;
        var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function make() {
    var sim = new SimG2();
    var md = new ManualDriver(sim, sim.stream);
    return { sim: sim, md: md };
}

describe("manual drive against a simulated controller", () => {
    beforeEach(() => {
        jest.useFakeTimers();
        global.CLIENT_DISCONNECTED = false;
    });
    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    test("no deliberate tap is ever lost, at any phase (3 seeds x 15 taps)", () => {
        for (var seed = 1; seed <= 3; seed++) {
            var rand = rng(seed);
            var s = make();
            var TAPS = 15;
            // 0.1" at 60 units/min: ~120ms per move; gaps 60-450ms straddle
            // every interesting phase: mid-move, pre-report, post-report.
            for (var i = 0; i < TAPS; i++) {
                s.md.nudge("Z", 60, -0.1);
                jest.advanceTimersByTime(60 + Math.floor(rand() * 390));
            }
            jest.advanceTimersByTime(8000); // drain everything
            expect(s.sim.executed.length).toBe(TAPS);
            expect(s.sim.status.posz).toBeCloseTo(-0.1 * TAPS, 6);
        }
    });

    test("typematic slower than the repeat timer: even steps, never bursts", () => {
        var s = make();
        // 0.5" at 60 units/min: ~520ms per move; repeats arrive every 100ms.
        var HOLD_MS = 4000;
        for (var t = 0; t < HOLD_MS; t += 100) {
            s.md.nudge("Z", 60, -0.5, null, null, { typematic: true });
            jest.advanceTimersByTime(100);
        }
        jest.advanceTimersByTime(3000);

        var ex = s.sim.executed;
        // Coalescing: roughly one step per move-cycle, nowhere near one per
        // repeat (40 were sent).
        expect(ex.length).toBeGreaterThan(3);
        expect(ex.length).toBeLessThan(12);
        // Never bursts: each step starts a full move-cycle after the last —
        // no two steps back-to-back out of a stacked backlog.
        for (var i = 1; i < ex.length; i++) {
            expect(ex[i].startT - ex[i - 1].endT).toBeGreaterThan(20);
        }
        // Every executed step is the full increment (snap from a grid start).
        ex.forEach(function (m) {
            expect(Math.abs(m.words[0].dist)).toBeCloseTo(0.5, 6);
        });
    });

    test("continuous jog with a dead client stops on the lease, not never", () => {
        var s = make();
        s.md.startMotion("X", 60);
        // Live client for a while: keep-alives every 50ms.
        for (var t = 0; t < 600; t += 50) {
            s.md.startMotion("X", 60);
            jest.advanceTimersByTime(50);
        }
        expect(s.sim.feedHolds).toBe(0);

        // Client dies silently (no stop, no disconnect).
        jest.advanceTimersByTime(2000);
        expect(s.sim.feedHolds).toBeGreaterThan(0); // lease stopped it

        // ...and nothing keeps feeding the queue afterwards.
        var executedAtStop = s.sim.executed.length;
        var queuedAtStop = s.sim.queue.length;
        jest.advanceTimersByTime(2000);
        expect(s.sim.queue.length).toBeLessThanOrEqual(queuedAtStop);
        expect(s.sim.executed.length - executedAtStop).toBeLessThanOrEqual(queuedAtStop);
    });

    test("REGRESSION-CLASS: a tap just after the end-of-move report survives the flush window", () => {
        // The tap-eating % laid a 15ms wire-latency trap right after every
        // completed move's report. This pins a tap INSIDE that window:
        // tap1 written at t=0, intake 30ms, runs 120ms (0.1 @ 60upm + 20ms
        // overhead) -> done 150ms; stat:3 report lands at 210ms. The old
        // unconditional % went out at 210 and took effect at 225 — a tap
        // written at 212 began intake until 242 and was discarded. The gated
        // flush writes nothing after a plain move, so the tap must survive.
        var s = make();
        s.md.nudge("Z", 60, -0.1);
        jest.advanceTimersByTime(212);
        s.md.nudge("Z", 60, -0.1);
        jest.advanceTimersByTime(8000);
        expect(s.sim.executed.length).toBe(2);
        expect(s.sim.status.posz).toBeCloseTo(-0.2, 6);
    });

    test("a tap arriving during the stop-flush of a continuous jog still executes", () => {
        var s = make();
        s.md.startMotion("X", 60);
        jest.advanceTimersByTime(200);
        s.md.stopMotion(); // release: feedhold + % in flight
        jest.advanceTimersByTime(5); // tap lands INSIDE the wire window
        var executedBefore = s.sim.executed.filter(function (m) {
            return m.words[0].axis === "z";
        }).length;
        s.md.nudge("Z", 60, -0.1);
        jest.advanceTimersByTime(8000);
        var zMoves = s.sim.executed.filter(function (m) {
            return m.words[0].axis === "z";
        });
        expect(zMoves.length - executedBefore).toBe(1);
    });
});
