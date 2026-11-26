/*
 * Simulation service: file simulation (preview g-code, bounds scan) runs in a
 * child process so a large file cannot hold up the engine.
 */
"use strict";

var sim = require("../runtime/sim_service");

afterAll(function () {
    sim.shutdown();
});

describe("simulation service", function () {
    jest.setTimeout(60000);

    var GCODE = "G0 Z0.2\nG0 X1 Y1\nG1 Z-0.5\nG1 X5 Y1\nG0 Z0.2\nG0 X0 Y0\n";

    test("scans bounds in the child process", function (done) {
        sim.simulate({ kind: "gcode", code: GCODE, want: { bounds: true } }, function (err, result) {
            expect(err).toBeFalsy();
            expect(result.bounds.max.x).toBe(5);
            expect(result.bounds.z).toEqual({ cut: -0.5, travel: 0.2 });
            expect(result.gcode).toBeUndefined();
            done();
        });
    });

    test("returns the g-code when asked", function (done) {
        sim.simulate({ kind: "gcode", code: GCODE, want: { gcode: true } }, function (err, result) {
            expect(err).toBeFalsy();
            expect(result.gcode).toBe(GCODE);
            expect(result.bounds).toBeUndefined();
            done();
        });
    });

    test("answers every request when several arrive at once", function (done) {
        var seen = [];
        [1, 2, 3, 4].forEach(function (n) {
            sim.simulate({ kind: "gcode", code: "G1 X" + n + "\n", want: { bounds: true } }, function (err, result) {
                expect(err).toBeFalsy();
                seen.push(result.bounds.max.x);
                if (seen.length === 4) {
                    expect(seen).toEqual([1, 2, 3, 4]);
                    done();
                }
            });
        });
    });

    test("a file that cannot be read is an error, not a hang", function (done) {
        sim.simulate({ kind: "gcode", file: "/nonexistent/nope.nc", want: { bounds: true } }, function (err) {
            expect(err).toBeTruthy();
            done();
        });
    });

    test("the in-process path gives the same answer as the child", function (done) {
        sim.simulateLocal({ kind: "gcode", code: GCODE, want: { bounds: true } }, function (err, local) {
            sim.simulate({ kind: "gcode", code: GCODE, want: { bounds: true } }, function (err2, remote) {
                expect(remote.bounds.min).toEqual(local.bounds.min);
                expect(remote.bounds.max).toEqual(local.bounds.max);
                expect(remote.bounds.z).toEqual(local.bounds.z);
                done();
            });
        });
    });
});
