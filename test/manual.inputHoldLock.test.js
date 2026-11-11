/*
 * Input-forced feedhold while the keypad is up (stuck-keypad bug).
 *
 * A stop/limit/driver-fault input tripping while the manual (keypad) runtime
 * is active puts G2 in a feedhold the engine didn't ask for. The hold pauses
 * the cycle stream, so anything written to it — including exit()'s M30 —
 * just buffers, the machining cycle never ends, and the machine is stuck in
 * the manual state: the dashboard keypad shows whenever state is "manual",
 * so it could never be dismissed.
 *
 * Fix under test, two halves:
 *  - the ManualRuntime routes an input-forced hold through
 *    machine.setState("paused"), whose interlock table re-classifies it to
 *    lock/limit/driverFault and puts up the standard Resume/Quit dialog;
 *  - ManualDriver.exit() (and its watchdog) end a hold found in the way —
 *    discard the stream backlog, flush (%) — so the M30 can land.
 */
"use strict";

jest.mock("../config", () => ({
    machine: { _cache: { manual: { xy_speed: 2, z_fast_speed: 1 }, softlimits_on: false } },
    opensbp: { _cache: { movea_speed: 1, moveb_speed: 1, movec_speed: 1 } },
    driver: { _cache: {} },
}));

var EventEmitter = require("events").EventEmitter;
var ManualDriver = require("../runtime/manual/driver");
var ManualRuntime = require("../runtime/manual/index").ManualRuntime;

var EXIT_WATCHDOG_INTERVAL = 1000; // mirror of driver.js

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
        quit_pending: false,
        feedHold: jest.fn(),
        queueFlush: jest.fn(),
        discardStreamBacklog: jest.fn(),
        prime: jest.fn(),
        _write: jest.fn(),
    });
}

function makeMachine(drv) {
    return {
        driver: drv,
        status: { state: "manual", stat: 3, inFeedHold: false, currentCmd: null },
        setState: jest.fn(),
        emit: jest.fn(),
    };
}

describe("input-forced feedhold in the manual runtime", () => {
    function makeRuntime() {
        var drv = makeG2();
        var machine = makeMachine(drv);
        var rt = new ManualRuntime();
        rt.connect(machine);
        rt.helper = { gotoModeHold: false, stop_pending: false };
        return { rt: rt, machine: machine };
    }

    test("hold we didn't initiate leaves the manual state via setState('paused')", () => {
        var t = makeRuntime();
        t.rt._onG2Status({ stat: 6, inFeedHold: true });
        expect(t.machine.setState).toHaveBeenCalledWith(t.rt, "paused");
    });

    test("holds from our own stop dance (stop_pending) are left alone", () => {
        var t = makeRuntime();
        t.rt.helper.stop_pending = true;
        t.rt._onG2Status({ stat: 6, inFeedHold: true });
        expect(t.machine.setState).not.toHaveBeenCalled();
    });

    test("goto holds keep their existing handling", () => {
        var t = makeRuntime();
        t.rt.helper.gotoModeHold = true;
        t.rt._onG2Status({ stat: 6, inFeedHold: true });
        // Still transitions to paused, via the goto branch
        expect(t.machine.setState).toHaveBeenCalledWith(t.rt, "paused");
    });

    test("does not re-fire once the machine has left the manual state", () => {
        var t = makeRuntime();
        t.machine.status.state = "lock";
        t.rt._onG2Status({ stat: 6, inFeedHold: true });
        expect(t.machine.setState).not.toHaveBeenCalled();
    });

    test("no hold, no transition", () => {
        var t = makeRuntime();
        t.rt._onG2Status({ stat: 3, inFeedHold: false });
        expect(t.machine.setState).not.toHaveBeenCalled();
    });
});

// The real status sequence of a keypad stop, through the REAL helper: G2
// reports stat:6 more than once while it decelerates, and the helper clears
// stop_pending on the first of them. The reports that follow must still be
// attributed to our own stop — otherwise an ordinary jog stop (most visibly
// when reversing direction at speed) pops the input-hold Resume/Quit dialog.
describe("our own keypad stop is never mistaken for an input-forced hold", () => {
    function makeLive() {
        var drv = makeG2();
        var machine = makeMachine(drv);
        var rt = new ManualRuntime();
        rt.connect(machine);
        rt.helper = new ManualDriver(drv, { write: jest.fn() });
        return { rt: rt, machine: machine, drv: drv, md: rt.helper };
    }
    function report(t, stat) {
        t.drv.status.stat = stat;
        t.drv.emit("status", { stat: stat, inFeedHold: stat === 6 });
    }

    beforeEach(() => {
        jest.useFakeTimers();
        global.CLIENT_DISCONNECTED = false;
    });
    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    test("repeated stat:6 reports during our stop do not leave the manual state", () => {
        var t = makeLive();
        t.md.startMotion("X", 144);
        report(t, 5);
        t.md.stopMotion();
        report(t, 6); // helper clears stop_pending here
        expect(t.md.stop_pending).toBe(false);
        report(t, 6); // ...and G2 is still decelerating
        report(t, 6);
        expect(t.machine.setState).not.toHaveBeenCalledWith(t.rt, "paused");
        report(t, 3);
        expect(t.machine.setState).not.toHaveBeenCalledWith(t.rt, "paused");
    });

    test("an input hold after our stop has completed is still caught", () => {
        var t = makeLive();
        t.md.startMotion("X", 144);
        report(t, 5);
        t.md.stopMotion();
        report(t, 6);
        report(t, 3); // our stop dance is over
        report(t, 6); // a stop input trips right afterwards
        expect(t.machine.setState).toHaveBeenCalledWith(t.rt, "paused");
    });

    test("a hold that outlives the stop dance is handed to the input-hold path", () => {
        var t = makeLive();
        t.md.startMotion("X", 144);
        report(t, 5);
        t.md.stopMotion();
        report(t, 6);
        jest.advanceTimersByTime(1500);
        jest.setSystemTime(Date.now() + 3000);
        report(t, 6);
        expect(t.machine.setState).toHaveBeenCalledWith(t.rt, "paused");
    });
});

describe("ManualDriver.exit() during an input-forced hold", () => {
    beforeEach(() => {
        jest.useFakeTimers();
        global.CLIENT_DISCONNECTED = false;
    });
    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    function wrote(st, token) {
        return st.write.mock.calls.some(function (c) {
            return String(c[0]).indexOf(token) !== -1;
        });
    }

    test("flushes the hold before writing the exit lines", () => {
        var drv = makeG2();
        drv.pause_flag = true;
        drv.status.stat = drv.STAT_HOLDING;
        var st = { write: jest.fn() };
        var md = new ManualDriver(drv, st);

        md.exit();

        expect(drv.discardStreamBacklog).toHaveBeenCalled();
        expect(drv.queueFlush).toHaveBeenCalled();
        expect(wrote(st, "M30")).toBe(true); // exit lines still written (flow after the flush)
    });

    test("no flush when the hold is our own stop dance", () => {
        var drv = makeG2();
        drv.pause_flag = true;
        var st = { write: jest.fn() };
        var md = new ManualDriver(drv, st);
        md.stop_pending = true;

        md.exit();

        expect(drv.queueFlush).not.toHaveBeenCalled();
        expect(wrote(st, "M30")).toBe(true);
    });

    test("no flush when a quit (job kill) is already pending", () => {
        var drv = makeG2();
        drv.pause_flag = true;
        drv.quit_pending = true;
        var st = { write: jest.fn() };
        var md = new ManualDriver(drv, st);

        md.exit();

        expect(drv.queueFlush).not.toHaveBeenCalled();
    });

    test("no flush on a clean exit", () => {
        var drv = makeG2();
        var st = { write: jest.fn() };
        var md = new ManualDriver(drv, st);

        md.exit();

        expect(drv.queueFlush).not.toHaveBeenCalled();
        expect(drv.discardStreamBacklog).not.toHaveBeenCalled();
        expect(wrote(st, "M30")).toBe(true);
    });

    test("re-entered exit with a dead stream flushes a hold instead of giving up", () => {
        var drv = makeG2();
        drv.status.stat = drv.STAT_HOLDING;
        var st = { write: jest.fn() };
        var md = new ManualDriver(drv, st);
        md.stream = null;

        md.exit();

        expect(drv.discardStreamBacklog).toHaveBeenCalled();
        expect(drv._write).toHaveBeenCalledWith("%\n");
    });

    test("watchdog flushes a hold, then re-sends M30 once the cycle parks at stat:3", () => {
        var drv = makeG2();
        var st = { write: jest.fn() };
        var md = new ManualDriver(drv, st);

        md.exit(); // clean exit; M30 written into the stream
        drv._write.mockClear();

        // An input hold pins the cycle before the M30 can land
        drv.status.stat = drv.STAT_HOLDING;
        jest.advanceTimersByTime(EXIT_WATCHDOG_INTERVAL + 10);
        expect(drv._write).toHaveBeenCalledWith("%\n");
        expect(drv.discardStreamBacklog).toHaveBeenCalled();

        // The flush parks the cycle at stat:3 — the next check re-sends M30
        drv.status.stat = drv.STAT_STOP;
        jest.advanceTimersByTime(EXIT_WATCHDOG_INTERVAL + 10);
        expect(drv._write).toHaveBeenCalledWith("M30\n");
    });
});
