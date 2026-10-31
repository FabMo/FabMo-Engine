/*
 * Snap-to-grid: property tests on the pure math, plus behavior tests for the
 * planned-position chain that feeds it.
 *
 * History (why these exist): snap converts a relative tap into an absolute
 * grid target, which needs a trustworthy base position. Two field bugs came
 * from that: float-dust positions snapping to sub-wire-quantum moves that
 * formatted as "G1 Y0.00000" (dead button), and stale status positions
 * re-snapping back-to-back taps to the same line (partial/missing steps).
 * The hardened version does integer line-index math (property-tested here
 * over every dust position we can craft) and measures from a dead-reckoned
 * planned chain instead of sampled status.
 */
"use strict";

jest.mock("../config", () => ({
    machine: { _cache: { manual: { xy_speed: 2, z_fast_speed: 1 }, softlimits_on: false } },
    opensbp: { _cache: { movea_speed: 1, moveb_speed: 1, movec_speed: 1 } },
    driver: { _cache: {} },
}));

var EventEmitter = require("events").EventEmitter;
var ManualDriver = require("../runtime/manual/driver");
var snap = ManualDriver._snapNudgeDistance;
var ON_LINE_EPS = ManualDriver._SNAP_ON_LINE_EPS;
var WIRE_MIN = ManualDriver._WIRE_MIN_MOVE;

function rng(seed) {
    return function () {
        seed |= 0;
        seed = (seed + 0x6d2b79f5) | 0;
        var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

var INCREMENTS = [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 5];

describe("snapNudgeDistance properties", () => {
    test("for all positions (incl. float dust): sign, magnitude, landing, no dead moves", () => {
        var rand = rng(42);
        var cases = [];
        // Random positions...
        for (var i = 0; i < 2000; i++) {
            cases.push((rand() - 0.5) * 100);
        }
        // ...and crafted dust: positions a hair off every scale of grid line.
        INCREMENTS.forEach(function (inc) {
            for (var line = -3; line <= 3; line++) {
                [0, 1e-12, 1e-9, 1e-7, 5e-6, 1.9e-5, 2.1e-5, 1e-4].forEach(function (dust) {
                    cases.push(line * inc + dust);
                    cases.push(line * inc - dust);
                });
            }
        });

        // Plain-JS validation (one jest assertion total): ~90k expect() calls
        // here cost two minutes of jest overhead, which disqualifies this as
        // a build gate. Failures throw with the full case label instead.
        var checked = 0;
        cases.forEach(function (pos) {
            INCREMENTS.forEach(function (inc) {
                [1, -1].forEach(function (dir) {
                    var d = snap(pos, dir * inc, inc);
                    var label = " at pos=" + pos + " inc=" + inc + " dir=" + dir + " -> " + d;
                    // P1: always moves, in the commanded direction
                    if (Math.sign(d) !== dir) throw new Error("P1 (direction)" + label);
                    // P2: never more than one increment (plus the on-line epsilon)
                    if (Math.abs(d) > inc + ON_LINE_EPS + 1e-12) throw new Error("P2 (magnitude)" + label);
                    // P3: never a dead move - at or above the wire quantum,
                    // and the wire formatting never rounds it to zero
                    if (Math.abs(d) < WIRE_MIN - 1e-12) throw new Error("P3 (sub-quantum)" + label);
                    if (parseFloat(d.toFixed(5)) === 0) throw new Error("P3 (formats to zero)" + label);
                    // P4: lands on a grid line (within float tolerance of the
                    // line index times the increment)
                    var landing = (pos + d) / inc;
                    if (Math.abs(landing - Math.round(landing)) >= 1e-6 / inc + 1e-9) {
                        throw new Error("P4 (off-grid landing)" + label);
                    }
                    checked++;
                });
            });
        });
        expect(checked).toBeGreaterThan(50000);
    });

    test("repeated application walks consecutive grid lines in exact steps", () => {
        var rand = rng(7);
        for (var trial = 0; trial < 200; trial++) {
            var inc = INCREMENTS[Math.floor(rand() * INCREMENTS.length)];
            var dir = rand() < 0.5 ? 1 : -1;
            var pos = (rand() - 0.5) * 50;
            var steps = [];
            for (var i = 0; i < 6; i++) {
                var d = snap(pos, dir * inc, inc);
                steps.push(d);
                pos += d;
            }
            // After the first (possibly partial) alignment step, every step
            // is exactly one increment.
            for (var k = 1; k < steps.length; k++) {
                expect(Math.abs(Math.abs(steps[k]) - inc)).toBeLessThan(1e-9 + ON_LINE_EPS);
            }
        }
    });

    test("float dust never changes the chosen target line", () => {
        INCREMENTS.forEach(function (inc) {
            for (var line = -2; line <= 2; line++) {
                var exact = line * inc;
                [1, -1].forEach(function (dir) {
                    var target = exact + snap(exact, dir * inc, inc);
                    [1e-12, 1e-9, 1e-7].forEach(function (dust) {
                        var up = exact + dust + snap(exact + dust, dir * inc, inc);
                        var dn = exact - dust + snap(exact - dust, dir * inc, inc);
                        expect(Math.abs(up - target)).toBeLessThan(1e-6);
                        expect(Math.abs(dn - target)).toBeLessThan(1e-6);
                    });
                });
            }
        });
    });
});

// ---- planned-position chain behavior ---------------------------------------

function makeG2() {
    var drv = new EventEmitter();
    return Object.assign(drv, {
        STAT_INTERLOCK: 11,
        STAT_SHUTDOWN: 10,
        STAT_PANIC: 13,
        STAT_ALARM: 12,
        STAT_RUNNING: 5,
        STAT_STOP: 3,
        STAT_END: 4,
        STAT_HOLDING: 6,
        status: { stat: 3, hold: 0, posx: 0, posy: 0, posz: 0 },
        pause_hold: false,
        pause_flag: false,
        feedHold: jest.fn(),
        queueFlush: jest.fn(),
        discardStreamBacklog: jest.fn(),
        jogVelocity: jest.fn(),
        jogStop: jest.fn(),
        prime: jest.fn(),
        _write: jest.fn(),
    });
}

function distances(writes) {
    var out = [];
    writes.forEach(function (s) {
        var m = /G1 Z(-?[\d.]+)/.exec(s);
        if (m) out.push(parseFloat(m[1]));
    });
    return out;
}

describe("snap planned-position chain", () => {
    beforeEach(() => {
        jest.useFakeTimers();
        global.CLIENT_DISCONNECTED = false;
    });
    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    test("REGRESSION: back-to-back taps walk the grid even with FROZEN status", () => {
        // The stale-base bug class: status.posz never updates (lost reports,
        // SR lag). The old code re-read it per drain and re-snapped every tap
        // to the same line - partial/zero steps, 'misses'. The planned chain
        // must walk consecutive lines regardless.
        var drv = makeG2();
        drv.status.posz = -11.2251; // off grid
        var writes = [];
        var md = new ManualDriver(drv, {
            write: function (s) {
                writes.push(s);
            },
        });
        for (var i = 0; i < 5; i++) {
            md.nudge("Z", 60, -0.1);
            drv.status.stat = 3;
            drv.emit("status", { stat: 3 }); // drain trigger; posz still frozen
        }
        jest.advanceTimersByTime(5000);
        var d = distances(writes);
        expect(d.length).toBe(5);
        // First step aligns to the grid (-11.3 from -11.2251)...
        expect(d[0]).toBeCloseTo(-0.0749, 4);
        // ...every later step is exactly one increment.
        for (var k = 1; k < d.length; k++) {
            expect(d[k]).toBeCloseTo(-0.1, 6);
        }
    });

    test("continuous jog invalidates the chain; the next tap measures from live status", () => {
        var drv = makeG2();
        var writes = [];
        var md = new ManualDriver(drv, {
            write: function (s) {
                writes.push(s);
            },
        });
        md.nudge("Z", 60, -0.1); // seeds the chain at 0 -> plans -0.1
        drv.status.stat = 3;
        drv.emit("status", { stat: 3 });

        md.startMotion("X", 60); // continuous motion elsewhere: chain is stale
        md.stopMotion();
        drv.status.stat = 3;
        drv.emit("status", { stat: 3 });

        drv.status.posz = -3.07; // where the machine actually is now
        writes.length = 0;
        md.nudge("Z", 60, -0.1);
        var d = distances(writes);
        expect(d.length).toBe(1);
        expect(d[0]).toBeCloseTo(-0.03, 5); // snapped from live -3.07 to -3.1
    });

    test("snap:false (pre-snapped client, e.g. the wheel) executes verbatim and still advances the chain", () => {
        var drv = makeG2();
        drv.status.posz = -11.2251;
        var writes = [];
        var md = new ManualDriver(drv, {
            write: function (s) {
                writes.push(s);
            },
        });
        md.nudge("Z", 60, -0.0749, null, null, { snap: false });
        var d = distances(writes);
        expect(d[0]).toBeCloseTo(-0.0749, 6); // untouched
        drv.status.stat = 3;
        drv.emit("status", { stat: 3 });
        // A snapped tap after it continues from the chain (-11.3), not stale status
        writes.length = 0;
        md.nudge("Z", 60, -0.1);
        expect(distances(writes)[0]).toBeCloseTo(-0.1, 6);
    });

    test("gross disagreement with live status falls back to live (belt)", () => {
        var drv = makeG2();
        var md = new ManualDriver(drv, { write: jest.fn() });
        md._snapPlanned.z = -50; // plan wildly far from reality
        drv.status.posz = 0;
        expect(md._snapBase("z", 0.1)).toBe(0); // live wins
        md._snapPlanned.z = -0.2; // plausible in-flight difference
        expect(md._snapBase("z", 0.1)).toBe(-0.2); // plan wins
    });

    test("a coordinate set invalidates the chain", () => {
        var drv = makeG2();
        var md = new ManualDriver(drv, { write: jest.fn() });
        md._snapPlanned.z = -11.3;
        try {
            md.set({ Z: 0 }); // zeroing Z
        } catch (e) {
            // set() may touch driver APIs the mock lacks - the invalidation
            // happens first and is what's under test.
        }
        expect(md._snapPlanned.z).toBeUndefined();
    });
});
