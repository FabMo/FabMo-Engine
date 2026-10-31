/*
 * Motion lease on the legacy (G1 segment-renewal) manual jog path.
 *
 * The renewal loop used to self-sustain: once keep_moving was set, segments
 * kept queuing every T_RENEW forever unless an affirmative stop arrived.
 * Every lost client event (blur, rollover, wedged tab) therefore became a
 * runaway. Under the lease, each renewal tick CONSUMES keep_moving and the
 * client's existing ~50ms command stream (startMotion / maintainMotion) must
 * re-assert it; one grace window (2 x T_RENEW total) absorbs jitter, then
 * motion stops. Absence of intent = stop.
 *
 * The analog (jgv) path is not covered here — its lease is the firmware
 * watchdog ($jvto).
 */
"use strict";

jest.mock("../config", () => ({
    machine: { _cache: { manual: { xy_speed: 2, z_fast_speed: 1 }, softlimits_on: false } },
    opensbp: { _cache: { movea_speed: 1, moveb_speed: 1, movec_speed: 1 } },
    driver: { _cache: {} },
}));

var EventEmitter = require("events").EventEmitter;
var config = require("../config");
var ManualDriver = require("../runtime/manual/driver");

var T_RENEW = 300; // mirror of driver.js

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

describe("manual motion lease (legacy G1 path)", () => {
    beforeEach(() => {
        jest.useFakeTimers();
        global.CLIENT_DISCONNECTED = false;
        delete config.machine._cache.manual.motion_lease;
    });
    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    test("client keep-alives sustain motion indefinitely", () => {
        var drv = makeG2();
        var st = { write: jest.fn() };
        var md = new ManualDriver(drv, st);

        md.startMotion("X", 60);
        for (var i = 0; i < 10; i++) {
            md.startMotion("X", 60); // the dashboard's 50ms "go" stream (deduped in-place)
            jest.advanceTimersByTime(T_RENEW);
        }
        expect(drv.feedHold).not.toHaveBeenCalled();
        expect(st.write.mock.calls.length).toBeGreaterThan(10); // segments kept flowing
        expect(md.moving).toBe(true);
    });

    test("a silently dead client stops motion after one grace window", () => {
        var drv = makeG2();
        var st = { write: jest.fn() };
        var md = new ManualDriver(drv, st);

        md.startMotion("X", 60); // consumed by the "start" renewal immediately
        var writesAfterStart = st.write.mock.calls.length;

        jest.advanceTimersByTime(T_RENEW); // miss 1: grace, queues nothing
        expect(drv.feedHold).not.toHaveBeenCalled();
        expect(st.write.mock.calls.length).toBe(writesAfterStart);

        jest.advanceTimersByTime(T_RENEW); // miss 2: lease expired
        expect(drv.feedHold).toHaveBeenCalled();
        expect(drv.queueFlush).toHaveBeenCalled();
        expect(md.keep_moving).toBe(false);
    });

    test("maintainMotion (cmd:maint) counts as a keep-alive", () => {
        var drv = makeG2();
        var st = { write: jest.fn() };
        var md = new ManualDriver(drv, st);

        md.startMotion("X", 60);
        for (var i = 0; i < 5; i++) {
            md.maintainMotion();
            jest.advanceTimersByTime(T_RENEW);
        }
        expect(drv.feedHold).not.toHaveBeenCalled();

        // ...and silence still stops it afterwards
        jest.advanceTimersByTime(2 * T_RENEW);
        expect(drv.feedHold).toHaveBeenCalled();
    });

    test("axis change between keep-alives is honored, not misread as a lease miss", () => {
        var drv = makeG2();
        var st = { write: jest.fn() };
        var md = new ManualDriver(drv, st);

        md.startMotion("X", 60);
        jest.advanceTimersByTime(T_RENEW); // consumes the lease (grace tick)
        st.write.mockClear();

        md.startMotion("Y", 60); // axis change: restart path
        expect(drv.feedHold).not.toHaveBeenCalled();
        expect(st.write).toHaveBeenCalled(); // fresh header + segments for Y
        expect(md.currentAxis).toBe("Y");
        // The restart's own keep-alive is consumed by the renewal it triggers;
        // what matters is the loop stayed armed for the next keep-alive.
        expect(md.renew_timer).not.toBeNull();
        expect(md.moving).toBe(true);

        // Keep-alives on the new axis sustain it...
        md.startMotion("Y", 60);
        jest.advanceTimersByTime(T_RENEW);
        expect(drv.feedHold).not.toHaveBeenCalled();
        // ...and silence still stops it.
        jest.advanceTimersByTime(2 * T_RENEW);
        expect(drv.feedHold).toHaveBeenCalled();
    });

    test("an input feedhold pauses the lease instead of tripping it", () => {
        var drv = makeG2();
        var st = { write: jest.fn() };
        var md = new ManualDriver(drv, st);

        md.startMotion("X", 60);
        drv.pause_flag = true; // limit input fired mid-jog

        // Held for many windows with NO keep-alives: lease must not feedhold
        // into the hold (nothing is executing; stop would fight hold logic).
        jest.advanceTimersByTime(6 * T_RENEW);
        expect(drv.feedHold).not.toHaveBeenCalled();
        expect(md.renew_timer).not.toBeNull(); // loop stays armed

        // Hold releases with the client still gone: lease stops motion.
        drv.pause_flag = false;
        jest.advanceTimersByTime(2 * T_RENEW);
        expect(drv.feedHold).toHaveBeenCalled();
    });

    test("hold + live client: motion resumes after the hold and keeps renewing", () => {
        var drv = makeG2();
        var st = { write: jest.fn() };
        var md = new ManualDriver(drv, st);

        md.startMotion("X", 60);
        drv.pause_flag = true;
        for (var i = 0; i < 3; i++) {
            md.startMotion("X", 60); // user still holding the key through the hold
            jest.advanceTimersByTime(T_RENEW);
        }
        st.write.mockClear();

        drv.pause_flag = false;
        md.startMotion("X", 60);
        jest.advanceTimersByTime(T_RENEW);
        expect(st.write).toHaveBeenCalled(); // segments flowing again
        expect(drv.feedHold).not.toHaveBeenCalled();
    });

    test("machine.manual.motion_lease=false restores self-sustained renewal", () => {
        config.machine._cache.manual.motion_lease = false;
        var drv = makeG2();
        var st = { write: jest.fn() };
        var md = new ManualDriver(drv, st);

        md.startMotion("X", 60);
        jest.advanceTimersByTime(10 * T_RENEW); // no keep-alives at all
        expect(drv.feedHold).not.toHaveBeenCalled();
        expect(md.keep_moving).toBe(true); // legacy latch behavior
    });
});
