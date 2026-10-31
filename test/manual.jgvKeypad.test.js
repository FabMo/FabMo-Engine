/*
 * Keypad continuous jog routed through the firmware velocity-jog cycle.
 *
 * The dashboard keypad/keyboard sends the legacy signed-speed form of
 * cmd:"start" (no ratios). When the capability probe has confirmed CYCLE_JGV
 * (driver.jgv_supported), startMotion translates that form into the analog
 * vector path: jogVelocity setpoints instead of queued G1 segments, stop as
 * a decel ramp instead of feedhold+flush, and the firmware's host-silence
 * watchdog as the deadman. machine.manual.jgv_keypad=false and unsupported
 * firmware both fall back to the legacy G1 path unchanged.
 */
"use strict";

jest.mock("../config", () => ({
    machine: {
        _cache: {
            manual: { xy_speed: 2, z_fast_speed: 1 },
            softlimits_on: false,
            units: "in",
        },
    },
    opensbp: { _cache: { movea_speed: 1, moveb_speed: 1, movec_speed: 1 } },
    driver: { _cache: {} },
}));

var EventEmitter = require("events").EventEmitter;
var config = require("../config");
var ManualDriver = require("../runtime/manual/driver");

function makeG2(jgvSupported) {
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
        jgv_supported: jgvSupported,
        feedHold: jest.fn(),
        queueFlush: jest.fn(),
        discardStreamBacklog: jest.fn(),
        jogVelocity: jest.fn(),
        jogStop: jest.fn(),
        prime: jest.fn(),
        _write: jest.fn(),
    });
}

describe("keypad jog over the firmware velocity-jog cycle", () => {
    beforeEach(() => {
        jest.useFakeTimers();
        global.CLIENT_DISCONNECTED = false;
        delete config.machine._cache.manual.jgv_keypad;
    });
    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    test("single-axis keypad start becomes a jgv setpoint, not G1 segments", () => {
        var drv = makeG2(true);
        var st = { write: jest.fn() };
        var md = new ManualDriver(drv, st);

        md.startMotion("Z", -60);
        expect(drv.jogVelocity).toHaveBeenCalledWith({ z: -60 });
        expect(st.write).not.toHaveBeenCalled(); // no G91/G1 streaming
        expect(md.analogMode).toBe(true);
        expect(md.moving).toBe(true);
    });

    test("keypad diagonal becomes a unit-vector-scaled two-axis setpoint", () => {
        var drv = makeG2(true);
        var md = new ManualDriver(drv, { write: jest.fn() });

        md.startMotion("X", 120, "Y", -120);
        var vec = drv.jogVelocity.mock.calls[0][0];
        expect(vec.x).toBeCloseTo(120 * Math.SQRT1_2, 3);
        expect(vec.y).toBeCloseTo(-120 * Math.SQRT1_2, 3);
    });

    test("release stops with a decel ramp (jogStop), not feedhold+flush", () => {
        var drv = makeG2(true);
        var md = new ManualDriver(drv, { write: jest.fn() });

        md.startMotion("Z", -60);
        md.stopMotion();
        expect(drv.jogStop).toHaveBeenCalled();
        expect(drv.feedHold).not.toHaveBeenCalled();
        expect(drv.queueFlush).not.toHaveBeenCalled();
        expect(md.keep_moving).toBe(false);
    });

    test("rapid direction flips are plain setpoint updates - no stop/restart dance", () => {
        var drv = makeG2(true);
        var md = new ManualDriver(drv, { write: jest.fn() });

        md.startMotion("Z", -60);
        md.startMotion("Z", 60);
        md.startMotion("Z", -60);
        expect(drv.jogVelocity).toHaveBeenCalledTimes(3);
        expect(drv.jogVelocity.mock.calls[1][0]).toEqual({ z: 60 });
        expect(drv.feedHold).not.toHaveBeenCalled();
        expect(drv.queueFlush).not.toHaveBeenCalled();
    });

    test("explicit pendant ratios pass through unchanged", () => {
        var drv = makeG2(true);
        var md = new ManualDriver(drv, { write: jest.fn() });

        md.startMotion("X", 100, null, 0, 0.6, 0);
        expect(drv.jogVelocity).toHaveBeenCalledWith({ x: 60 });
    });

    test("unsupported firmware falls back to legacy G1 streaming", () => {
        var drv = makeG2(false);
        var st = { write: jest.fn() };
        var md = new ManualDriver(drv, st);

        md.startMotion("Z", -60);
        expect(drv.jogVelocity).not.toHaveBeenCalled();
        expect(st.write).toHaveBeenCalled(); // G91 F header + segments
        expect(md.analogMode).toBeFalsy();
    });

    test("machine.manual.jgv_keypad=false forces the legacy path", () => {
        config.machine._cache.manual.jgv_keypad = false;
        var drv = makeG2(true);
        var st = { write: jest.fn() };
        var md = new ManualDriver(drv, st);

        md.startMotion("Z", -60);
        expect(drv.jogVelocity).not.toHaveBeenCalled();
        expect(st.write).toHaveBeenCalled();
    });

    test("cmd:maint refreshes the firmware watchdog with the last vector", () => {
        var drv = makeG2(true);
        var md = new ManualDriver(drv, { write: jest.fn() });

        md.startMotion("Z", -60);
        drv.jogVelocity.mockClear();
        md.maintainMotion();
        expect(drv.jogVelocity).toHaveBeenCalledWith({ z: -60 });
    });

    test("keypad-close during a jgv jog exits once the ramp-down completes", () => {
        var drv = makeG2(true);
        var st = { write: jest.fn() };
        var md = new ManualDriver(drv, st);

        md.startMotion("Z", -60);
        md.exit(); // modal closed mid-jog
        expect(md.exit_pending).toBe(true);
        expect(drv.jogStop).toHaveBeenCalled();
        expect(md.exiting).toBe(false); // deferred until the cycle ends

        drv.emit("jogv_exit"); // firmware finished ramping to zero
        expect(md.exiting).toBe(true);
        expect(md.analogMode).toBe(false);
    });
});
