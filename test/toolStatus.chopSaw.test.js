/*
 * Chop saw (Tool Status app): order text → kerf-aware shelf nest →
 * per-piece outside-profile SBP. The parser must survive human order
 * grammar (pc./wide/long/x, fractions), the nest must keep one kerf
 * between pieces so neighboring bit-center paths coincide (no wasted
 * strip between cuts) and never overlap or leave the sheet, and the
 * generated SBP must compile — through the real OpenSBP runtime in
 * simulation — to rectangles offset one bit radius outside each piece
 * at the right pass depths.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const config = require("../config");
const { SBPRuntime } = require("../runtime/opensbp/opensbp");

const appSrc = fs.readFileSync(
    path.join(__dirname, "../dashboard/apps/tool_status.fma/js/app.js"),
    "utf8"
);
function extractFn(name) {
    const m = appSrc.indexOf("function " + name + "(");
    if (m < 0) throw new Error(name + " not found in app.js");
    let depth = 0;
    for (let j = appSrc.indexOf("{", m); j < appSrc.length; j++) {
        if (appSrc[j] === "{") depth++;
        if (appSrc[j] === "}") {
            depth--;
            if (!depth) return appSrc.slice(m, j + 1);
        }
    }
}
const lib = new Function(
    ["stcsNum", "stcsNest", "stcsCutLines"]
        .map(extractFn)
        .join("\n") + "\nreturn { num: stcsNum, nest: stcsNest, cut: stcsCutLines };"
)();

describe("stcsNum (W/L entry values)", () => {
    test("decimals and integers", () => {
        expect(lib.num("4")).toBe(4);
        expect(lib.num("3.5")).toBe(3.5);
        expect(lib.num(".5")).toBe(0.5);
    });
    test("fractions and mixed fractions", () => {
        expect(lib.num("1/2")).toBe(0.5);
        expect(lib.num("3 1/2")).toBe(3.5);
    });
    test("junk is NaN", () => {
        expect(lib.num("wide")).toBeNaN();
    });
});

describe("stcsNest", () => {
    const KERF = 0.25;
    const MARGIN = 0.125;

    function overlaps(a, b) {
        return a.x < b.x + b.l && b.x < a.x + a.l && a.y < b.y + b.w && b.y < a.y + a.w;
    }

    test("the requested order fits a 96×48 sheet, nothing missed", () => {
        const items = [{ qty: 10, w: 4, l: 12 }, { qty: 6, w: 3, l: 26 }];
        const n = lib.nest(items, 96, 48, KERF, MARGIN);
        expect(n.total).toBe(16);
        expect(n.placed.length).toBe(16);
        expect(n.missed).toEqual([]);
        // on the sheet, margins respected
        n.placed.forEach((p) => {
            expect(p.x).toBeGreaterThanOrEqual(MARGIN - 1e-9);
            expect(p.y).toBeGreaterThanOrEqual(MARGIN - 1e-9);
            expect(p.x + p.l).toBeLessThanOrEqual(96 - MARGIN + 1e-9);
            expect(p.y + p.w).toBeLessThanOrEqual(48 - MARGIN + 1e-9);
        });
        // no two pieces overlap
        for (let i = 0; i < n.placed.length; i++) {
            for (let j = i + 1; j < n.placed.length; j++) {
                expect(overlaps(n.placed[i], n.placed[j])).toBe(false);
            }
        }
    });

    test("neighbors in a row sit exactly one kerf apart → shared cut line", () => {
        const n = lib.nest([{ qty: 3, w: 4, l: 12 }], 96, 48, KERF, MARGIN);
        const row = n.placed.filter((p) => p.y === n.placed[0].y).sort((a, b) => a.x - b.x);
        expect(row.length).toBe(3);
        const r = KERF / 2; // bit radius when kerf = bit diameter
        for (let i = 1; i < row.length; i++) {
            expect(row[i].x - (row[i - 1].x + row[i - 1].l)).toBeCloseTo(KERF, 9);
            // bit-center paths coincide on the shared edge
            expect(row[i].x - r).toBeCloseTo(row[i - 1].x + row[i - 1].l + r, 9);
        }
    });

    test("wider pieces nest in lower rows (widest-first shelves)", () => {
        const n = lib.nest(
            [{ qty: 2, w: 2, l: 20 }, { qty: 2, w: 6, l: 20 }],
            96, 48, KERF, MARGIN
        );
        const wide = n.placed.filter((p) => p.w === 6);
        const narrow = n.placed.filter((p) => p.w === 2);
        wide.forEach((wp) => narrow.forEach((np) => expect(wp.y).toBeLessThanOrEqual(np.y)));
    });

    test("a piece longer than the sheet rotates to fit", () => {
        const n = lib.nest([{ qty: 1, w: 3, l: 50 }], 40, 60, KERF, MARGIN);
        expect(n.placed.length).toBe(1);
        expect(n.placed[0].rot).toBe(true);
        expect(n.placed[0].l).toBe(3);
        expect(n.placed[0].w).toBe(50);
    });

    test("overflow lands in missed, placed pieces still valid", () => {
        const n = lib.nest([{ qty: 100, w: 6, l: 30 }], 96, 48, KERF, MARGIN);
        expect(n.total).toBe(100);
        expect(n.placed.length).toBeGreaterThan(0);
        expect(n.placed.length + n.missed.length).toBe(100);
    });
});

// ---- generated SBP through the real runtime ----
function stubConfig() {
    const cache = {
        movexy_speed: 2, movez_speed: 0.5, movea_speed: 1, moveb_speed: 1, movec_speed: 1,
        jogxy_speed: 6, jogy_speed: 6, jogz_speed: 2, joga_speed: 2, jogb_speed: 2, jogc_speed: 2,
        xy_maxjerk: 100, y_maxjerk: 100, z_maxjerk: 50, a_maxjerk: 50, b_maxjerk: 50, c_maxjerk: 50,
        safeZpullUp: 1, cutterDia: 0.25, pocketOverlap: 50, units: "in",
        variables: {}, tempVariables: {},
        transforms: {
            rotate: { apply: false }, shearx: { apply: false }, sheary: { apply: false },
            scale: { apply: false }, move: { apply: false }, level: { apply: false },
            interpolate: { apply: false },
        },
    };
    config.opensbp = {
        _cache: cache,
        get: (k) => cache[k],
        getMany: (ks) => {
            const out = {};
            ks.forEach((k) => (out[k] = cache[k]));
            return out;
        },
        update: (data, cb) => cb && cb(null),
        setMany: (data, cb) => cb && cb(null),
    };
}

function simulate(sbp) {
    stubConfig();
    return new Promise((resolve, reject) => {
        const rt = new SBPRuntime();
        rt.loadCommands((lcErr) => {
            if (lcErr) return reject(lcErr);
            rt.simulateString(sbp, 0, 0, 1, (err, gcode) => {
                if (err) return reject(err);
                resolve(gcode.split("\n").map((l) => l.trim()).filter(Boolean));
            });
        });
    });
}
const num = (line, word) => {
    const m = line.match(new RegExp(word + "(-?[\\d.]+)"));
    return m ? parseFloat(m[1]) : null;
};

describe("chop saw SBP compiles to offset rectangles at pass depths", () => {
    test("one 4×12 piece, 2 passes: profile one bit radius outside, both depths", async () => {
        const bit = 0.25, r = bit / 2;
        const n = lib.nest([{ qty: 1, w: 4, l: 12 }], 96, 48, bit, r);
        const p = n.placed[0];
        const depths = [-0.385, -0.77]; // 0.75 + 0.02 breakthrough over 2 passes
        const sbp = lib.cut(p, r, depths, 1).join("\n");
        const g = await simulate(sbp);
        const cuts = g.filter((l) => /^(N\d+ )?G1[^\d]/.test(l));
        // 2 passes × (1 plunge + 4 sides)
        expect(cuts.length).toBe(10);
        const zs = cuts.map((l) => num(l, "Z")).filter((z) => z !== null);
        expect(zs).toEqual([-0.385, -0.77]);
        // the path is the piece rect grown by r on all sides
        const xs = cuts.map((l) => num(l, "X")).filter((x) => x !== null);
        const ys = cuts.map((l) => num(l, "Y")).filter((y) => y !== null);
        expect(Math.min(...xs)).toBeCloseTo(p.x - r, 4);
        expect(Math.max(...xs)).toBeCloseTo(p.x + p.l + r, 4);
        expect(Math.min(...ys)).toBeCloseTo(p.y - r, 4);
        expect(Math.max(...ys)).toBeCloseTo(p.y + p.w + r, 4);
    });
});
