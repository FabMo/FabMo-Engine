/*
 * gotoModeHold lifecycle (the phantom resume/quit bug).
 *
 * A keypad GoTo sets gotoModeHold so that a feedhold mid-goto pauses the
 * machine (resume/quit UI) instead of being flushed like a jog stop. The
 * flag was only ever cleared by the next *continuous* jog (startMotion),
 * never when the goto finished — so after any completed GoTo, a bare stop
 * (fixed-mode tap release, slide-off, page scroll on a small touchscreen)
 * issued a feedhold that skipped the queue flush and flipped the machine
 * to "paused", popping resume/quit out of nowhere.
 *
 * The fix clears the flag when the cycle reaches STAT_STOP/STAT_END (the
 * goto's trailing M0 parks at stat:3) — and deliberately NOT on
 * STAT_HOLDING, where the flag is load-bearing for the real pause-a-goto
 * feature.
 */
"use strict";

jest.mock("../config", () => ({
    machine: { _cache: { manual: { xy_speed: 2, z_fast_speed: 1 } } },
    opensbp: { _cache: { movea_speed: 1, moveb_speed: 1, movec_speed: 1 } },
}));

var ManualDriver = require("../runtime/manual/driver");
var ManualRuntime = require("../runtime/manual/index").ManualRuntime;

var EventEmitter = require("events").EventEmitter;

function makeG2() {
    var g2 = new EventEmitter();
    return Object.assign(g2, {
        STAT_INTERLOCK: 11,
        STAT_SHUTDOWN: 10,
        STAT_PANIC: 13,
        STAT_ALARM: 12,
        STAT_RUNNING: 5,
        STAT_STOP: 3,
        STAT_END: 4,
        STAT_HOLDING: 6,
        status: { stat: 1, hold: 0, posx: 0, posy: 0, posz: 0 },
        pause_hold: false,
        feedHold: jest.fn(),
        queueFlush: jest.fn(),
        prime: jest.fn(),
        _write: jest.fn(),
    });
}

function makeDriver(g2) {
    return new ManualDriver(g2, { write: jest.fn() });
}

beforeEach(() => {
    jest.useFakeTimers();
});
afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
});

describe("gotoModeHold lifecycle in ManualDriver", () => {
    test("goto sets the flag; it survives the move; STAT_STOP clears it", () => {
        var g2 = makeG2();
        var d = makeDriver(g2);

        d.goto({ X: 1 });
        expect(d.gotoModeHold).toBe(true);

        d._onG2Status({ stat: g2.STAT_RUNNING });
        expect(d.gotoModeHold).toBe(true);

        // Trailing M0 parks the cycle at stat:3 — the goto is over
        d._onG2Status({ stat: g2.STAT_STOP });
        expect(d.gotoModeHold).toBe(false);
    });

    test("STAT_END also clears the flag", () => {
        var g2 = makeG2();
        var d = makeDriver(g2);
        d.gotoModeHold = true;
        d._onG2Status({ stat: g2.STAT_END });
        expect(d.gotoModeHold).toBe(false);
    });

    test("STAT_HOLDING does NOT clear the flag (pause-a-goto must keep working)", () => {
        var g2 = makeG2();
        var d = makeDriver(g2);

        d.goto({ X: 1 });
        d._onG2Status({ stat: g2.STAT_RUNNING });

        // User hits stop mid-goto: feedhold, no flush, flag intact
        d.stopMotion();
        expect(g2.feedHold).toHaveBeenCalled();
        expect(g2.queueFlush).not.toHaveBeenCalled();

        d._onG2Status({ stat: g2.STAT_HOLDING });
        expect(d.gotoModeHold).toBe(true);
    });

    test("a bare stop after a completed goto flushes like a normal jog stop", () => {
        var g2 = makeG2();
        var d = makeDriver(g2);

        d.goto({ X: 1 });
        d._onG2Status({ stat: g2.STAT_RUNNING });
        d._onG2Status({ stat: g2.STAT_STOP }); // goto done

        d.stopMotion(); // stray tap/slide-off/scroll
        expect(g2.feedHold).toHaveBeenCalled();
        expect(g2.queueFlush).toHaveBeenCalled(); // no longer suppressed
    });
});

describe("paused-state decision in ManualRuntime", () => {
    function makeRuntime(helper) {
        var rt = new ManualRuntime();
        rt.machine = {
            status: { state: "manual", stat: 1 },
            setState: jest.fn(),
            emit: jest.fn(),
        };
        rt.helper = helper;
        return rt;
    }

    test("feedhold mid-goto still pauses (resume/quit is correct there)", () => {
        var g2 = makeG2();
        var d = makeDriver(g2);
        var rt = makeRuntime(d);

        d.goto({ X: 1 });
        d._onG2Status({ stat: g2.STAT_RUNNING });
        rt._onG2Status({ stat: g2.STAT_HOLDING, inFeedHold: true });

        expect(rt.machine.setState).toHaveBeenCalledWith(rt, "paused");
    });

    test("REGRESSION: feedhold from a stray stop after a completed goto must not pause", () => {
        var g2 = makeG2();
        var d = makeDriver(g2);
        var rt = makeRuntime(d);

        // The customer sequence: GoTo completes...
        d.goto({ X: 1 });
        d._onG2Status({ stat: g2.STAT_RUNNING });
        d._onG2Status({ stat: g2.STAT_STOP });

        // ...then a bare stop (fixed-mode tap, slide-off, scroll) feedholds
        d.stopMotion();
        rt._onG2Status({ stat: g2.STAT_HOLDING, inFeedHold: true });

        expect(rt.machine.setState).not.toHaveBeenCalledWith(rt, "paused");
    });
});
