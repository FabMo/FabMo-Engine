/*
 * Soft-limit speed cap on the firmware velocity-jog (jgv) path.
 *
 * The host caps each axis's commanded velocity from its remaining margin.
 * These tests run the real cap against a model of the firmware cycle as
 * measured on the bench (firmware 101.57.68): the cycle keeps a planner queue
 * of ~0.2s, so a setpoint reaches the motors that much later; when the cycle
 * starts, the queue is pre-filled with the first setpoint; velocity ramps
 * linearly at velocity_max / 0.25s. Position reaches the host through status
 * reports that are usually 100ms apart but can be much later, and the cap is
 * re-evaluated every 50ms.
 */
"use strict";

jest.mock("../config", () => ({
    machine: {
        _cache: {
            manual: { xy_speed: 2, z_fast_speed: 1, softlimit_cushion: 0 },
            softlimits_on: true,
            units: "in",
            envelope: { xmin: -0.5, xmax: 12, ymin: -0.5, ymax: 12, zmin: -2, zmax: 0 },
        },
    },
    opensbp: { _cache: { jogxy_speed: 12, jogz_speed: 3 } },
    driver: { _cache: {}, get: (k) => (k === "xfr" || k === "yfr" ? 300 : 0) },
}));

var EventEmitter = require("events").EventEmitter;
var config = require("../config");
var ManualDriver = require("../runtime/manual/driver");

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
        status: { stat: 5, hold: 0, posx: 0, posy: 0, posz: 0 },
        pause_hold: false,
        pause_flag: false,
        jgv_supported: true,
        feedHold: jest.fn(),
        queueFlush: jest.fn(),
        discardStreamBacklog: jest.fn(),
        jogVelocity: jest.fn(),
        jogStop: jest.fn(),
        prime: jest.fn(),
        _write: jest.fn(),
    });
}

// Runs a held jog against the firmware model. `keepAlive` is "start" (client
// re-sends the start command each tick) or "maint" (client heartbeats).
// Returns the true final position per axis.
function runJog(opts) {
    var QUEUE_S = opts.queue || 0.25; // planner queue dead time
    var VMAX = 12; // in/s, firmware velocity_max
    var FEED_MAX = 5; // in/s, feed-rate limit (xfr)
    var ACCEL = VMAX / 0.25;
    var DT = 0.001;

    var drv = makeG2();
    var md = new ManualDriver(drv, { write: jest.fn() });
    md._gestureCapEnabled = () => false;

    var pos = { x: opts.start.x, y: opts.start.y };
    var vel = { x: 0, y: 0 };
    var history = []; // [time, {x, y}] setpoints in in/s
    var trail = []; // true position at each 1ms step
    drv.status.posx = pos.x;
    drv.status.posy = pos.y;
    drv.jogVelocity.mockImplementation(function (vec) {
        history.push([t, { x: (vec.x || 0) / 60, y: (vec.y || 0) / 60 }]);
        // The cap must never command a crawl: the firmware turns it into
        // segments that take seconds and block the queue.
        ["x", "y"].forEach(function (a) {
            if (
                vec[a] &&
                Math.abs(vec[a]) < 3 - 1e-9 &&
                Math.abs(vec[a]) < Math.abs(opts.speed * (opts[a] || 0)) - 1e-9
            ) {
                throw new Error("crawl setpoint sent: " + a + "=" + vec[a]);
            }
        });
        // ...nor exceed the feed-rate limit, which stretches the queue.
        expect(Math.abs(vec.x || 0)).toBeLessThanOrEqual(300 + 1e-9);
        expect(Math.abs(vec.y || 0)).toBeLessThanOrEqual(300 + 1e-9);
    });

    var T0 = Date.now();
    drv.jogStop.mockImplementation(function () {
        history.push([t, { x: 0, y: 0 }]);
    });

    var t = 0;
    var cycleStart = null;
    var sent = false;
    for (var step = 0; step < opts.seconds * 1000; step++) {
        t = step * DT;
        jest.setSystemTime(T0 + step);
        // Status report every 100ms, except during a dropout window.
        var dropped = opts.srGap && t >= opts.srGap[0] && t < opts.srGap[1];
        // Reports are delivered late: they carry the position of 60ms ago.
        trail.push({ x: pos.x, y: pos.y });
        if (step % 100 === 0 && !dropped) {
            var old = trail[Math.max(0, trail.length - 1 - 60)];
            drv.status.posx = old.x;
            drv.status.posy = old.y;
            drv.status.stat = vel.x === 0 && vel.y === 0 ? 3 : 5;
            md._onG2Status(drv.status);
        }
        // opts.release = [from, to]: the key is up for that interval.
        var released = opts.release && t >= opts.release[0] && t < opts.release[1];
        if (released) {
            if (sent) {
                md.stopMotion();
                sent = false;
            }
            if (cycleStart === null && md.analogMode) drv.emit("jogv_exit");
        } else if (step % 50 === 0) {
            if (!sent || opts.keepAlive === "start") {
                md.startMotion("X", opts.speed, opts.y ? "Y" : undefined, opts.speed, opts.x, opts.y || 0);
                sent = true;
            } else {
                md.maintainMotion();
            }
        }
        // Cycle start: the first nonzero setpoint while idle. The queue is
        // pre-filled with it, so it is followed at once.
        var latest = history.length ? history[history.length - 1] : null;
        if (cycleStart === null && latest && (latest[1].x || latest[1].y)) {
            cycleStart = latest[0];
        }
        // Setpoint the motors are following now: the newest one older than
        // the queue dead time, but never older than the cycle start.
        var target = { x: 0, y: 0 };
        if (cycleStart !== null) {
            var asOf = Math.max(t - QUEUE_S, cycleStart);
            for (var i = history.length - 1; i >= 0; i--) {
                if (history[i][0] <= asOf) {
                    target = history[i][1];
                    break;
                }
            }
            // Cycle exit: ramped to rest with nothing but zeros queued.
            if (!vel.x && !vel.y && !target.x && !target.y && !latest[1].x && !latest[1].y) {
                cycleStart = null;
            }
        }
        ["x", "y"].forEach(function (a) {
            var tgt = Math.max(-FEED_MAX, Math.min(FEED_MAX, target[a]));
            var dv = tgt - vel[a];
            var max = ACCEL * DT;
            vel[a] += Math.max(-max, Math.min(max, dv));
            pos[a] += vel[a] * DT;
        });
    }
    return pos;
}

describe("jgv soft-limit speed cap", () => {
    beforeEach(() => {
        jest.useFakeTimers();
        global.CLIENT_DISCONNECTED = false;
        config.machine._cache.softlimits_on = true;
    });
    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    test("safe speed can be held one revision interval and still ramp to zero", () => {
        var v = ManualDriver._jgvSafeSpeed(1.5, 12);
        expect(v * 0.1 + (v * v) / (2 * (12 / 0.25))).toBeCloseTo(1.5, 6); // v*HOLD + v^2/2a
        expect(ManualDriver._jgvSafeSpeed(0, 12)).toBe(0);
        expect(ManualDriver._jgvSafeSpeed(-1, 12)).toBe(0);
    });

    test("full-speed jog into X min stops at the limit, not past it", () => {
        var pos = runJog({ start: { x: 8, y: 6 }, speed: 384, x: -1, seconds: 8, keepAlive: "start" });
        expect(pos.x).toBeGreaterThanOrEqual(-0.5);
        expect(pos.x).toBeLessThan(-0.2); // and does not park far short
    });

    test("the cap still holds when the client heartbeats with maint", () => {
        var pos = runJog({ start: { x: 8, y: 6 }, speed: 384, x: -1, seconds: 8, keepAlive: "maint" });
        expect(pos.x).toBeGreaterThanOrEqual(-0.5);
        expect(pos.x).toBeLessThan(-0.2);
    });

    test("holds with the slowest firmware response seen on the bench", () => {
        var pos = runJog({ start: { x: 8, y: 6 }, speed: 384, x: -1, seconds: 8, keepAlive: "start", queue: 0.3 });
        expect(pos.x).toBeGreaterThanOrEqual(-0.5);
    });

    test("holds through a 450ms gap in status reports during the approach", () => {
        // 8" out at 5 in/s reaches the limit region ~1.4s in; blind the
        // host from 1.0s to 1.45s, as logged on the bench.
        var pos = runJog({
            start: { x: 8, y: 6 },
            speed: 390,
            x: -1,
            seconds: 8,
            keepAlive: "start",
            srGap: [1.0, 1.45],
        });
        expect(pos.x).toBeGreaterThanOrEqual(-0.5);
        expect(pos.x).toBeLessThan(-0.2);
    });

    test("holds when reports stop arriving altogether", () => {
        var pos = runJog({
            start: { x: 8, y: 6 },
            speed: 390,
            x: -1,
            seconds: 8,
            keepAlive: "start",
            srGap: [0.5, 99],
        });
        expect(pos.x).toBeGreaterThanOrEqual(-0.5);
    });

    test("short start from near the limit, with the first report late", () => {
        var pos = runJog({
            start: { x: 0.7, y: 6 },
            speed: 390,
            x: -1,
            seconds: 6,
            keepAlive: "start",
            srGap: [0.05, 0.5],
        });
        expect(pos.x).toBeGreaterThanOrEqual(-0.5);
        expect(pos.x).toBeLessThan(-0.2);
    });

    test("pressing again from just inside the limit does not sneak past", () => {
        [0.05, 0.12, 0.3, 0.6].forEach(function (gap) {
            [60, 132, 390].forEach(function (speed) {
                var pos = runJog({
                    start: { x: -0.5 + gap, y: 6 },
                    speed: speed,
                    x: -1,
                    seconds: 4,
                    keepAlive: "start",
                });
                expect(pos.x).toBeGreaterThanOrEqual(-0.5);
            });
        });
    });

    test("release and re-press during the approach", () => {
        var pos = runJog({
            start: { x: 3, y: 6 },
            speed: 132,
            x: -1,
            seconds: 8,
            keepAlive: "start",
            release: [1.2, 1.5],
        });
        expect(pos.x).toBeGreaterThanOrEqual(-0.5);
        expect(pos.x).toBeLessThan(-0.2);
    });

    test("diagonal into a corner stops both axes inside the envelope", () => {
        var pos = runJog({
            start: { x: 6, y: 4 },
            speed: 384,
            x: -Math.SQRT1_2,
            y: -Math.SQRT1_2,
            seconds: 8,
            keepAlive: "start",
        });
        expect(pos.x).toBeGreaterThanOrEqual(-0.5);
        expect(pos.y).toBeGreaterThanOrEqual(-0.5);
    });

    test("backing away from a limit is not capped", () => {
        var drv = makeG2();
        var md = new ManualDriver(drv, { write: jest.fn() });
        drv.status.posx = -0.5;
        md.startMotion("X", 132, undefined, undefined, 1, 0);
        expect(drv.jogVelocity.mock.calls[0][0].x).toBe(132);
    });

    test("a request above the feed-rate limit is scaled down, keeping its direction", () => {
        var drv = makeG2();
        var md = new ManualDriver(drv, { write: jest.fn() });
        drv.status.posx = 6;
        drv.status.posy = 6;
        md.startMotion("X", 720, "Y", 720, 0.8, 0.6);
        var vec = drv.jogVelocity.mock.calls[0][0];
        expect(vec.x).toBeCloseTo(300, 6);
        expect(vec.y).toBeCloseTo(225, 6);
    });

    test("an axis at its limit is zeroed while the other keeps moving", () => {
        var drv = makeG2();
        var md = new ManualDriver(drv, { write: jest.fn() });
        drv.status.posx = -0.495;
        drv.status.posy = 6;
        md.startMotion("X", 300, "Y", 300, -0.6, 0.8);
        var vec = drv.jogVelocity.mock.calls[0][0];
        expect(vec.x).toBe(0);
        expect(vec.y).toBeCloseTo(240, 3);
    });

    test("no cap when Enforce Software Limits is off", () => {
        config.machine._cache.softlimits_on = false;
        var drv = makeG2();
        var md = new ManualDriver(drv, { write: jest.fn() });
        drv.status.posx = -0.45;
        md.startMotion("X", 300, undefined, undefined, -1, 0);
        expect(drv.jogVelocity.mock.calls[0][0].x).toBe(-300);
    });
});
