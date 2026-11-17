/*
 * Job-attached registration (print-and-cut).
 *
 * A registered job carries its own affine correction. These tests pin the
 * properties that make it safe, as opposed to borrowing the machine-wide
 * `transforms` config:
 *   - only the job's own top-level moves are corrected, never a macro's;
 *   - it composes with a machine-square transform instead of replacing it;
 *   - arcs survive a stretched/skewed sheet (they go out as short lines);
 *   - nothing is written to config, and the correction is gone with the run.
 */
"use strict";

const config = require("../config");
const reg = require("../runtime/opensbp/registration");
const { SBPRuntime } = require("../runtime/opensbp/opensbp");

// a crooked, slightly stretched and skewed sheet (S * ShearX * R)
function truth() {
    const rot = (2.7 * Math.PI) / 180;
    const sx = 1.0031,
        sy = 0.9982,
        k = 0.0015;
    const cos = Math.cos(rot),
        sin = Math.sin(rot);
    return {
        a: sx * (cos + k * sin),
        b: sx * (-sin + k * cos),
        c: sy * sin,
        d: sy * cos,
        tx: 7.25,
        ty: 3.4,
        units: "in",
    };
}

let writes;
function stubConfig(transforms) {
    writes = [];
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
        transforms: Object.assign(
            {
                rotate: { apply: false },
                shearx: { apply: false },
                sheary: { apply: false },
                scale: { apply: false },
                move: { apply: false },
                level: { apply: false },
                interpolate: { apply: false },
            },
            transforms || {}
        ),
    };
    config.opensbp = {
        _cache: cache,
        get: (k) => cache[k],
        getMany: (ks) => {
            const out = {};
            ks.forEach((k) => (out[k] = cache[k]));
            return out;
        },
        update: (data, cb) => {
            writes.push(data);
            cb && cb(null);
        },
        setMany: (data, cb) => {
            writes.push(data);
            cb && cb(null);
        },
    };
}

function simulate(sbp, registration, transforms) {
    stubConfig(transforms);
    return new Promise((resolve, reject) => {
        const rt = new SBPRuntime();
        rt.loadCommands((lcErr) => {
            if (lcErr) return reject(lcErr);
            rt.setRegistration(registration || null);
            rt.simulateString(sbp, 0, 0, 1, (err, gcode) => {
                if (err) return reject(err);
                resolve(gcode.split("\n").map((l) => l.trim()).filter(Boolean));
            });
        });
    });
}

const word = (line, w) => {
    const m = line.match(new RegExp(w + "(-?[\\d.]+)"));
    return m ? parseFloat(m[1]) : null;
};
// XY of every motion line, carrying the last value of an omitted axis
function xyPath(gcode) {
    let x = null,
        y = null;
    const out = [];
    gcode.forEach((l) => {
        if (!/ G[0123]\D/.test(" " + l.replace(/^N\d+ /, "") + " ") && !/^(N\d+ )?G[0123][A-Z]/.test(l)) return;
        const nx = word(l, "X"),
            ny = word(l, "Y");
        if (nx === null && ny === null) return;
        if (nx !== null) x = nx;
        if (ny !== null) y = ny;
        out.push({ x, y, line: l });
    });
    return out;
}

describe("registration maths", () => {
    test("apply and invert are inverses", () => {
        const t = truth();
        const p = reg.apply(t, 12.5, -3.25);
        const q = reg.invert(t, p.x, p.y);
        expect(q.x).toBeCloseTo(12.5, 9);
        expect(q.y).toBeCloseTo(-3.25, 9);
    });

    test("only the translation changes with units", () => {
        const t = truth();
        const mm = reg.inUnits(t, "mm");
        expect(mm.a).toBe(t.a);
        expect(mm.tx).toBeCloseTo(t.tx * 25.4, 9);
        // a point given in mm lands where the same point in inches does
        const pin = reg.apply(t, 2, 3);
        const pmm = reg.apply(mm, 2 * 25.4, 3 * 25.4);
        expect(pmm.x / 25.4).toBeCloseTo(pin.x, 9);
        expect(pmm.y / 25.4).toBeCloseTo(pin.y, 9);
        expect(reg.inUnits(t, "in")).toBe(t);
    });

    test("normalize accepts a good registration, also as JSON text", () => {
        const t = truth();
        expect(reg.normalize(t)).toEqual(t);
        expect(reg.normalize(JSON.stringify(t))).toEqual(t);
        expect(reg.normalize(null)).toBeNull();
        expect(reg.normalize(undefined)).toBeNull();
    });

    test("normalize refuses what would be dangerous to cut", () => {
        const t = truth();
        expect(() => reg.normalize(Object.assign({}, t, { a: NaN }))).toThrow(/finite/);
        expect(() => reg.normalize(Object.assign({}, t, { ty: undefined }))).toThrow(/finite/);
        expect(() => reg.normalize(Object.assign({}, t, { units: "furlongs" }))).toThrow(/units/);
        expect(() => reg.normalize({ a: 1, b: 0, c: 0, d: -1, tx: 0, ty: 0, units: "in" })).toThrow(/mirrored/);
        expect(() => reg.normalize({ a: 0, b: 0, c: 0, d: 0, tx: 0, ty: 0, units: "in" })).toThrow(/degenerate/);
        expect(() => reg.normalize({ a: 3, b: 0, c: 0, d: 3, tx: 0, ty: 0, units: "in" })).toThrow(/stretch/);
        expect(() => reg.normalize("{not json")).toThrow(/JSON/);
    });

    test("arc chords stay on the circle, within tolerance, and end exactly", () => {
        // quarter circle, radius 2 about the origin, counter-clockwise
        const pts = reg.arcChords(false, { x: 2, y: 0 }, { x: 0, y: 2 }, -2, 0, "in");
        expect(pts.length).toBeGreaterThan(8);
        expect(pts[pts.length - 1]).toEqual({ x: 0, y: 2 });
        let prev = { x: 2, y: 0 };
        pts.forEach((p) => {
            expect(Math.hypot(p.x, p.y)).toBeCloseTo(2, 9);
            // sagitta of each chord
            const mid = Math.hypot((p.x + prev.x) / 2, (p.y + prev.y) / 2);
            expect(2 - mid).toBeLessThan(0.00051);
            expect(p.y).toBeGreaterThanOrEqual(prev.y); // going the right way round
            prev = p;
        });
    });

    test("an arc that ends where it starts is a full circle, in the right direction", () => {
        const ccw = reg.arcChords(false, { x: 1, y: 0 }, { x: 1, y: 0 }, -1, 0, "in");
        const cw = reg.arcChords(true, { x: 1, y: 0 }, { x: 1, y: 0 }, -1, 0, "in");
        expect(ccw[0].y).toBeGreaterThan(0);
        expect(cw[0].y).toBeLessThan(0);
        const top = ccw.reduce((m, p) => Math.max(m, p.y), -9);
        const left = ccw.reduce((m, p) => Math.min(m, p.x), 9);
        expect(top).toBeCloseTo(1, 3);
        expect(left).toBeCloseTo(-1, 3);
    });

    test("a helical arc ramps Z evenly", () => {
        const pts = reg.arcChords(true, { x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: -0.5 }, -1, 0, "in");
        expect(pts[pts.length - 1].z).toBeCloseTo(-0.5, 9);
        const half = pts[Math.floor(pts.length / 2) - 1];
        expect(half.z).toBeCloseTo(-0.25, 1);
    });
});

describe("a registered job in the runtime", () => {
    const FILE = ["J2,1,1", "M2,5,1", "MY,4", "MX,1", "M3,1,1,-0.1", "JZ,1"].join("\n") + "\n";
    const FILE_PTS = [
        [1, 1],
        [5, 1],
        [5, 4],
        [1, 4],
        [1, 1],
    ];

    test("with no registration the file runs as written", async () => {
        const path = xyPath(await simulate(FILE));
        expect(path.map((p) => [p.x, p.y])).toEqual(FILE_PTS);
    });

    test("every XY move lands where the sheet really is", async () => {
        const t = truth();
        const path = xyPath(await simulate(FILE, t));
        expect(path.length).toBe(FILE_PTS.length);
        FILE_PTS.forEach((fp, i) => {
            const want = reg.apply(t, fp[0], fp[1]);
            expect(path[i].x).toBeCloseTo(want.x, 4);
            expect(path[i].y).toBeCloseTo(want.y, 4);
        });
    });

    test("single-axis moves are sent with both axes (a crooked sheet needs both)", async () => {
        const g = await simulate(FILE, truth());
        const moves = g.filter((l) => /G1/.test(l) && /[XY]/.test(l));
        moves.forEach((l) => {
            expect(l).toMatch(/X/);
            expect(l).toMatch(/Y/);
        });
    });

    test("Z is left alone", async () => {
        const plain = (await simulate(FILE)).map((l) => word(l, "Z")).filter((z) => z !== null);
        const registered = (await simulate(FILE, truth())).map((l) => word(l, "Z")).filter((z) => z !== null);
        expect(registered).toEqual(plain);
    });

    test("nothing is written to config", async () => {
        await simulate(FILE, truth());
        const touched = writes.filter((w) => w && Object.prototype.hasOwnProperty.call(w, "transforms"));
        expect(touched).toEqual([]);
    });

    test("it composes with a machine-square correction instead of replacing it", async () => {
        const t = truth();
        // machine has a shear set for an out-of-square gantry
        const shear = { shearx: { apply: true, angle: 0.2 } };
        const path = xyPath(await simulate(FILE, t, shear));
        const k = ((0.2 * -1) / 180) * Math.PI; // transformation.js shearX
        FILE_PTS.forEach((fp, i) => {
            const onSheet = reg.apply(t, fp[0], fp[1]);
            expect(path[i].x).toBeCloseTo(onSheet.x + k * onSheet.y, 4);
            expect(path[i].y).toBeCloseTo(onSheet.y, 4);
        });
    });

    test("arcs become lines that follow the stretched, skewed circle", async () => {
        const t = truth();
        // full circle, radius 1.5, centred on (4,4), starting at (5.5,4)
        const g = await simulate("J2,5.5,4\nM3,5.5,4,-0.1\nCG,,5.5,4,-1.5,0,T,1\nJZ,1\n", t);
        expect(g.filter((l) => /G[23]\D/.test(l.replace(/^N\d+ /, "")))).toEqual([]);
        const path = xyPath(g).filter((p) => /G1/.test(p.line));
        expect(path.length).toBeGreaterThan(40);
        // map each cut point back onto the file: it must sit on the drawn circle
        path.forEach((p) => {
            const f = reg.invert(t, p.x, p.y);
            expect(Math.hypot(f.x - 4, f.y - 4)).toBeCloseTo(1.5, 3);
        });
        const last = path[path.length - 1];
        const end = reg.apply(t, 5.5, 4);
        expect(last.x).toBeCloseTo(end.x, 4);
        expect(last.y).toBeCloseTo(end.y, 4);
    });

    test("an unregistered job still sends true arcs", async () => {
        const g = await simulate("J2,5.5,4\nM3,5.5,4,-0.1\nCG,,5.5,4,-1.5,0,T,1\nJZ,1\n");
        expect(g.some((l) => /G2\D/.test(l.replace(/^N\d+ /, "")))).toBe(true);
    });

    test("a file in mm on an inch registration lands in the same place", async () => {
        const t = truth();
        const mm = reg.inUnits(t, "mm");
        const pIn = reg.apply(t, 5, 1);
        const pMm = reg.apply(mm, 127, 25.4);
        expect(pMm.x / 25.4).toBeCloseTo(pIn.x, 9);
        expect(pMm.y / 25.4).toBeCloseTo(pIn.y, 9);
    });
});

describe("macros are never registered", () => {
    function liveLike(t) {
        stubConfig();
        const rt = new SBPRuntime();
        const out = [];
        rt.emit_gcode = (s) => out.push(s);
        rt._setupTransforms();
        rt.units = "in";
        rt.setRegistration(t);
        return { rt, out };
    }

    test("moves in the job file are corrected; moves inside a macro are not", () => {
        const t = truth();
        const { rt, out } = liveLike(t);
        rt.cmd_posx = 0;
        rt.cmd_posy = 0;
        rt._regEnterFile();

        rt.emit_move("G1", { X: 5, Y: 1 });
        const want = reg.apply(t, 5, 1);
        expect(word(out[0], "X")).toBeCloseTo(want.x, 4);
        expect(word(out[0], "Y")).toBeCloseTo(want.y, 4);

        // tool-change macro: a fixed machine position
        rt.file_stack.push({});
        rt.emit_move("G0", { X: 40, Y: 2 });
        expect(out[1]).toBe("G0X40.00000Y2.00000");
        rt.emit_move("G2", { X: 40, Y: 2, I: -1, J: 0 });
        expect(out[2]).toMatch(/^G2X40\.00000Y2\.00000I-1\.00000J0\.00000/);
        rt.file_stack.pop();

        // back in the file: corrected again
        rt.emit_move("G1", { X: 1, Y: 1 });
        const back = reg.apply(t, 1, 1);
        expect(word(out[3], "X")).toBeCloseTo(back.x, 4);
        expect(word(out[3], "Y")).toBeCloseTo(back.y, 4);
    });

    test("the commanded position is handed over in the right coordinates", () => {
        const t = truth();
        const { rt, out } = liveLike(t);
        rt.program = [];
        rt.cmd_posx = 0;
        rt.cmd_posy = 0;
        rt._regEnterFile();
        rt.emit_move("G1", { X: 5, Y: 1 }); // file coordinates
        const onTable = reg.apply(t, 5, 1);

        // entering a macro: it sees where the tool really is on the table
        rt._pushFileStack();
        expect(rt.cmd_posx).toBeCloseTo(onTable.x, 9);
        expect(rt.cmd_posy).toBeCloseTo(onTable.y, 9);

        // the macro parks the tool somewhere, then returns
        rt.emit_move("G0", { X: 40, Y: 2 });
        rt._popFileStack();
        const inFile = reg.invert(t, 40, 2);
        expect(rt.cmd_posx).toBeCloseTo(inFile.x, 9);
        expect(rt.cmd_posy).toBeCloseTo(inFile.y, 9);

        // a single-axis move in the file now starts from the true position
        out.length = 0;
        rt.emit_move("G1", { X: 6 });
        const want = reg.apply(t, 6, inFile.y);
        const line = out.filter((l) => /^G1/.test(l))[0];
        expect(word(line, "X")).toBeCloseTo(want.x, 4);
        expect(word(line, "Y")).toBeCloseTo(want.y, 4);
    });

    test("entering the file twice does not convert twice", () => {
        const { rt } = liveLike(truth());
        rt.cmd_posx = 3;
        rt.cmd_posy = 4;
        rt._regEnterFile();
        const once = [rt.cmd_posx, rt.cmd_posy];
        rt._regEnterFile();
        expect([rt.cmd_posx, rt.cmd_posy]).toEqual(once);
    });

    test("clearing the registration returns the runtime to plain moves", () => {
        const { rt, out } = liveLike(truth());
        rt.setRegistration(null);
        expect(rt.registration).toBeNull();
        rt.emit_move("G1", { X: 5, Y: 1 });
        expect(out[0]).toBe("G1X5.00000Y1.00000");
    });

    test("a malformed registration is refused, not half-applied", () => {
        const { rt } = liveLike(truth());
        expect(() => rt.setRegistration({ a: 1, b: 0, c: 0, d: 1, tx: "x", ty: 0, units: "in" })).toThrow();
    });
});
