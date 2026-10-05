/*
 * Keep-out jog rerouting: the visibility-graph planner
 * (runtime/keepout_router.js) and its integration with the OpenSBP
 * runtime's emit_move (jogs detour, cuts run as written).
 */
"use strict";

var router = require("../runtime/keepout_router");
var bounds = require("../runtime/bounds");
var config = require("../config");
var SBPRuntime = require("../runtime/opensbp/opensbp").SBPRuntime;

var ENV = { xmin: 0, xmax: 96, ymin: 0, ymax: 48, zmin: -2, zmax: 8 };
var G55 = { x: 0, y: 0, z: 0 };
var RECT = { id: "clamp", type: "rect", x0: 40, y0: 10, x1: 56, y1: 30 };

function pathClearOf(points, zones) {
    for (var i = 1; i < points.length; i++) {
        var a = points[i - 1], b = points[i];
        var hit = zones.some(function (z) {
            return bounds.segmentHitsZone(z, a.x, a.y, b.x, b.y);
        });
        if (hit) return false;
    }
    return true;
}

describe("planJog", function () {
    test("straight jog clear of zones needs no detour", function () {
        var r = router.planJog({ x: 0, y: 40, z: 1 }, { x: 96, y: 40, z: 1 }, [RECT], ENV, G55, 0.5);
        expect(r).toBeNull();
    });

    test("jog through a rect detours around it", function () {
        var start = { x: 0, y: 20, z: 1 }, end = { x: 96, y: 20, z: 1 };
        var r = router.planJog(start, end, [RECT], ENV, G55, 0.5);
        expect(r).not.toBeNull();
        expect(r.blocked).toBeUndefined();
        expect(r.zones).toEqual(["clamp"]);
        expect(r.waypoints.length).toBeGreaterThan(0);
        // The detour must actually clear the zone
        var pts = [start].concat(r.waypoints).concat([end]);
        expect(pathClearOf(pts, [RECT])).toBe(true);
    });

    test("endpoint inside a zone is blocked", function () {
        var r = router.planJog({ x: 0, y: 20, z: 1 }, { x: 48, y: 20, z: 1 }, [RECT], ENV, G55, 0.5);
        expect(r.blocked).toBe(true);
        expect(r.zones).toEqual(["clamp"]);
    });

    test("zone spanning the full table height blocks the jog", function () {
        var wall = { id: "wall", type: "rect", x0: 40, y0: -5, x1: 56, y1: 53 };
        var r = router.planJog({ x: 0, y: 20, z: 1 }, { x: 96, y: 20, z: 1 }, [wall], ENV, G55, 0.5);
        expect(r.blocked).toBe(true);
    });

    test("detour around one zone does not cut through a second", function () {
        // Two rects with a gap above the first and below the second —
        // route must thread between or around both
        var z1 = { id: "a", type: "rect", x0: 40, y0: 0, x1: 56, y1: 24 };
        var z2 = { id: "b", type: "rect", x0: 40, y0: 30, x1: 56, y1: 48 };
        var start = { x: 0, y: 12, z: 1 }, end = { x: 96, y: 12, z: 1 };
        var r = router.planJog(start, end, [z1, z2], ENV, G55, 0.5);
        expect(r).not.toBeNull();
        expect(r.blocked).toBeUndefined();
        var pts = [start].concat(r.waypoints).concat([end]);
        expect(pathClearOf(pts, [z1, z2])).toBe(true);
    });

    test("zone with height is cleared by a jog above it", function () {
        var tall = Object.assign({ z: 2 }, RECT);
        var g55 = { x: 0, y: 0, z: -0.001 }; // zeroed
        var r = router.planJog({ x: 0, y: 20, z: 3 }, { x: 96, y: 20, z: 3 }, [tall], ENV, g55, 0.5);
        expect(r).toBeNull();
        // Below the height it must still detour
        var r2 = router.planJog({ x: 0, y: 20, z: 1 }, { x: 96, y: 20, z: 1 }, [tall], ENV, g55, 0.5);
        expect(r2).not.toBeNull();
    });

    test("pure Z jog: up/level is free, plunging into a zone footprint is blocked", function () {
        var tall = Object.assign({ z: 2 }, RECT);
        var g55 = { x: 0, y: 0, z: -0.001 };
        var inside = { x: 48, y: 20 };
        expect(router.planJog(
            { x: inside.x, y: inside.y, z: 1 }, { x: inside.x, y: inside.y, z: 4 }, [tall], ENV, g55, 0.5
        )).toBeNull();
        var down = router.planJog(
            { x: inside.x, y: inside.y, z: 4 }, { x: inside.x, y: inside.y, z: 1 }, [tall], ENV, g55, 0.5
        );
        expect(down.blocked).toBe(true);
    });

    test("polygon zone detours too", function () {
        var tri = { id: "tri", type: "poly", pts: [[44, 5], [60, 20], [44, 35]] };
        var start = { x: 0, y: 20, z: 1 }, end = { x: 96, y: 20, z: 1 };
        var r = router.planJog(start, end, [tri], ENV, G55, 0.5);
        expect(r).not.toBeNull();
        expect(r.blocked).toBeUndefined();
        var pts = [start].concat(r.waypoints).concat([end]);
        expect(pathClearOf(pts, [tri])).toBe(true);
    });
});

describe("emit_move integration", function () {
    var savedMachine, savedDriver;

    function stubConfig(zones) {
        savedMachine = config.machine;
        savedDriver = config.driver;
        config.machine = {
            get: function (key) {
                if (key === "keepout") return { zones: zones };
                if (key === "envelope") return ENV;
                if (key === "units") return "in";
                return undefined;
            },
        };
        config.driver = {
            get: function (key) {
                return { g55x: 0, g55y: 0, g55z: -0.001 }[key] || 0;
            },
        };
    }

    afterEach(function () {
        config.machine = savedMachine;
        config.driver = savedDriver;
    });

    function captureRuntime() {
        var rt = new SBPRuntime();
        rt.transforms = {
            rotate: { apply: false },
            shearx: { apply: false },
            sheary: { apply: false },
            scale: { apply: false },
            move: { apply: false },
            level: { apply: false },
            interpolate: { apply: false },
        };
        rt.cmd_posx = 0;
        rt.cmd_posy = 20;
        rt.cmd_posz = 1;
        rt.emitted = [];
        rt.emit_gcode = function (s) {
            rt.emitted.push(s);
        };
        return rt;
    }

    test("a jog through a zone emits detour waypoints", function () {
        stubConfig([RECT]);
        var rt = captureRuntime();
        rt.emit_move("G0", { X: 96 });
        expect(rt.emitted.length).toBeGreaterThan(1);
        // Walk the emitted G0s: none of the segments may cross the zone
        var pts = [{ x: 0, y: 20 }];
        rt.emitted.forEach(function (line) {
            var mx = line.match(/X(-?\d+(?:\.\d+)?)/);
            var my = line.match(/Y(-?\d+(?:\.\d+)?)/);
            var last = pts[pts.length - 1];
            pts.push({
                x: mx ? parseFloat(mx[1]) : last.x,
                y: my ? parseFloat(my[1]) : last.y,
            });
        });
        expect(pathClearOf(pts, [RECT])).toBe(true);
        // Final emitted position is the original target
        expect(pts[pts.length - 1].x).toBeCloseTo(96, 3);
        expect(pts[pts.length - 1].y).toBeCloseTo(20, 3);
    });

    test("a cutting move through a zone is NOT rerouted", function () {
        stubConfig([RECT]);
        var rt = captureRuntime();
        rt.emit_move("G1", { X: 96, F: 120 });
        expect(rt.emitted.length).toBe(1);
        expect(rt.emitted[0]).toMatch(/G1/);
    });

    test("an unroutable live jog throws; in simulation it falls through", function () {
        var wall = { id: "wall", type: "rect", x0: 40, y0: -5, x1: 56, y1: 53 };
        stubConfig([wall]);
        var rt = captureRuntime();
        expect(function () {
            rt.emit_move("G0", { X: 96 });
        }).toThrow(/keep-out/);
        var sim = captureRuntime();
        sim.simulation_mode = true;
        sim.emit_move("G0", { X: 96 });
        expect(sim.emitted.length).toBe(1); // straight jog recorded for the pre-run check
    });

    test("no zones configured leaves jogs untouched", function () {
        stubConfig([]);
        var rt = captureRuntime();
        rt.emit_move("G0", { X: 96 });
        expect(rt.emitted.length).toBe(1);
    });
});

describe("checkAgainstZones cut/rapid split", function () {
    test("cut hits land in cuts, rapid-only hits in rapids", function () {
        var zoneA = { id: "A", type: "rect", x0: 10, y0: 10, x1: 20, y1: 20 };
        var zoneB = { id: "B", type: "rect", x0: 60, y0: 10, x1: 70, y1: 20 };
        var jobBounds = {
            min: { x: 0, y: 15, z: 0 }, max: { x: 96, y: 15, z: 0 },
            path: [
                [0, 15, 0, 0],
                [30, 15, 0, 1],  // cut crossing zone A
                [96, 15, 0, 0],  // rapid crossing zone B
            ],
        };
        var r = bounds.checkAgainstZones(jobBounds, [zoneA, zoneB], {});
        expect(r.enters).toBe(true);
        expect(r.cuts).toEqual(["A"]);
        expect(r.rapids).toEqual(["B"]);
    });
});
