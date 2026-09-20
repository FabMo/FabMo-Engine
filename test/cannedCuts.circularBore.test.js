/* eslint-disable no-undef */
/*jshint esversion: 6 */
const { circularBore, computeRings } = require("../runtime/manual/cannedCuts/circularBore");

// Helpers
const linesMatching = (gcode, re) => gcode.filter((l) => re.test(l));
const arcsIn = (gcode) => linesMatching(gcode, /^G[23] /);
const plungesIn = (gcode) => linesMatching(gcode, /^G1 Z/);
const safeRetracts = (gcode) => linesMatching(gcode, /^G0 Z/);

describe("computeRings", () => {
    test("single ring when pocket fits in one stepOver", () => {
        // pocketRadius = 0.1, cutter = 0.25 → stepOver = 0.125 (50% overlap default)
        // outer ring at 0.1; r-stepOver = -0.025, no inner rings.
        const rings = computeRings(0.1, 0.25, 0.5);
        expect(rings).toEqual([0.1]);
    });

    test("multiple rings spiral inward", () => {
        // pocketRadius = 0.5, cutter = 0.25 → stepOver = 0.125
        // rings: 0.5, 0.375, 0.25, 0.125
        const rings = computeRings(0.5, 0.25, 0.5);
        expect(rings.length).toBe(4);
        expect(rings[0]).toBeCloseTo(0.5);
        expect(rings[1]).toBeCloseTo(0.375);
        expect(rings[2]).toBeCloseTo(0.25);
        expect(rings[3]).toBeCloseTo(0.125);
    });

    test("zero or negative pocketRadius yields no rings", () => {
        expect(computeRings(0, 0.25, 0.5)).toEqual([]);
        expect(computeRings(-0.1, 0.25, 0.5)).toEqual([]);
    });
});

describe("circularBore: validation", () => {
    test("requires center", () => {
        expect(() => circularBore({ startZ: 0 })).toThrow(/center/);
    });
    test("requires startZ", () => {
        expect(() => circularBore({ center: { x: 1, y: 2 } })).toThrow(/startZ/);
    });
    test("rejects non-positive diameter", () => {
        expect(() => circularBore({ center: { x: 0, y: 0 }, startZ: 0, diameter: 0 }))
            .toThrow(/diameter/);
    });
    test("rejects non-positive depth", () => {
        expect(() => circularBore({ center: { x: 0, y: 0 }, startZ: 0, depth: 0 }))
            .toThrow(/depth/);
    });
});

describe("circularBore: degenerate (bore <= cutter)", () => {
    test("bore smaller than cutter falls back to plunge at center", () => {
        const { gcode, summary } = circularBore({
            center: { x: 5, y: 7 },
            startZ: 1.0,
            diameter: 0.2,
            depth: 0.3,
            cutterDiameter: 0.25,
        });
        expect(summary.mode).toBe("plunge");
        expect(summary.numRings).toBe(0);
        // Should be safeZ, position, plunge, retract — no arcs
        expect(arcsIn(gcode).length).toBe(0);
        // Plunge to startZ - depth = 0.7
        expect(plungesIn(gcode).length).toBeGreaterThanOrEqual(1);
        const finalZ = plungesIn(gcode)[0];
        expect(finalZ).toMatch(/Z0\.7000/);
        // X/Y at center
        expect(gcode.some((l) => l.includes("X5.0000") && l.includes("Y7.0000"))).toBe(true);
    });
});

describe("circularBore: pocket mode geometry", () => {
    test("emits one full-circle arc per ring per pass", () => {
        const { gcode, summary } = circularBore({
            center: { x: 0, y: 0 },
            startZ: 0,
            diameter: 0.75,
            depth: 0.25,
            plungePerPass: 0.125,
            cutterDiameter: 0.25,
        });
        expect(summary.numPasses).toBe(2);
        expect(summary.numRings).toBeGreaterThan(1);
        // numArcs = numPasses × numRings
        const expectedArcs = summary.numPasses * summary.numRings;
        expect(arcsIn(gcode).length).toBe(expectedArcs);
    });

    test("default direction is clockwise (G2)", () => {
        const { gcode } = circularBore({
            center: { x: 0, y: 0 },
            startZ: 0,
            diameter: 0.5,
            depth: 0.1,
            plungePerPass: 0.1,
        });
        expect(arcsIn(gcode).every((l) => l.startsWith("G2 "))).toBe(true);
    });

    test("ccw direction emits G3", () => {
        const { gcode } = circularBore({
            center: { x: 0, y: 0 },
            startZ: 0,
            diameter: 0.5,
            depth: 0.1,
            plungePerPass: 0.1,
            direction: "ccw",
        });
        expect(arcsIn(gcode).every((l) => l.startsWith("G3 "))).toBe(true);
    });

    test("arc start point is on +X side of center, I points to center", () => {
        const cx = 2;
        const cy = 3;
        const { gcode, summary } = circularBore({
            center: { x: cx, y: cy },
            startZ: 0,
            diameter: 0.5,
            depth: 0.05,
            plungePerPass: 0.1,
            cutterDiameter: 0.125,
        });
        // outer ring at pocketRadius = (0.5 - 0.125)/2 = 0.1875
        const expectedStartX = cx + 0.1875;
        const arc = arcsIn(gcode)[0];
        expect(arc).toContain("X" + expectedStartX.toFixed(4));
        expect(arc).toContain("Y" + cy.toFixed(4));
        expect(arc).toContain("I-0.1875");
        expect(arc).toContain("J0.0000");
    });

    test("depth distributed evenly across passes (no thin final cut)", () => {
        const { gcode, summary } = circularBore({
            center: { x: 0, y: 0 },
            startZ: 0,
            diameter: 0.5,
            depth: 0.3,
            plungePerPass: 0.125,
        });
        // ceil(0.3 / 0.125) = 3 passes → 0.1 per pass
        expect(summary.numPasses).toBe(3);
        expect(summary.depthPerPass).toBeCloseTo(0.1);
        // Z plunges should be at -0.1, -0.2, -0.3
        const zs = plungesIn(gcode).map((l) => {
            const m = l.match(/Z(-?\d+\.\d+)/);
            return m ? parseFloat(m[1]) : null;
        });
        expect(zs).toEqual([-0.1, -0.2, -0.3]);
    });

    test("perimeter mode emits one arc per pass (no inner rings)", () => {
        const { gcode, summary } = circularBore({
            center: { x: 0, y: 0 },
            startZ: 0,
            diameter: 0.75,
            depth: 0.2,
            plungePerPass: 0.1,
            mode: "perimeter",
        });
        expect(summary.numRings).toBe(1);
        expect(arcsIn(gcode).length).toBe(summary.numPasses);
    });
});

describe("circularBore: safety", () => {
    test("starts and ends with retract to safeZ above startZ", () => {
        const startZ = 1.5;
        const safeZ = 0.5;
        const { gcode } = circularBore({
            center: { x: 0, y: 0 },
            startZ: startZ,
            safeZ: safeZ,
            diameter: 0.5,
            depth: 0.1,
            plungePerPass: 0.1,
        });
        const retracts = safeRetracts(gcode);
        // First and last G0 Z should retract above startZ (startZ + safeZ).
        const expected = (startZ + safeZ).toFixed(4);
        expect(retracts[0]).toContain("Z" + expected);
        expect(retracts[retracts.length - 1]).toContain("Z" + expected);
    });

    test("header sets absolute mode and exact path", () => {
        const { gcode } = circularBore({
            center: { x: 0, y: 0 },
            startZ: 0,
            diameter: 0.5,
            depth: 0.1,
            plungePerPass: 0.1,
        });
        expect(gcode.some((l) => l.includes("G90") && l.includes("G61"))).toBe(true);
    });

    test("feed rates appear on every motion line that needs them", () => {
        const { gcode } = circularBore({
            center: { x: 0, y: 0 },
            startZ: 0,
            diameter: 0.5,
            depth: 0.2,
            plungePerPass: 0.1,
            feedRateXY: 90,
            feedRateZ: 25,
        });
        // Every G1/G2/G3 line should have an F.
        const cuts = gcode.filter((l) => /^G[123] /.test(l) && !/^G0 /.test(l));
        cuts.forEach((l) => {
            expect(l).toMatch(/F\d+\.\d+/);
        });
    });
});
