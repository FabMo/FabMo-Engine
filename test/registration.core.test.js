/*
 * Print Registration app — core maths.
 * Covers mark parsing, the fit, dot detection on synthetic frames, and the
 * things that must not drift: that the registration the app queues with a
 * job is its fit as the engine reads it, and that the app's model of the
 * machine's own OpenSBP transforms matches the engine's transform code.
 */
const core = require("../dashboard/apps/registration.fma/js/regcore.js");
const tform = require("../runtime/opensbp/transformation.js");
const engineReg = require("../runtime/opensbp/registration.js");

// Same order as SBPRuntime.prototype.transformation
function engineTransform(tr, x, y) {
    let pt = { X: x, Y: y };
    if (tr.rotate.apply) pt = tform.rotate(pt, tr.rotate.angle, tr.rotate.x, tr.rotate.y, {});
    if (tr.shearx.apply) pt = tform.shearX(pt, tr.shearx.angle);
    if (tr.sheary.apply) pt = tform.shearY(pt, tr.sheary.angle);
    if (tr.scale.apply) {
        pt = tform.scale(pt, tr.scale.scalex, tr.scale.scaley, tr.scale.scalez, tr.scale.x, tr.scale.y, tr.scale.z, tr.scale.x, tr.scale.y);
    }
    if (tr.move.apply) pt = tform.translate(pt, tr.move.x, tr.move.y, tr.move.z);
    return { x: pt.X, y: pt.Y };
}

// a crooked, slightly stretched and skewed sheet
function truth() {
    const rot = (2.7 * Math.PI) / 180;
    const sx = 1.0031,
        sy = 0.9982,
        k = 0.0015;
    const cos = Math.cos(rot),
        sin = Math.sin(rot);
    // S * ShearX * R
    return {
        a: sx * (cos + k * sin),
        b: sx * (-sin + k * cos),
        c: sy * sin,
        d: sy * cos,
        tx: 7.25,
        ty: 3.4,
    };
}

// Render what a camera centred on `camPos` (table coords) would see:
// white sheet, black dots, supersampled edges, optional noise and clutter.
function renderFrame(dots, camPos, cam, markDia, opts) {
    opts = opts || {};
    const w = cam.width,
        h = cam.height;
    const data = new Uint8ClampedArray(w * h * 4);
    const centres = dots.map((d) => {
        const p = core.offsetToPixel(d.x - camPos.x, d.y - camPos.y, cam);
        return { x: w / 2 + p.u, y: h / 2 + p.v };
    });
    const r = (markDia * cam.pxPerUnit) / 2;
    let seed = 12345;
    const rnd = () => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed / 0x7fffffff - 0.5;
    };
    const SS = 4;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let cover = 0;
            for (const c of centres) {
                if (Math.abs(x - c.x) > r + 2 || Math.abs(y - c.y) > r + 2) continue;
                let hit = 0;
                for (let sy = 0; sy < SS; sy++) {
                    for (let sx = 0; sx < SS; sx++) {
                        const dx = x + (sx + 0.5) / SS - c.x,
                            dy = y + (sy + 0.5) / SS - c.y;
                        if (dx * dx + dy * dy <= r * r) hit++;
                    }
                }
                cover = Math.max(cover, hit / (SS * SS));
            }
            let v = 225 - cover * 200;
            if (opts.clutter && y > 20 && y < 60) v = 60; // a printed bar across the top
            if (opts.noise) v += rnd() * opts.noise;
            const i = (y * w + x) * 4;
            data[i] = data[i + 1] = data[i + 2] = v;
            data[i + 3] = 255;
        }
    }
    return { data, width: w, height: h };
}

describe("print registration: job parsing", () => {
    const design = core.demoDesign();
    const job = core.parseJob(core.demoSBP(design));

    test("marks come from the Regmarks toolpath", () => {
        expect(job.source).toBe("toolpath");
        expect(job.marks).toEqual(design.marks);
    });

    test("regmark motion is stripped, cut contour kept", () => {
        expect(job.removedMoves).toBeGreaterThan(0);
        expect(job.text).not.toMatch(/M3,0\.6000,0\.6000/);
        expect(job.text).toMatch(/'Toolpath Name = Cut Contour/);
        expect(job.paths.length).toBe(design.parts.length);
        // contour is closed
        const p = job.paths[0];
        expect(Math.hypot(p[0].x - p[p.length - 1].x, p[0].y - p[p.length - 1].y)).toBeLessThan(1e-3);
    });

    test("marks can also come from header comments", () => {
        const j = core.parseJob("' REGMARK 1, 0.5, 0.5\n' REGMARK 2, 23.5, 0.5\n'REGMARK 12.0, 11.5\nM2,1,1\nM2,2,2\n");
        expect(j.source).toBe("header");
        expect(j.marks).toEqual([
            { x: 0.5, y: 0.5 },
            { x: 23.5, y: 0.5 },
            { x: 12.0, y: 11.5 },
        ]);
        expect(j.removedMoves).toBe(0);
    });

    test("blank fields keep the previous coordinate; arcs are flagged", () => {
        const j = core.parseJob("J2,1,1\nM3,,4,-0.1\nMX,3\nCG,,5,5,1,1,T,1\n");
        expect(j.paths[0]).toEqual([
            { x: 1, y: 1 },
            { x: 1, y: 4 },
            { x: 3, y: 4 },
            { x: 5, y: 5 },
        ]);
        expect(j.hasArcs).toBe(true);
    });

    test("no marks -> none reported", () => {
        expect(core.parseJob("M2,1,1\n").marks).toEqual([]);
    });
});

describe("print registration: fit", () => {
    const marks = core.demoDesign().marks;
    const T = truth();
    const measured = marks.map((m) => core.apply(T, m));

    test("4 marks recover position, rotation, both scales and skew", () => {
        const f = core.fit(marks, measured);
        expect(f.kind).toBe("affine");
        expect(core.residuals(f, marks, measured).max).toBeLessThan(1e-9);
        const d = core.decompose(f);
        expect(d.rotation).toBeCloseTo(2.7, 6);
        expect(d.scaleX).toBeCloseTo(1.0031, 7);
        expect(d.scaleY).toBeCloseTo(0.9982, 7);
        expect(d.shear).toBeCloseTo(0.0015, 7);
        expect(d.mirrored).toBe(false);
    });

    test("2 marks give rotation + uniform scale; 1 mark position only", () => {
        const f2 = core.fit(marks.slice(0, 2), measured.slice(0, 2));
        expect(f2.kind).toBe("similarity");
        expect(core.residuals(f2, marks.slice(0, 2), measured.slice(0, 2)).max).toBeLessThan(1e-9);
        const f1 = core.fit(marks.slice(0, 1), measured.slice(0, 1));
        expect(f1.kind).toBe("translation");
    });

    test("marks in a line fall back to similarity", () => {
        const src = [
            { x: 0, y: 0 },
            { x: 5, y: 0 },
            { x: 10, y: 0 },
        ];
        const f = core.fit(
            src,
            src.map((p) => core.apply(T, p))
        );
        expect(f.kind).toBe("similarity");
    });

    test("residual exposes a bad mark", () => {
        const bad = measured.map((p) => ({ x: p.x, y: p.y }));
        bad[2].x += 0.05;
        const f = core.fit(marks, bad);
        expect(core.residuals(f, marks, bad).max).toBeGreaterThan(0.01);
    });

    test("visit order chains nearest neighbours from the first mark", () => {
        expect(core.visitOrder(marks, 0)).toEqual([0, 3, 2, 1]);
    });
});

describe("print registration: what is handed to the engine", () => {
    const pts = [
        { x: 0, y: 0 },
        { x: 10.4, y: 0.6 },
        { x: 0.6, y: 7.9 },
        { x: 48, y: 96 },
        { x: -3, y: 17.25 },
    ];

    test("the registration queued with the job is the fit, and the engine accepts it", () => {
        const T = truth();
        const r = engineReg.normalize(core.toRegistration(T, "in"));
        expect(r.units).toBe("in");
        pts.forEach((p) => {
            const want = core.apply(T, p);
            const got = engineReg.apply(r, p.x, p.y);
            expect(Math.hypot(got.x - want.x, got.y - want.y)).toBeLessThan(1e-12);
        });
        expect(core.toRegistration(T, "mm").units).toBe("mm");
    });

    // a machine with its own transforms set (squareness shear, a scale tweak, ...)
    const machineT = {
        rotate: { apply: true, angle: 0.35, x: 1, y: 2 },
        shearx: { apply: true, angle: 0.2 },
        sheary: { apply: false, angle: 0 },
        scale: { apply: true, scalex: 1.0004, scaley: 0.9997, scalez: 1, x: 0, y: 0, z: 0 },
        move: { apply: true, x: 0.125, y: -0.05, z: 0 },
    };

    test("machineForward matches the engine's own transform code", () => {
        pts.forEach((p) => {
            const want = engineTransform(machineT, p.x, p.y);
            const got = core.machineForward(machineT, p);
            expect(Math.hypot(got.x - want.x, got.y - want.y)).toBeLessThan(1e-9);
        });
    });

    test("machineInverse undoes it, so marks are fitted in the coordinates a file asks in", () => {
        pts.forEach((p) => {
            const reported = engineTransform(machineT, p.x, p.y);
            const asked = core.machineInverse(machineT, reported);
            expect(Math.hypot(asked.x - p.x, asked.y - p.y)).toBeLessThan(1e-9);
        });
    });

    test("no transforms set: positions pass straight through", () => {
        const off = { rotate: { apply: false, angle: 5 }, shearx: { apply: false, angle: 1 }, move: { apply: false, x: 3, y: 3 } };
        expect(core.machineActive(off)).toBe(false);
        expect(core.machineActive(null)).toBe(false);
        expect(core.machineActive(machineT)).toBe(true);
        expect(core.machineInverse(off, { x: 3, y: 4 })).toEqual({ x: 3, y: 4 });
        expect(core.machineInverse(null, { x: 3, y: 4 })).toEqual({ x: 3, y: 4 });
    });

    test("on a machine with transforms, the registered cut still lands on the print", () => {
        // marks as the machine reports them when the bit is over each one
        const T = truth(); // file -> true spot on the table, in reported coordinates
        const marks = [
            { x: 0.5, y: 0.5 },
            { x: 23.5, y: 0.5 },
            { x: 23.5, y: 11.5 },
            { x: 0.5, y: 11.5 },
        ];
        const reported = marks.map((m) => core.apply(T, m));
        const asked = reported.map((r) => core.machineInverse(machineT, r));
        const r = engineReg.normalize(core.toRegistration(core.fit(marks, asked), "in"));
        // the engine registers the move, then applies the machine transforms
        pts.forEach((p) => {
            const onSheet = engineReg.apply(r, p.x, p.y);
            const cut = engineTransform(machineT, onSheet.x, onSheet.y);
            const want = core.apply(T, p);
            expect(Math.hypot(cut.x - want.x, cut.y - want.y)).toBeLessThan(1e-6);
        });
    });
});

describe("print registration: dot detection", () => {
    const cam = { pxPerUnit: 400, rotDeg: 0, width: 640, height: 480 };

    test("sub-pixel centre of a clean dot", () => {
        const img = renderFrame([{ x: 0.0513, y: -0.0277 }], { x: 0, y: 0 }, cam, 0.25);
        const r = core.detectDot(img, { expectedDiaPx: 100 });
        expect(r.found).toBe(true);
        const off = core.pixelToOffset(r.u, r.v, cam);
        expect(Math.hypot(off.x - 0.0513, off.y + 0.0277)).toBeLessThan(0.0005);
        expect(r.diaPx).toBeGreaterThan(95);
        expect(r.diaPx).toBeLessThan(105);
    });

    test("noise and printed clutter do not pull the centre", () => {
        const img = renderFrame([{ x: -0.21, y: 0.09 }], { x: 0, y: 0 }, cam, 0.25, { noise: 30, clutter: true });
        const r = core.detectDot(img, { expectedDiaPx: 100 });
        expect(r.found).toBe(true);
        const off = core.pixelToOffset(r.u, r.v, cam);
        expect(Math.hypot(off.x + 0.21, off.y - 0.09)).toBeLessThan(0.001);
    });

    test("rotated camera maps pixels back to table directions", () => {
        const rc = { pxPerUnit: 400, rotDeg: 37, width: 640, height: 480 };
        const img = renderFrame([{ x: 0.3, y: 0.2 }], { x: 0, y: 0 }, rc, 0.25);
        const r = core.detectDot(img, { expectedDiaPx: 100 });
        const off = core.pixelToOffset(r.u, r.v, rc);
        expect(Math.hypot(off.x - 0.3, off.y - 0.2)).toBeLessThan(0.0005);
    });

    test("blank sheet, cut-off dot and wrong-size blob are rejected", () => {
        expect(core.detectDot(renderFrame([], { x: 0, y: 0 }, cam, 0.25, { noise: 20 })).found).toBe(false);
        expect(core.detectDot(renderFrame([{ x: 0.8, y: 0 }], { x: 0, y: 0 }, cam, 0.25)).found).toBe(false);
        expect(core.detectDot(renderFrame([{ x: 0, y: 0 }], { x: 0, y: 0 }, cam, 0.6), { expectedDiaPx: 100 }).found).toBe(false);
    });
});

describe("print registration: end to end on a simulated sheet", () => {
    test("camera visits each mark, cut lands on the print", () => {
        const design = core.demoDesign();
        const job = core.parseJob(core.demoSBP(design));
        const T = truth();
        const cam = { pxPerUnit: 400, rotDeg: 1.5, width: 640, height: 480 };
        const dots = job.marks.map((m) => core.apply(T, m));

        // operator parks the camera roughly over mark 1
        let camPos = { x: dots[0].x + 0.18, y: dots[0].y - 0.11 };
        const found = [];
        const order = core.visitOrder(job.marks, 0);
        order.forEach((idx, n) => {
            if (n > 0) {
                const src = found.map((f) => job.marks[f.idx]);
                const dst = found.map((f) => f.pos);
                const est = n === 1 ? core.fitTranslation(src, dst) : core.fitSimilarity(src, dst);
                camPos = core.apply(est, job.marks[idx]);
            }
            let pos;
            for (let pass = 0; pass < 2; pass++) {
                const r = core.detectDot(renderFrame(dots, camPos, cam, design.markDia, { noise: 20 }), { expectedDiaPx: 100 });
                expect(r.found).toBe(true);
                const off = core.pixelToOffset(r.u, r.v, cam);
                pos = { x: camPos.x + off.x, y: camPos.y + off.y };
                camPos = pos; // re-centre and shoot again
            }
            found.push({ idx, pos });
        });

        const src = found.map((f) => job.marks[f.idx]);
        const dst = found.map((f) => f.pos);
        const fit = core.fit(src, dst);
        expect(core.residuals(fit, src, dst).rms).toBeLessThan(0.001);

        const r = engineReg.normalize(core.toRegistration(fit, "in"));
        let worst = 0;
        job.paths.forEach((path) =>
            path.forEach((p) => {
                const want = core.apply(T, p);
                const got = engineReg.apply(r, p.x, p.y);
                worst = Math.max(worst, Math.hypot(got.x - want.x, got.y - want.y));
            })
        );
        expect(worst).toBeLessThan(0.002); // 2 thou, on a 400 px/in camera
    });
});
