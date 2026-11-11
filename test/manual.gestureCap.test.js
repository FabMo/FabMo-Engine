/*
 * Per-gesture travel cap + gesture-ending log on the manual jog path.
 *
 * The motion lease only catches a client that goes QUIET. A browser that
 * missed a release but stays focused keeps heartbeating, so the lease (and
 * the firmware watchdog) see a live operator forever. The travel cap is the
 * backstop for that client: a single heading may not accrue more commanded
 * travel than 1.5x the longest involved axis span (never before 15s; a plain
 * 120s time cap when the axis has no envelope span). Once tripped, the
 * heading is latched off until the client sends a real stop or steers.
 *
 * Every gesture ending is also recorded by reason, so the diagnostic bundle
 * shows which backstops are firing in the field.
 */
"use strict";

jest.mock("../config", () => ({
    machine: {
        _cache: {
            manual: { xy_speed: 2, z_fast_speed: 1 },
            softlimits_on: false,
            envelope: { xmin: 0, xmax: 24, ymin: 0, ymax: 18, zmin: -2, zmax: 6 },
        },
    },
    opensbp: { _cache: { movea_speed: 1, moveb_speed: 1, movec_speed: 1 } },
    driver: { _cache: {} },
    getDataDir: () => require("os").tmpdir(),
}));

var EventEmitter = require("events").EventEmitter;
var config = require("../config");
var ManualDriver = require("../runtime/manual/driver");
var gestureLog = require("../runtime/manual/gesture_log");

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

// Hold a heading the way the dashboard does: a start every 50ms.
function hold(md, ms, args) {
    for (var t = 0; t < ms; t += 50) {
        md.startMotion.apply(md, args);
        jest.advanceTimersByTime(50);
    }
}

describe("manual gesture travel cap", () => {
    var drv, st, md;
    beforeEach(() => {
        jest.useFakeTimers();
        global.CLIENT_DISCONNECTED = false;
        delete config.machine._cache.manual.gesture_cap;
        gestureLog._reset();
        drv = makeG2();
        st = { write: jest.fn() };
        md = new ManualDriver(drv, st);
    });
    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    test("a hold shorter than the axis is never capped", () => {
        // X span 24; 60 units/min = 1/s. 20s = 20 units of travel (< 36).
        hold(md, 20000, ["X", 60]);
        expect(drv.feedHold).not.toHaveBeenCalled();
        expect(md.moving).toBe(true);
        expect(gestureLog.counts().travel_cap).toBeUndefined();
    });

    test("a wedged client that keeps heartbeating is stopped past 1.5x the axis span", () => {
        // 36 units at 1/s -> trips just after 36s.
        hold(md, 35000, ["X", 60]);
        expect(drv.feedHold).not.toHaveBeenCalled();
        hold(md, 2000, ["X", 60]);
        expect(drv.feedHold).toHaveBeenCalledTimes(1);
        expect(gestureLog.counts().travel_cap).toBe(1);
        var rec = gestureLog.recent()[0];
        expect(rec.reason).toBe("travel_cap");
        expect(rec.axis).toBe("X");
    });

    test("after the cap, the same heading stays dead until the client releases", () => {
        hold(md, 38000, ["X", 60]);
        expect(drv.feedHold).toHaveBeenCalledTimes(1);
        var writes = st.write.mock.calls.length;
        md.stop_pending = false; // the stop has completed
        md.moving = false;
        hold(md, 3000, ["X", 60]); // wedged client still streaming
        expect(st.write.mock.calls.length).toBe(writes); // nothing re-primed
        expect(md.moving).toBe(false);

        md.stopMotion("client:release", "keypad"); // operator finally lets go
        md.stop_pending = false;
        md.startMotion("X", 60); // and presses again
        expect(md.moving).toBe(true);
        expect(st.write.mock.calls.length).toBeGreaterThan(writes);
    });

    test("a different heading releases the latch (a deliberate act)", () => {
        hold(md, 38000, ["X", 60]);
        md.stop_pending = false;
        md.moving = false;
        md.startMotion("X", -60);
        expect(md.moving).toBe(true);
    });

    test("fast moves are not capped before the minimum hold time", () => {
        // 600 units/min = 10/s: 36 units of travel in 3.6s, but floor is 15s.
        hold(md, 14000, ["X", 600]);
        expect(drv.feedHold).not.toHaveBeenCalled();
        hold(md, 1500, ["X", 600]);
        expect(drv.feedHold).toHaveBeenCalledTimes(1);
    });

    test("axes without an envelope span fall back to a time cap", () => {
        hold(md, 119000, ["A", 600]);
        expect(drv.feedHold).not.toHaveBeenCalled();
        hold(md, 2000, ["A", 600]);
        expect(drv.feedHold).toHaveBeenCalledTimes(1);
        expect(gestureLog.counts().travel_cap).toBe(1);
    });

    test("machine.manual.gesture_cap = false disables the cap", () => {
        config.machine._cache.manual.gesture_cap = false;
        hold(md, 60000, ["X", 60]);
        expect(drv.feedHold).not.toHaveBeenCalled();
        expect(md.moving).toBe(true);
    });

    test("separate gestures do not accumulate toward the cap", () => {
        for (var i = 0; i < 6; i++) {
            hold(md, 10000, ["X", 60]);
            md.stopMotion("client:release", "keyboard");
            md.stop_pending = false;
            md.moving = false;
            drv.feedHold.mockClear();
        }
        hold(md, 10000, ["X", 60]);
        expect(drv.feedHold).not.toHaveBeenCalled();
        expect(gestureLog.counts().travel_cap).toBeUndefined();
        expect(gestureLog.counts()["client:release"]).toBe(6);
    });
});

describe("manual gesture-ending log", () => {
    var drv, st, md;
    beforeEach(() => {
        jest.useFakeTimers();
        global.CLIENT_DISCONNECTED = false;
        gestureLog._reset();
        drv = makeG2();
        st = { write: jest.fn() };
        md = new ManualDriver(drv, st);
    });
    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    test("a normal release is counted but not recorded as an anomaly", () => {
        md.startMotion("X", 60);
        md.stopMotion(gestureLog.clientReason("release"), "keypad");
        expect(gestureLog.counts()["client:release"]).toBe(1);
        expect(gestureLog.recent()).toHaveLength(0);
    });

    test("a client backstop reason is recorded with its source and browser", () => {
        gestureLog.noteClient("TestBrowser/1.0", "10.0.0.5");
        md.startMotion("X", 60);
        md.stopMotion(gestureLog.clientReason("buttons_up"), gestureLog.cleanSource("keypad"));
        var rec = gestureLog.recent()[0];
        expect(rec.reason).toBe("client:buttons_up");
        expect(rec.source).toBe("keypad");
        expect(rec.ua).toBe("TestBrowser/1.0");
        expect(gestureLog.summary()).toMatch(/! client:buttons_up: 1/);
    });

    test("a stop with no live gesture records nothing", () => {
        md.stopMotion(gestureLog.clientReason("window_blur"));
        expect(gestureLog.counts()).toEqual({});
    });

    test("lease expiry is recorded as its own reason", () => {
        md.startMotion("X", 60);
        jest.advanceTimersByTime(1000); // no keep-alives
        expect(gestureLog.counts().lease_expired).toBe(1);
    });

    test("client-supplied reasons are sanitized and namespaced", () => {
        expect(gestureLog.clientReason("travel_cap")).toBe("client:travel_cap");
        expect(gestureLog.clientReason('x"}\n{evil')).toBe("client:xevil");
        expect(gestureLog.clientReason(undefined)).toBe("client:stop");
        expect(gestureLog.clientReason(function () {})).toBe("client:stop");
    });
});
