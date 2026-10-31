/*
 * Golden wire-protocol tests: the exact bytes the manual driver sends to the
 * RTOS. Deliberately brittle — the point is that any change to what we write
 * to G2 (headers, segment shapes, path-control modes, per-session config)
 * shows up as a conscious test diff, never as a side effect of a refactor.
 * If you changed the protocol ON PURPOSE, update the literals here and say
 * so in the commit message.
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
        status: { stat: 3, hold: 0, posx: 0, posy: 0, posz: 0 },
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

function capture(jgv) {
    var drv = makeG2(jgv);
    var writes = [];
    var md = new ManualDriver(drv, {
        write: function (s) {
            writes.push(s);
        },
    });
    return { md: md, drv: drv, writes: writes };
}

describe("manual-drive wire protocol (golden)", () => {
    beforeEach(() => {
        jest.useFakeTimers();
        global.CLIENT_DISCONNECTED = false;
    });
    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    test("continuous start: incremental header + G61 + one renewal batch of 10 segments", () => {
        var c = capture(false);
        c.md.startMotion("X", 60);
        // 60 units/min for T_RENEW=300ms at safety factor 4 => 1.2 units
        // queued ahead, in 10 exact segments.
        expect(c.writes).toEqual([
            "G91 F60.000\nG61\n",
            "G1X0.1200\n".repeat(10),
        ]);
    });

    test("negative direction flips segment sign, not the feedrate", () => {
        var c = capture(false);
        c.md.startMotion("Z", -30);
        expect(c.writes).toEqual([
            "G91 F30.000\nG61\n",
            "G1Z-0.0600\n".repeat(10),
        ]);
    });

    test("fixed nudge: exact-stop mode + one exact-distance feed move", () => {
        var c = capture(false);
        c.md.nudge("Z", 60, -0.1);
        expect(c.writes).toEqual(["G91 G61.1\n", "G1 Z-0.10000 F60.000\n"]);
    });

    test("manual enter (jgv firmware): session jerk setup, spph off, watchdog pin, prod move", () => {
        var c = capture(true);
        c.md.enter();
        expect(c.writes).toEqual([
            "{xjm:100}\n",
            "{yjm:100}\n",
            "{zjm:100}\n",
            "{ajm:50}\n",
            "{bjm:50}\n",
            "{cjm:50}\n",
            "{spph:false}\n",
            "{jvto:500}\n",
            "M0\nG91\n G0 X0 Y0 Z0\n",
        ]);
    });

    test("manual enter (legacy firmware): identical except no watchdog pin", () => {
        var c = capture(false);
        c.md.enter();
        expect(c.writes).toEqual([
            "{xjm:100}\n",
            "{yjm:100}\n",
            "{zjm:100}\n",
            "{ajm:50}\n",
            "{bjm:50}\n",
            "{cjm:50}\n",
            "{spph:false}\n",
            "M0\nG91\n G0 X0 Y0 Z0\n",
        ]);
    });

    test("keypad jog on jgv firmware writes NOTHING to the gcode stream", () => {
        var c = capture(true);
        c.md.startMotion("Z", -60);
        expect(c.writes).toEqual([]);
        expect(c.drv.jogVelocity).toHaveBeenCalledWith({ z: -60 });
    });
});
