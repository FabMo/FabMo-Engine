/*
 * Keep-out zone checking (runtime/bounds.js): path collection in the gcode
 * scanner and checkAgainstZones geometry — segment-accurate hits, Z gating,
 * and the bounding-box fallback for jobs with no stored path.
 */
"use strict";

var bounds = require("../runtime/bounds");

describe("scanGCodeBounds path collection", function () {
    test("collects move endpoints", function () {
        var b = bounds.scanGCodeBounds("G0 X1 Y1\nG1 X5 Y1\nG1 X5 Y5\n");
        expect(b.path[0]).toEqual([0, 0, 0]);
        expect(b.path).toContainEqual([1, 1, 0]);
        expect(b.path).toContainEqual([5, 1, 0]);
        expect(b.path[b.path.length - 1]).toEqual([5, 5, 0]);
    });

    test("samples arc sweeps so the path follows the curve", function () {
        // Half circle from (0,0) to (10,0), center (5,0). G3 (CCW) sweeps
        // from angle pi to 2pi — through the bottom at (5,-5).
        var b = bounds.scanGCodeBounds("G0 X0 Y0\nG3 X10 Y0 I5 J0\n");
        var bottomish = b.path.some(function (p) {
            return p[1] < -4.5 && p[0] > 3 && p[0] < 7;
        });
        expect(bottomish).toBe(true);
    });

    test("decimates long paths below the cap", function () {
        var lines = [];
        for (var i = 0; i < 5000; i++) lines.push("G1 X" + (i * 0.01).toFixed(3) + " Y0");
        var b = bounds.scanGCodeBounds(lines.join("\n"));
        expect(b.path.length).toBeLessThanOrEqual(600);
        // Endpoints survive decimation
        expect(b.path[0]).toEqual([0, 0, 0]);
        expect(b.path[b.path.length - 1][0]).toBeCloseTo(49.99, 1);
    });
});

describe("checkAgainstZones", function () {
    var rectZone = { id: "clamp1", type: "rect", x0: 10, y0: 10, x1: 20, y1: 20 };
    var polyZone = { id: "blob", type: "poly", pts: [[30, 10], [40, 10], [35, 20]] };

    function job(path) {
        var min = { x: Infinity, y: Infinity, z: Infinity };
        var max = { x: -Infinity, y: -Infinity, z: -Infinity };
        path.forEach(function (p) {
            min.x = Math.min(min.x, p[0]); max.x = Math.max(max.x, p[0]);
            min.y = Math.min(min.y, p[1]); max.y = Math.max(max.y, p[1]);
            min.z = Math.min(min.z, p[2]); max.z = Math.max(max.z, p[2]);
        });
        return { min: min, max: max, path: path };
    }

    test("no zones → no hit", function () {
        var r = bounds.checkAgainstZones(job([[0, 0, 0], [50, 50, 0]]), [], {});
        expect(r.enters).toBe(false);
    });

    test("segment crossing a rect zone is a hit even with endpoints outside", function () {
        var r = bounds.checkAgainstZones(job([[0, 15, 0], [50, 15, 0]]), [rectZone], {});
        expect(r.enters).toBe(true);
        expect(r.zones).toEqual(["clamp1"]);
        expect(r.approximate).toBe(false);
    });

    test("path whose bbox overlaps but geometry avoids the zone is clean", function () {
        // L-shaped path around the zone: bbox covers it, path never touches
        var r = bounds.checkAgainstZones(job([[0, 0, 0], [50, 0, 0], [50, 50, 0]]), [rectZone], {});
        expect(r.enters).toBe(false);
    });

    test("endpoint inside a polygon zone is a hit", function () {
        var r = bounds.checkAgainstZones(job([[0, 0, 0], [35, 13, 0]]), [polyZone], {});
        expect(r.enters).toBe(true);
        expect(r.zones).toEqual(["blob"]);
    });

    test("g55 offset shifts work coords into the zone", function () {
        // Path at work (0..5, 0..5); zone at machine 10..20 — only hits with offset
        var p = job([[0, 5, 0], [5, 5, 0]]);
        expect(bounds.checkAgainstZones(p, [rectZone], { x: 0, y: 0 }).enters).toBe(false);
        expect(bounds.checkAgainstZones(p, [rectZone], { x: 12, y: 10 }).enters).toBe(true);
    });

    test("zone height clears moves that stay above it", function () {
        var tall = { id: "clamp2", type: "rect", x0: 10, y0: 10, x1: 20, y1: 20, z: 2 };
        var over = job([[0, 15, 3], [50, 15, 3]]);   // jog at Z3 over a 2in clamp
        var thru = job([[0, 15, 0.5], [50, 15, 0.5]]);
        var g55 = { x: 0, y: 0, z: -0.001 }; // zeroed (nonzero g55z)
        expect(bounds.checkAgainstZones(over, [tall], g55).enters).toBe(false);
        expect(bounds.checkAgainstZones(thru, [tall], g55).enters).toBe(true);
        // Z never zeroed (g55z exactly 0) → conservative: check anyway
        expect(bounds.checkAgainstZones(over, [tall], { x: 0, y: 0, z: 0 }).enters).toBe(true);
    });

    test("legacy job with no path falls back to bbox overlap, flagged approximate", function () {
        var legacy = { min: { x: 0, y: 0, z: 0 }, max: { x: 50, y: 50, z: 0 } };
        var r = bounds.checkAgainstZones(legacy, [rectZone], {});
        expect(r.enters).toBe(true);
        expect(r.approximate).toBe(true);
    });

    test("multiple zones each reported once", function () {
        var r = bounds.checkAgainstZones(
            job([[0, 15, 0], [50, 15, 0], [35, 13, 0]]),
            [rectZone, polyZone],
            {}
        );
        expect(r.zones.sort()).toEqual(["blob", "clamp1"]);
    });
});
