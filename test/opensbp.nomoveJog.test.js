/*
 * No-move guard for modal multi-axis jogs and moves (J2–J6 / M2–M6).
 *
 * J5,,,,0,0 with A and B already at 0 must emit nothing: the old guard
 * compared cmd_result against the command's full axis count (5), which a
 * partial-axis call can never reach, so a literal zero-length G0 went to
 * G2 — which can wedge g2core in stat 5 right after a PAUSE resume (the
 * C6-then-no-move hang, Oct 2026).
 */
"use strict";

var jog = require("../runtime/opensbp/commands/jog");
var move = require("../runtime/opensbp/commands/move");

// Minimal runtime stub: just commanded-position state and an emit recorder.
function makeRuntime(pos) {
    var emitted = [];
    return {
        cmd_posx: pos.x || 0,
        cmd_posy: pos.y || 0,
        cmd_posz: pos.z || 0,
        cmd_posa: pos.a || 0,
        cmd_posb: pos.b || 0,
        cmd_posc: pos.c || 0,
        movespeed_xy: 1,
        movespeed_z: 1,
        movespeed_a: 1,
        movespeed_b: 1,
        movespeed_c: 1,
        absoluteMode: true,
        emit_move: function (code, pt) {
            emitted.push({ code: code, pt: pt });
        },
        emitted: emitted,
    };
}

describe("modal jog no-move guard", function () {
    test("J5,,,,0,0 with A/B already at 0 emits nothing", function () {
        var rt = makeRuntime({ a: 0, b: 0 });
        jog.J5.call(rt, [undefined, undefined, undefined, 0, 0]);
        expect(rt.emitted).toEqual([]);
    });

    test("J5,,,,0,0 with A off target still jogs", function () {
        var rt = makeRuntime({ a: 90, b: 0 });
        jog.J5.call(rt, [undefined, undefined, undefined, 0, 0]);
        expect(rt.emitted.length).toBe(1);
        expect(rt.emitted[0].code).toBe("G0");
        expect(rt.emitted[0].pt).toEqual({ A: 0, B: 0 });
    });

    test("J2 to current XY emits nothing", function () {
        var rt = makeRuntime({ x: 1.5, y: 2.5 });
        jog.J2.call(rt, [1.5, 2.5]);
        expect(rt.emitted).toEqual([]);
    });

    test("J2 with one axis off target jogs both specified axes", function () {
        var rt = makeRuntime({ x: 1.5, y: 2.5 });
        jog.J2.call(rt, [1.5, 3.0]);
        expect(rt.emitted.length).toBe(1);
        expect(rt.emitted[0].pt).toEqual({ X: 1.5, Y: 3.0 });
    });

    test("J3 with only Z specified and at target emits nothing", function () {
        var rt = makeRuntime({ z: 0.75 });
        jog.J3.call(rt, [undefined, undefined, 0.75]);
        expect(rt.emitted).toEqual([]);
    });
});

describe("modal move no-move guard", function () {
    test("M5,,,,0,0 with A/B already at 0 emits nothing", function () {
        var rt = makeRuntime({ a: 0, b: 0 });
        move.M5.call(rt, [undefined, undefined, undefined, 0, 0]);
        expect(rt.emitted).toEqual([]);
    });

    test("M2 with an axis off target emits a G1 with feedrate", function () {
        var rt = makeRuntime({ x: 0, y: 0 });
        move.M2.call(rt, [4, 0]);
        expect(rt.emitted.length).toBe(1);
        expect(rt.emitted[0].code).toBe("G1");
        expect(rt.emitted[0].pt.X).toBe(4);
        expect(rt.emitted[0].pt.F).toBe(60); // movespeed_xy 1 * 60
    });

    test("M3 to current XYZ emits nothing", function () {
        var rt = makeRuntime({ x: 1, y: 2, z: 3 });
        move.M3.call(rt, [1, 2, 3]);
        expect(rt.emitted).toEqual([]);
    });
});
