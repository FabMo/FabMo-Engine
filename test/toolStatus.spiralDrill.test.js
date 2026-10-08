/*
 * Spiral-bore drill (Tool Status app): the drill press panel's bit/hole
 * diameters generate CG option-4 helixes (spiral plunge + bottom clean-up
 * circle). The ring math must never leave a core pillar standing
 * (innermost orbit ≤ bit/2), and the generated SBP must compile — via the
 * real OpenSBP runtime in simulation — to climb-direction helical arcs
 * that land exactly on the target depth.
 *
 * The builder functions live in the app bundle (browser JS), so they're
 * extracted from the source text and evaluated against stubbed app
 * globals, then their output is fed to SBPRuntime.simulateString.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const config = require("../config");
const { SBPRuntime } = require("../runtime/opensbp/opensbp");

// ---- extract the builder from the app source ----
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

function makeBuilder(bit, hole, unit) {
    const factory = new Function(
        "stDrill",
        "state",
        extractFn("stSpiralRings") + "\n" + extractFn("stSpiralLines") +
            "\nreturn { rings: stSpiralRings, lines: stSpiralLines };"
    );
    return factory({ bit: bit, hole: hole }, { unit: unit || "in" });
}

// ---- run generated SBP through the real runtime in simulation ----
function stubConfig() {
    const cache = {
        movexy_speed: 2,
        movez_speed: 0.5,
        movea_speed: 1,
        moveb_speed: 1,
        movec_speed: 1,
        jogxy_speed: 6,
        jogy_speed: 6,
        jogz_speed: 2,
        joga_speed: 2,
        jogb_speed: 2,
        jogc_speed: 2,
        xy_maxjerk: 100,
        y_maxjerk: 100,
        z_maxjerk: 50,
        a_maxjerk: 50,
        b_maxjerk: 50,
        c_maxjerk: 50,
        safeZpullUp: 1,
        cutterDia: 0.25,
        pocketOverlap: 50,
        units: "in",
        variables: {},
        tempVariables: {},
        transforms: {
            rotate: { apply: false },
            shearx: { apply: false },
            sheary: { apply: false },
            scale: { apply: false },
            move: { apply: false },
            level: { apply: false },
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

const arcs = (g) => g.filter((l) => /^(N\d+ )?G3[^\d]/.test(l));
const num = (line, word) => {
    const m = line.match(new RegExp(word + "(-?[\\d.]+)"));
    return m ? parseFloat(m[1]) : null;
};

describe("stSpiralRings", () => {
    test("hole barely over bit: one ring at the finished wall", () => {
        const b = makeBuilder(0.25, 0.375);
        expect(b.rings()).toEqual([0.0625]);
    });

    test("hole up to 2x bit: single ring still reaches center (no core)", () => {
        const b = makeBuilder(0.25, 0.5);
        const rings = b.rings();
        expect(rings).toEqual([0.125]);
        // orbit ≤ bit/2 → swept annulus covers the hole center
        expect(rings[0]).toBeLessThanOrEqual(0.125);
    });

    test("large hole: inner-to-outer rings, ≤50% stepover, no core, exact wall", () => {
        const b = makeBuilder(0.5, 2.0);
        const rings = b.rings();
        expect(rings).toEqual([0.25, 0.5, 0.75]);
        expect(rings[0]).toBeLessThanOrEqual(0.25); // reaches center
        for (let i = 1; i < rings.length; i++) {
            expect(rings[i] - rings[i - 1]).toBeLessThanOrEqual(0.25 + 1e-9);
        }
        expect(rings[rings.length - 1]).toBeCloseTo(0.75, 6); // (2 - 0.5)/2
    });
});

describe("spiral bore SBP compiles to a helix via the real runtime", () => {
    test("3/8 hole with 1/4 bit, 0.5 deep: G3 helix to exact depth + bottom circle", async () => {
        const b = makeBuilder(0.25, 0.375);
        const sbp = b.lines(2, 3, 0, -0.5, 1).join("\n");
        const g = await simulate(sbp);
        const a = arcs(g);
        // reps = ceil(0.52 / 0.125) = 5 helix revs + 1 bottom circle
        expect(a.length).toBe(6);
        // climb (CCW) full circles about I=+rc, J=0
        a.forEach((l) => {
            expect(num(l, "I")).toBeCloseTo(0.0625, 4);
            expect(num(l, "J") || 0).toBeCloseTo(0, 6);
        });
        // helix revs descend evenly; the last rev lands exactly on targetZ
        const zs = a.map((l) => num(l, "Z")).filter((z) => z !== null);
        expect(zs.length).toBe(5);
        expect(zs[zs.length - 1]).toBeCloseTo(-0.5, 4);
        for (let i = 1; i < zs.length; i++) {
            expect(zs[i]).toBeLessThan(zs[i - 1]);
        }
        // the bottom clean-up circle carries no Z word (flat at depth)
        expect(num(a[5], "Z")).toBeNull();
        // starts on the circle's west point: X = cx - rc
        expect(g.some((l) => /G0/.test(l) && num(l, "X") === 1.9375 && num(l, "Y") === 3)).toBe(true);
    });

    test("2in hole with 1/2 bit: three rings, each helixed to depth", async () => {
        const b = makeBuilder(0.5, 2.0);
        const sbp = b.lines(10, 10, 0, -0.25, 1).join("\n");
        const g = await simulate(sbp);
        const a = arcs(g);
        // 0.27 drop / 0.25 perRev → 2 revs + bottom = 3 arcs per ring × 3 rings
        expect(a.length).toBe(9);
        const is = a.map((l) => num(l, "I"));
        expect(is.slice(0, 3)).toEqual([0.25, 0.25, 0.25]);
        expect(is.slice(3, 6)).toEqual([0.5, 0.5, 0.5]);
        expect(is.slice(6, 9)).toEqual([0.75, 0.75, 0.75]);
        // every ring's last descending rev reaches targetZ
        [a[1], a[4], a[7]].forEach((l) => expect(num(l, "Z")).toBeCloseTo(-0.25, 4));
    });
});
