// Envelope (soft-limit) pre-check: X/Y are enforced, Z is deliberately not.
var bounds = require("../runtime/bounds");

var ENV = { xmin: 0, xmax: 24, ymin: 0, ymax: 18, zmin: -6, zmax: 0 };
var G55 = { x: 0, y: 0, z: -3.217 };

function job(min, max) {
    return { min: min, max: max };
}

describe("checkAgainstEnvelope", function () {
    test("flags X and Y overruns", function () {
        var r = bounds.checkAgainstEnvelope(job({ x: -1, y: 0, z: 0 }, { x: 10, y: 20, z: 0 }), ENV, G55);
        expect(r.exceeds).toBe(true);
        expect(r.violations.map(function (v) { return v.axis + v.direction; }).sort()).toEqual(["xmin", "ymax"]);
    });

    test("ignores Z above the ceiling", function () {
        var r = bounds.checkAgainstEnvelope(job({ x: 1, y: 1, z: -0.5 }, { x: 10, y: 10, z: 5 }), ENV, G55);
        expect(r).toEqual({ exceeds: false, violations: [] });
    });

    test("ignores a Z span longer than the Z travel", function () {
        var r = bounds.checkAgainstEnvelope(job({ x: 1, y: 1, z: -20 }, { x: 10, y: 10, z: 1 }), ENV, G55);
        expect(r).toEqual({ exceeds: false, violations: [] });
    });
});
