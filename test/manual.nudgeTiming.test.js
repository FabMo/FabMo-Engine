/*
 * Fixed-mode nudge timing: the "missed key press at the end of a move".
 *
 * Two mechanisms under test. First, queue timing: nudge() executes
 * immediately when idle and queues while moving; the end-of-move stat:3
 * drains the queue and (via the empty-queue branch of _handleNudges) clears
 * `moving`, so a tap landing right after the report executes immediately —
 * with the 2s movement watchdog as the lost-report backstop. Second, the
 * tap-eating flush: the stat:3 handler used to write a raw "%" after EVERY
 * completed move ("flush feed-hold" with no feedhold pending); that raced
 * the next tap's G1 into G2 and could silently discard it. The flush is now
 * gated on an actual stop having been in flight (stop_pending).
 */
"use strict";

jest.mock("../config", () => ({
    machine: { _cache: { manual: { xy_speed: 2, z_fast_speed: 1 }, softlimits_on: false } },
    opensbp: { _cache: { movea_speed: 1, moveb_speed: 1, movec_speed: 1 } },
    driver: { _cache: {} },
}));

var EventEmitter = require("events").EventEmitter;
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
        feedHold: jest.fn(),
        queueFlush: jest.fn(),
        discardStreamBacklog: jest.fn(),
        jogVelocity: jest.fn(),
        jogStop: jest.fn(),
        prime: jest.fn(),
        _write: jest.fn(),
    });
}

function stat(drv, s) {
    drv.status.stat = s;
    drv.emit("status", { stat: s });
}

describe("fixed-mode nudge timing", () => {
    beforeEach(() => {
        jest.useFakeTimers();
        global.CLIENT_DISCONNECTED = false;
    });
    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    test("REGRESSION: a tap landing right after the end-of-move report executes immediately", () => {
        var drv = makeG2();
        var st = { write: jest.fn() };
        var md = new ManualDriver(drv, st);

        md.nudge("Z", 60, -0.1); // tap 1 executes
        expect(st.write).toHaveBeenCalled();
        stat(drv, drv.STAT_RUNNING); // move underway
        stat(drv, drv.STAT_STOP); // move 1 done, queue empty at drain time

        st.write.mockClear();
        md.nudge("Z", 60, -0.1); // tap 2: the stale-moving window
        // Must execute NOW — not after the 2s watchdog, not never.
        expect(st.write).toHaveBeenCalled();
        expect(md.fixedQueue.length).toBe(0);
    });

    test("a tap arriving mid-move queues and drains on the end-of-move report", () => {
        var drv = makeG2();
        var st = { write: jest.fn() };
        var md = new ManualDriver(drv, st);

        md.nudge("Z", 60, -0.1);
        stat(drv, drv.STAT_RUNNING);
        st.write.mockClear();

        md.nudge("Z", 60, -0.1); // mid-move: queued
        expect(st.write).not.toHaveBeenCalled();
        expect(md.fixedQueue.length).toBe(1);

        stat(drv, drv.STAT_STOP); // move 1 ends
        expect(st.write).toHaveBeenCalled(); // tap 2 drained right here
        expect(md.fixedQueue.length).toBe(0);
    });

    test("a transient stat:3 during continuous jog recovers on the next keep-alive", () => {
        var drv = makeG2();
        var st = { write: jest.fn() };
        var md = new ManualDriver(drv, st);

        md.startMotion("X", 60); // legacy G1 path: renew loop armed
        stat(drv, drv.STAT_RUNNING);
        stat(drv, drv.STAT_STOP); // blip: empty-queue drain clears moving/keep_moving

        // The client is still holding the key: its next keep-alive restarts
        // motion (fresh-start path) rather than stalling or feedholding.
        st.write.mockClear();
        md.startMotion("X", 60);
        expect(st.write).toHaveBeenCalled();
        expect(md.moving).toBe(true);
        expect(drv.feedHold).not.toHaveBeenCalled();
    });

    test("REGRESSION: a plain completed move writes NO raw flush (the tap-eating %)", () => {
        var drv = makeG2();
        var st = { write: jest.fn() };
        var md = new ManualDriver(drv, st);

        md.nudge("Z", 60, -0.1);
        stat(drv, drv.STAT_RUNNING);
        stat(drv, drv.STAT_STOP); // move done, no stop was pending
        var flushed = drv._write.mock.calls.some(function (c) {
            return String(c[0]).indexOf("%") !== -1;
        });
        expect(flushed).toBe(false);
    });

    test("a stat:3 that concludes a real stop still flushes the hold", () => {
        var drv = makeG2();
        var st = { write: jest.fn() };
        var md = new ManualDriver(drv, st);

        md.startMotion("X", 60);
        stat(drv, drv.STAT_RUNNING);
        md.stopMotion(); // key released: feedhold + stop_pending
        expect(md.stop_pending).toBe(true);
        stat(drv, drv.STAT_STOP); // the stop completed
        var flushed = drv._write.mock.calls.some(function (c) {
            return String(c[0]).indexOf("%") !== -1;
        });
        expect(flushed).toBe(true);
        expect(md.stop_pending).toBe(false);
    });

    test("REGRESSION: typematic repeats coalesce - a held key never bursts double-steps", () => {
        var drv = makeG2();
        var st = { write: jest.fn() };
        var md = new ManualDriver(drv, st);

        md.nudge("Z", 60, -0.1, null, null, { typematic: true }); // first repeat executes
        stat(drv, drv.STAT_RUNNING);
        st.write.mockClear();

        // The move is slower than the repeat timer: three repeats arrive
        // while it still runs. They must coalesce to ONE queued step.
        md.nudge("Z", 60, -0.1, null, null, { typematic: true });
        md.nudge("Z", 60, -0.1, null, null, { typematic: true });
        md.nudge("Z", 60, -0.1, null, null, { typematic: true });
        expect(md.fixedQueue.length).toBe(1);

        stat(drv, drv.STAT_STOP); // end of move: exactly one step drains
        var g1s = st.write.mock.calls.filter(function (c) {
            return String(c[0]).indexOf("G1") !== -1;
        });
        expect(g1s).toHaveLength(1);
        expect(md.fixedQueue.length).toBe(0);
    });

    test("deliberate taps are counted actions - they all queue and all execute", () => {
        var drv = makeG2();
        var st = { write: jest.fn() };
        var md = new ManualDriver(drv, st);

        md.nudge("Z", 60, -0.1);
        stat(drv, drv.STAT_RUNNING);
        st.write.mockClear();

        md.nudge("Z", 60, -0.1); // three real taps mid-move
        md.nudge("Z", 60, -0.1);
        md.nudge("Z", 60, -0.1);
        expect(md.fixedQueue.length).toBe(3);

        stat(drv, drv.STAT_STOP);
        var g1s = st.write.mock.calls.filter(function (c) {
            return String(c[0]).indexOf("G1") !== -1;
        });
        expect(g1s).toHaveLength(3); // every counted tap executes
    });

    test("a repeat coalesces only with repeats - queued real taps survive it", () => {
        var drv = makeG2();
        var st = { write: jest.fn() };
        var md = new ManualDriver(drv, st);

        md.nudge("Z", 60, -0.1);
        stat(drv, drv.STAT_RUNNING);
        md.nudge("Z", 60, -0.1); // real tap queued
        md.nudge("Z", 60, -0.1, null, null, { typematic: true });
        md.nudge("Z", 60, -0.1, null, null, { typematic: true }); // replaces prior repeat only
        expect(md.fixedQueue.length).toBe(2);
        expect(md.fixedQueue[0].typematic).toBeFalsy();
        expect(md.fixedQueue[1].typematic).toBe(true);
    });

    test("watchdog backstop: a LOST end-of-move report still drains queued taps", () => {
        var drv = makeG2();
        var st = { write: jest.fn() };
        var md = new ManualDriver(drv, st);

        md.nudge("Z", 60, -0.1);
        stat(drv, drv.STAT_RUNNING); // ...and the stat:3 never arrives
        st.write.mockClear();

        md.nudge("Z", 60, -0.1); // queued behind the stale flag
        expect(st.write).not.toHaveBeenCalled();

        jest.advanceTimersByTime(2100); // movement watchdog clears moving + drains
        expect(st.write).toHaveBeenCalled();
        expect(md.fixedQueue.length).toBe(0);
    });
});
