/* eslint-disable no-undef */
/*jshint esversion: 6 */
const { straightLine } = require("../runtime/manual/toolbox/straightLine");

const baseOpts = {
    center: { x: 1, y: 2 },
    startZ: 0,
    length: 4,
    angleDeg: 0,
    depth: 0.25,
    plungePerPass: 0.125,
    cutterDiameter: 0.25,
    feedRateXY: 60,
    feedRateZ: 30,
    safeZ: 0.5,
};

describe("straightLine: geometry", () => {
    test("angle=0 cuts in pure +X from start", () => {
        const r = straightLine(Object.assign({}, baseOpts, { angleDeg: 0, length: 3 }));
        expect(r.summary.end.x).toBeCloseTo(4, 4);
        expect(r.summary.end.y).toBeCloseTo(2, 4);
    });

    test("angle=90 cuts in pure +Y from start", () => {
        const r = straightLine(Object.assign({}, baseOpts, { angleDeg: 90, length: 3 }));
        expect(r.summary.end.x).toBeCloseTo(1, 4);
        expect(r.summary.end.y).toBeCloseTo(5, 4);
    });

    test("angle=45 cuts diagonally NE with length as Euclidean distance", () => {
        const r = straightLine(Object.assign({}, baseOpts, { angleDeg: 45, length: Math.SQRT2 }));
        expect(r.summary.end.x).toBeCloseTo(2, 4);
        expect(r.summary.end.y).toBeCloseTo(3, 4);
    });
});

describe("straightLine: pass schedule", () => {
    test("distributes depth evenly across passes", () => {
        const r = straightLine(Object.assign({}, baseOpts, {
            depth: 0.3, plungePerPass: 0.125,
        }));
        // 0.3 / 0.125 = 2.4 → ceil to 3 passes of 0.1 each
        expect(r.summary.numPasses).toBe(3);
        expect(r.summary.depthPerPass).toBeCloseTo(0.1, 4);
    });
});

describe("straightLine: G-code shape", () => {
    test("starts with absolute + exact-stop, ends on safe retract", () => {
        const r = straightLine(baseOpts);
        expect(r.gcode[0]).toBe("G90 G61");
        const last = r.gcode[r.gcode.length - 1];
        expect(last).toMatch(/^G0 Z/);   // retracted
    });

    test("each pass plunges and cuts (bidirectional, no per-pass retract)", () => {
        const r = straightLine(Object.assign({}, baseOpts, {
            depth: 0.25, plungePerPass: 0.125,
        }));
        // 2 passes → 2 plunges + 2 cuts + exactly 1 final retract.
        const plunges = r.gcode.filter(l => l.startsWith("G1 Z"));
        const cuts = r.gcode.filter(l => /^G1 X.* Y.* F/.test(l));
        const retracts = r.gcode.filter(l => /^G0 Z/.test(l));
        expect(plunges.length).toBe(2);
        expect(cuts.length).toBe(2);
        // One initial safe-Z move + one final retract = 2 total G0 Z lines.
        expect(retracts.length).toBe(2);
    });

    test("passes alternate direction (cut to end, cut back to start, ...)", () => {
        const r = straightLine(Object.assign({}, baseOpts, {
            center: { x: 0, y: 0 }, angleDeg: 0, length: 4,
            depth: 0.375, plungePerPass: 0.125,    // 3 passes
        }));
        const cuts = r.gcode.filter(l => /^G1 X.* Y.* F/.test(l));
        expect(cuts.length).toBe(3);
        // 1st cut → end (X=4), 2nd cut → start (X=0), 3rd cut → end (X=4)
        expect(cuts[0]).toMatch(/X4\.0000/);
        expect(cuts[1]).toMatch(/X0\.0000/);
        expect(cuts[2]).toMatch(/X4\.0000/);
    });
});

describe("straightLine: validation", () => {
    test("rejects length <= 0", () => {
        expect(() => straightLine(Object.assign({}, baseOpts, { length: 0 })))
            .toThrow(/length/);
    });
    test("rejects angleDeg outside [0,90]", () => {
        expect(() => straightLine(Object.assign({}, baseOpts, { angleDeg: -1 })))
            .toThrow(/angle/);
        expect(() => straightLine(Object.assign({}, baseOpts, { angleDeg: 91 })))
            .toThrow(/angle/);
    });
    test("requires center", () => {
        expect(() => straightLine(Object.assign({}, baseOpts, { center: undefined })))
            .toThrow(/center/);
    });
    test("requires startZ", () => {
        const opts = Object.assign({}, baseOpts);
        delete opts.startZ;
        expect(() => straightLine(opts)).toThrow(/startZ/);
    });
});
