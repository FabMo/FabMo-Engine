/*
 * Keypad move into a hard-limit switch: motion must not resume on release.
 *
 * When G2 feedholds on an input mid-move, g2.js pauses the cycle stream
 * (CycleContext.pause) so that a paused FILE resumes where it left off. In
 * manual mode the keypad renew loop kept writing move segments into that
 * paused stream for as long as the button stayed down. Those lines live in
 * the stream's own buffer, not in gcode_queue, so the release-time
 * queueFlush() never saw them -- and the moment the `%` ended the hold, the
 * stream resumed and the whole backlog ran. (Seen on a live tool as "held the
 * button a few seconds after the limit stopped the tool; motion resumed on
 * release and kept going until the next keypad press".)
 *
 * Two fixes under test:
 *  - driver.js: the manual driver writes nothing while driver.pause_flag is
 *    set (fresh start or renew tick), keeping the renew timer alive.
 *  - g2.js: discardStreamBacklog() drains whatever is parked in the paused
 *    cycle stream; the manual driver calls it right after queueFlush().
 */
"use strict";

jest.mock("../config", () => ({
    machine: { _cache: { manual: { xy_speed: 2, z_fast_speed: 1 }, softlimits_on: false } },
    opensbp: { _cache: { movea_speed: 1, moveb_speed: 1, movec_speed: 1 } },
    driver: { _cache: {} },
}));

var stream = require("stream");
var EventEmitter = require("events").EventEmitter;
var g2 = require("../g2");
var ManualDriver = require("../runtime/manual/driver");

function tick() {
    return new Promise(function (resolve) {
        setImmediate(resolve);
    });
}

describe("G2.discardStreamBacklog", () => {
    function makeRealDriver() {
        var d = new g2.G2();
        d.status.stat = g2.STAT_STOP; // parked, so a cycle context can be created
        d._write = jest.fn(); // never touch a serial port
        global.CUR_RUNTIME = "[IdleRuntime]"; // suppress the run-start preamble lines
        return d;
    }

    test("without discard, lines written during a hold replay when the stream resumes (the bug)", async () => {
        var d = makeRealDriver();
        var src = new stream.PassThrough();
        d.runStream(src);

        src.write("G1 X0.1\n");
        await tick();
        expect(d.gcode_queue.getLength()).toBe(1);

        d.context.pause(); // what handleStatusReport does on STAT_HOLDING
        src.write("G1 X0.2\nG1 X0.3\n");
        await tick();
        expect(d.gcode_queue.getLength()).toBe(1); // parked in the stream, not queued

        d.gcode_queue.clear(); // what queueFlush() does on release
        d.context.resume(); // what the stat:3 after `%` does
        await tick();
        expect(d.gcode_queue.getLength()).toBe(2); // ...and here they come back
    });

    test("discardStreamBacklog drops the parked lines so nothing replays on resume", async () => {
        var d = makeRealDriver();
        var src = new stream.PassThrough();
        d.runStream(src);

        d.context.pause();
        src.write("G1 X0.2\nG1 X0.3\nG1 X0.4\n");
        await tick();
        expect(d.gcode_queue.getLength()).toBe(0);

        var dropped = d.discardStreamBacklog();
        expect(dropped).toBeGreaterThan(0);
        expect(d._discardingStream).toBe(false);

        d.context.resume();
        await tick();
        expect(d.gcode_queue.getLength()).toBe(0);
        expect(d.lineBuffer).toEqual([]);

        // The stream is still usable afterwards
        src.write("G1 X0.5\n");
        await tick();
        expect(d.gcode_queue.getLength()).toBe(1);
    });

    test("is a no-op without a cycle context", () => {
        var d = makeRealDriver();
        expect(d.discardStreamBacklog()).toBe(0);
    });
});

describe("ManualDriver while G2 is holding", () => {
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
            prime: jest.fn(),
            _write: jest.fn(),
        });
    }

    beforeEach(() => {
        jest.useFakeTimers();
    });
    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    test("renew loop writes nothing while pause_flag is set, and picks up again after", () => {
        var drv = makeG2();
        var st = { write: jest.fn() };
        var md = new ManualDriver(drv, st);

        md.startMotion("X", 60); // fresh start: header + first batch
        expect(st.write).toHaveBeenCalled();
        st.write.mockClear();

        drv.pause_flag = true; // limit input fired: G2 holding, stream paused
        // The user is still holding the key, so the client's ~50ms command
        // stream keeps arriving through the hold. (Under the motion lease,
        // keep_moving is consumed each tick and must be re-asserted — a hold
        // with NO client traffic is covered by the lease tests instead.)
        md.startMotion("X", 60);
        jest.advanceTimersByTime(300);
        md.startMotion("X", 60);
        jest.advanceTimersByTime(300);
        expect(st.write).not.toHaveBeenCalled();
        expect(md.renew_timer).not.toBeNull(); // loop stays armed

        drv.pause_flag = false; // hold ended with motion still requested
        md.startMotion("X", 60);
        jest.advanceTimersByTime(300);
        expect(st.write).toHaveBeenCalled();
    });

    test("a start arriving during a hold writes nothing (no fresh-start header into the paused stream)", () => {
        var drv = makeG2();
        var st = { write: jest.fn() };
        var md = new ManualDriver(drv, st);

        drv.pause_flag = true;
        md.startMotion("X", 60);
        expect(st.write).not.toHaveBeenCalled();
        expect(md.keep_moving).toBe(true);
        expect(md.moving).toBe(false);
    });

    test("stopMotion discards the stream backlog after flushing the queue", () => {
        var drv = makeG2();
        var md = new ManualDriver(drv, { write: jest.fn() });
        md.startMotion("X", 60);

        md.stopMotion();
        expect(drv.feedHold).toHaveBeenCalled();
        expect(drv.queueFlush).toHaveBeenCalled();
        expect(drv.discardStreamBacklog).toHaveBeenCalled();
    });

    test("stopMotion during a goto hold neither flushes nor discards (the paused goto must survive)", () => {
        var drv = makeG2();
        var md = new ManualDriver(drv, { write: jest.fn() });
        md.gotoModeHold = true;

        md.stopMotion();
        expect(drv.feedHold).toHaveBeenCalled();
        expect(drv.queueFlush).not.toHaveBeenCalled();
        expect(drv.discardStreamBacklog).not.toHaveBeenCalled();
    });
});
