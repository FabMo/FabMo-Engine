/*
 * Cycle-context lifecycle at run start (the "[file]@line-1: Cannot create a
 * new cycle context. One already exists." bug).
 *
 * A cycle context is only torn down when g2core reports stat:4 (END). A
 * trailing M30 that g2core swallows while parked at stat:3 (the documented
 * quirk G2.sendM30 exists for) leaves the context alive forever; the next
 * run then throws at context creation — surfaced by the SBP runtime as an
 * error "@line-1" before the file even starts.
 *
 * Two fixes under test:
 *  - g2.js: _createCycleContext reclaims a stale context when the machine
 *    is parked (stat 1/3/4, no hold, no quit pending) instead of throwing.
 *  - opensbp.js: the EOF path delivers its M30 via driver.sendM30() (the
 *    direct, quirk-aware path the gcode runtime uses) instead of streaming
 *    it into the vulnerable window.
 */
"use strict";

var g2 = require("../g2");

function makeDriver() {
    var d = new g2.G2();
    d.status.stat = g2.STAT_STOP; // parked, as after a completed file
    return d;
}

describe("G2._createCycleContext stale-context handling", () => {
    test("creates a context normally when none exists", () => {
        var d = makeDriver();
        d._createCycleContext();
        expect(d.context).not.toBeNull();
    });

    test("reclaims a stale context when parked at stat:3", () => {
        var d = makeDriver();
        d._createCycleContext();
        var stale = d.context;
        // Simulate the swallowed-M30 aftermath: machine parked, context never torn down
        d.status.stat = g2.STAT_STOP;
        expect(() => d._createCycleContext()).not.toThrow();
        expect(d.context).not.toBe(stale);
        expect(d.context).not.toBeNull();
    });

    test.each([
        ["STAT_READY", 1],
        ["STAT_END", 4],
    ])("also reclaims when parked at %s", (_name, stat) => {
        var d = makeDriver();
        d._createCycleContext();
        d.status.stat = stat;
        expect(() => d._createCycleContext()).not.toThrow();
        expect(d.context).not.toBeNull();
    });

    test("still throws when a cycle is actually running", () => {
        var d = makeDriver();
        d._createCycleContext();
        d.status.stat = g2.STAT_RUNNING;
        expect(() => d._createCycleContext()).toThrow(/already exists/);
    });

    test("still throws when holding (paused job must not be stomped)", () => {
        var d = makeDriver();
        d._createCycleContext();
        d.status.stat = g2.STAT_HOLDING;
        expect(() => d._createCycleContext()).toThrow(/already exists/);
        // ...including a feedhold the status hasn't caught up with yet
        d.status.stat = g2.STAT_STOP;
        d.pause_flag = true;
        expect(() => d._createCycleContext()).toThrow(/already exists/);
    });

    test("still throws while a quit is pending", () => {
        var d = makeDriver();
        d._createCycleContext();
        d.status.stat = g2.STAT_STOP;
        d.quit_pending = true;
        expect(() => d._createCycleContext()).toThrow(/already exists/);
    });
});

describe("SBP runtime EOF delivers M30 via sendM30, not the stream", () => {
    var SBPRuntime = require("../runtime/opensbp/opensbp").SBPRuntime;
    var config = require("../config");

    test("EOF path calls driver.sendM30() and does not stream an M30", () => {
        config.opensbp = config.opensbp || {};
        config.opensbp._cache = config.opensbp._cache || { variables: {}, tempVariables: {} };

        var rt = new SBPRuntime();
        rt.driver = {
            prime: jest.fn(),
            sendM30: jest.fn(),
        };
        rt.machine = {
            status: { job: null, line: 0, nb_lines: 0 },
            setState: jest.fn(),
            restoreDriverState: function (cb) { cb(null); },
        };
        rt.emit_gcode = jest.fn();

        // Arrange: a started top-level program whose pc has run off the end
        rt.started = true;
        rt.program = [];
        rt.pc = 0;
        rt.file_stack = [];
        rt.pending_error = null;
        rt.end_message = null;
        rt.paused = false;
        rt.feedhold = false;
        rt.gcodesPending = false;
        rt.probingPending = false;
        rt.quit_pending = false;

        rt._executeNext();

        expect(rt.driver.sendM30).toHaveBeenCalledTimes(1);
        // The old (vulnerable) path streamed the M30 via emit_gcode
        expect(rt.emit_gcode).not.toHaveBeenCalled();
        // _end must still have run its course to idle
        expect(rt.machine.setState).toHaveBeenCalledWith(rt, "idle");
    });
});
