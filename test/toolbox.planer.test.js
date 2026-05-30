/* eslint-disable no-undef */
/*jshint esversion: 6 */
const { planer } = require("../runtime/manual/toolbox/planer");

const baseOpts = {
    center: { x: 0, y: 0 },
    startZ: 0,
    width: 1,
    length: 4,
    depth: 0.05,
    plungePerPass: 0.05,
    cutterDiameter: 0.25,
    stepoverPct: 50,
    grainDeg: 0,
    feedRateXY: 60,
    feedRateZ: 30,
    safeZ: 0.5,
};

describe("planer: geometry", () => {
    test("grain=0 cuts rows along +X, stepping in +Y", () => {
        const r = planer(Object.assign({}, baseOpts, { grainDeg: 0, width: 0.5, stepoverPct: 50 }));
        // stepDist = 0.25 * 0.5 = 0.125; rows at y = 0, 0.125, 0.25, 0.375, 0.5
        // = ceil(0.5/0.125) + 1 = 5 rows
        expect(r.summary.numWidthPasses).toBe(5);
        const cuts = r.gcode.filter(l => /^G1 X.* Y.* F/.test(l));
        // Every cut should go to X=4 (length along +X)
        cuts.forEach(c => expect(c).toMatch(/X4\.0000/));
        // Y values across the cuts: 0, 0.125, 0.25, 0.375, 0.5
        expect(cuts[0]).toMatch(/Y0\.0000/);
        expect(cuts[1]).toMatch(/Y0\.1250/);
        expect(cuts[4]).toMatch(/Y0\.5000/);
    });

    test("grain=90 cuts rows along +Y, stepping in -X", () => {
        // perpendicular = (-sin(90), cos(90)) = (-1, 0) → width steps in -X
        const r = planer(Object.assign({}, baseOpts, { grainDeg: 90, width: 0.5, stepoverPct: 50 }));
        const cuts = r.gcode.filter(l => /^G1 X.* Y.* F/.test(l));
        // All cuts go to Y=4 (length along +Y), Y goes from 0→4 per row
        cuts.forEach(c => expect(c).toMatch(/Y4\.0000/));
        // Rows step in -X: 0, -0.125, -0.25, -0.375, -0.5
        expect(cuts[0]).toMatch(/X0\.0000/);
        expect(cuts[1]).toMatch(/X-0\.1250/);
        expect(cuts[4]).toMatch(/X-0\.5000/);
    });
});

describe("planer: pass schedule", () => {
    test("layers depth across plungePerPass", () => {
        const r = planer(Object.assign({}, baseOpts, { depth: 0.12, plungePerPass: 0.05 }));
        // ceil(0.12/0.05) = 3 layers of 0.04 each
        expect(r.summary.numLayers).toBe(3);
        expect(r.summary.depthPerLayer).toBeCloseTo(0.04, 4);
    });

    test("clamps last width pass to requested width (no overshoot)", () => {
        const r = planer(Object.assign({}, baseOpts, {
            width: 0.3, cutterDiameter: 0.25, stepoverPct: 50,
        }));
        // stepDist = 0.125; offsets 0, 0.125, 0.25, 0.375 → clamp last to 0.3
        expect(r.summary.numWidthPasses).toBe(4);
        const cuts = r.gcode.filter(l => /^G1 X.* Y.* F/.test(l));
        expect(cuts[cuts.length - 1]).toMatch(/Y0\.3000/);
    });
});

describe("planer: unidirectional pattern", () => {
    test("retracts and rapids back to start of each row (no back-stroke cut)", () => {
        const r = planer(Object.assign({}, baseOpts, {
            grainDeg: 0, width: 0.5, stepoverPct: 50,
            depth: 0.05, plungePerPass: 0.05,
        }));
        // For each of 5 rows: G0 to start, G1 plunge, G1 cut, G0 retract.
        // Plus one initial G0 XY + G0 safe-Z.
        const cuts = r.gcode.filter(l => /^G1 X.* Y.* F/.test(l));
        const plunges = r.gcode.filter(l => l.startsWith("G1 Z"));
        const retracts = r.gcode.filter(l => /^G0 Z/.test(l));
        expect(cuts.length).toBe(5);
        expect(plunges.length).toBe(5);
        expect(retracts.length).toBe(6); // initial safeZ + 5 per-row retracts
    });
});

describe("planer: validation", () => {
    test("rejects width/length/depth <= 0", () => {
        expect(() => planer(Object.assign({}, baseOpts, { width: 0 }))).toThrow(/width/);
        expect(() => planer(Object.assign({}, baseOpts, { length: 0 }))).toThrow(/length/);
        expect(() => planer(Object.assign({}, baseOpts, { depth: 0 }))).toThrow(/depth/);
    });
    test("rejects stepoverPct outside (0,100)", () => {
        expect(() => planer(Object.assign({}, baseOpts, { stepoverPct: 0 }))).toThrow(/stepover/);
        expect(() => planer(Object.assign({}, baseOpts, { stepoverPct: 100 }))).toThrow(/stepover/);
    });
    test("rejects grainDeg outside [0,90]", () => {
        expect(() => planer(Object.assign({}, baseOpts, { grainDeg: -1 }))).toThrow(/grain/);
        expect(() => planer(Object.assign({}, baseOpts, { grainDeg: 91 }))).toThrow(/grain/);
    });
});
