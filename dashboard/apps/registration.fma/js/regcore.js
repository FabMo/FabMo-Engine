/*
 * Print Registration — core maths (no DOM, no FabMo calls).
 *
 * Loaded by the app as window.RegCore and by jest via require(), so the
 * mark parsing, dot detection, fitting and the mapping onto the engine's
 * OpenSBP transforms are all testable off the machine.
 *
 * Conventions
 *   - "design" coordinates: the job file's own XY (where the marks are
 *     supposed to be).
 *   - "table" coordinates: machine work XY (what the DRO shows).
 *   - A fit is { a, b, c, d, tx, ty }:  X = a*x + b*y + tx,  Y = c*x + d*y + ty
 *     taking design -> table.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.RegCore = factory();
    }
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    var REGMARK_NAME = /reg(istration)?[\s_-]*marks?/i;
    var TOOLPATH_NAME = /^'\s*toolpath\s*name\s*=\s*(.*)$/i;
    var HEADER_MARK = /^'\s*regmark\b(.*)$/i;
    var ARC_CMDS = { CG: 1, CA: 1, CC: 1, CP: 1 };

    // ------------------------------------------------------------------
    // Job parsing
    // ------------------------------------------------------------------

    function num(s) {
        if (s === undefined) return undefined;
        s = String(s).trim();
        if (s === "") return undefined;
        var v = Number(s);
        return isNaN(v) ? undefined : v;
    }

    function addUnique(list, x, y) {
        for (var i = 0; i < list.length; i++) {
            if (Math.abs(list[i].x - x) < 1e-4 && Math.abs(list[i].y - y) < 1e-4) return;
        }
        list.push({ x: x, y: y });
    }

    /*
     * Read an SBP job. Marks come from either
     *   - a toolpath whose name contains "Regmarks" / "Registration Marks"
     *     (the CAM-agnostic route: drill-toolpath the mark circles), or
     *   - header comments:  ' REGMARK 1, 0.5, 0.5
     * Returns the marks, the cut geometry as polylines (for preview), and
     * the job text with the regmark toolpath's motion removed so the
     * machine does not drill the printed dots.
     */
    function parseJob(text) {
        var lines = String(text).split(/\r?\n/);
        var x = 0,
            y = 0;
        var inMarks = false;
        var feedMarks = [],
            jogMarks = [],
            headerMarks = [];
        var paths = [],
            cur = null;
        var out = [];
        var hasArcs = false,
            unsupported = false,
            removed = 0;

        lines.forEach(function (raw) {
            var line = raw.trim();
            var m;
            if (line.charAt(0) === "'") {
                if ((m = TOOLPATH_NAME.exec(line))) {
                    inMarks = REGMARK_NAME.test(m[1]);
                    cur = null;
                } else if ((m = HEADER_MARK.exec(line))) {
                    var nums = (m[1].match(/-?\d*\.?\d+/g) || []).map(Number);
                    if (nums.length >= 3) addUnique(headerMarks, nums[1], nums[2]);
                    else if (nums.length === 2) addUnique(headerMarks, nums[0], nums[1]);
                }
                out.push(raw);
                return;
            }
            var code = line.split("'")[0];
            var parts = code.split(",");
            var cmd = parts[0].trim().toUpperCase();
            var isMove = /^[MJ][2-6XYZ]$/.test(cmd);
            var isArc = !!ARC_CMDS[cmd];
            if (!isMove && !isArc) {
                // variables, macros, GOTOs: positions can no longer be
                // followed exactly from the text alone
                if (/^(GOTO|GOSUB|IF\b|FP)/i.test(cmd)) unsupported = true;
                out.push(raw);
                return;
            }
            var nx = x,
                ny = y,
                xy = false;
            if (isArc) {
                hasArcs = true;
                // CG, dia, endX, endY, I, J, ...
                if (cmd === "CG") {
                    if (num(parts[2]) !== undefined) nx = num(parts[2]);
                    if (num(parts[3]) !== undefined) ny = num(parts[3]);
                    xy = true;
                }
            } else {
                var ax = cmd.charAt(1);
                if (ax === "X") {
                    if (num(parts[1]) !== undefined) nx = num(parts[1]);
                    xy = true;
                } else if (ax === "Y") {
                    if (num(parts[1]) !== undefined) ny = num(parts[1]);
                    xy = true;
                } else if (ax !== "Z") {
                    if (num(parts[1]) !== undefined) nx = num(parts[1]);
                    if (num(parts[2]) !== undefined) ny = num(parts[2]);
                    xy = true;
                }
            }
            var feed = cmd.charAt(0) === "M" || isArc;
            if (inMarks) {
                if (feed) addUnique(feedMarks, nx, ny);
                else if (xy) addUnique(jogMarks, nx, ny);
                removed++;
            } else {
                if (feed && xy) {
                    if (!cur) {
                        cur = [{ x: x, y: y }];
                        paths.push(cur);
                    }
                    cur.push({ x: nx, y: ny });
                } else if (!feed && xy) {
                    cur = null;
                }
                out.push(raw);
            }
            x = nx;
            y = ny;
        });

        var marks = feedMarks.length ? feedMarks : jogMarks;
        var source = marks.length ? "toolpath" : null;
        if (!marks.length && headerMarks.length) {
            marks = headerMarks;
            source = "header";
        }
        paths = paths.filter(function (p) {
            return p.length > 1;
        });
        return {
            marks: marks,
            source: source,
            paths: paths,
            hasArcs: hasArcs,
            unsupported: unsupported,
            removedMoves: removed,
            text: out.join("\n"),
        };
    }

    // ------------------------------------------------------------------
    // Fitting
    // ------------------------------------------------------------------

    function apply(fit, p) {
        return { x: fit.a * p.x + fit.b * p.y + fit.tx, y: fit.c * p.x + fit.d * p.y + fit.ty };
    }

    function identity() {
        return { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
    }

    function centroid(pts) {
        var sx = 0,
            sy = 0;
        pts.forEach(function (p) {
            sx += p.x;
            sy += p.y;
        });
        return { x: sx / pts.length, y: sy / pts.length };
    }

    // Position only (1 mark)
    function fitTranslation(src, dst) {
        var cs = centroid(src),
            cd = centroid(dst);
        return { a: 1, b: 0, c: 0, d: 1, tx: cd.x - cs.x, ty: cd.y - cs.y, kind: "translation" };
    }

    // Position + rotation + one uniform scale (2+ marks)
    function fitSimilarity(src, dst) {
        var cs = centroid(src),
            cd = centroid(dst);
        var A = 0,
            B = 0,
            D = 0;
        for (var i = 0; i < src.length; i++) {
            var px = src[i].x - cs.x,
                py = src[i].y - cs.y;
            var qx = dst[i].x - cd.x,
                qy = dst[i].y - cd.y;
            A += px * qx + py * qy;
            B += px * qy - py * qx;
            D += px * px + py * py;
        }
        if (D < 1e-12) return fitTranslation(src, dst);
        A /= D;
        B /= D;
        return {
            a: A,
            b: -B,
            c: B,
            d: A,
            tx: cd.x - (A * cs.x - B * cs.y),
            ty: cd.y - (B * cs.x + A * cs.y),
            kind: "similarity",
        };
    }

    // Full linear correction: position, rotation, X and Y scale, skew
    // (3+ marks that are not in a line). Least squares.
    function fitAffine(src, dst) {
        var cs = centroid(src),
            cd = centroid(dst);
        var sxx = 0,
            sxy = 0,
            syy = 0,
            ux = 0,
            uy = 0,
            vx = 0,
            vy = 0;
        for (var i = 0; i < src.length; i++) {
            var px = src[i].x - cs.x,
                py = src[i].y - cs.y;
            var qx = dst[i].x - cd.x,
                qy = dst[i].y - cd.y;
            sxx += px * px;
            sxy += px * py;
            syy += py * py;
            ux += px * qx;
            uy += py * qx;
            vx += px * qy;
            vy += py * qy;
        }
        var det = sxx * syy - sxy * sxy;
        // collinear (or too few) marks cannot pin down skew / second scale
        if (src.length < 3 || det < 1e-9 * (sxx + syy) * (sxx + syy)) return null;
        var a = (ux * syy - uy * sxy) / det;
        var b = (uy * sxx - ux * sxy) / det;
        var c = (vx * syy - vy * sxy) / det;
        var d = (vy * sxx - vx * sxy) / det;
        return {
            a: a,
            b: b,
            c: c,
            d: d,
            tx: cd.x - (a * cs.x + b * cs.y),
            ty: cd.y - (c * cs.x + d * cs.y),
            kind: "affine",
        };
    }

    // Best fit the marks allow.
    function fit(src, dst) {
        if (!src.length || src.length !== dst.length) return null;
        if (src.length === 1) return fitTranslation(src, dst);
        return fitAffine(src, dst) || fitSimilarity(src, dst);
    }

    function residuals(f, src, dst) {
        var each = [],
            sum = 0,
            max = 0;
        for (var i = 0; i < src.length; i++) {
            var p = apply(f, src[i]);
            var e = Math.hypot(p.x - dst[i].x, p.y - dst[i].y);
            each.push(e);
            sum += e * e;
            if (e > max) max = e;
        }
        return { each: each, rms: Math.sqrt(sum / Math.max(1, src.length)), max: max };
    }

    /*
     * Split a fit into the pieces a person recognises, in the same order
     * the engine applies its transforms:
     *     rotate (about 0,0)  ->  shear X  ->  scale X/Y  ->  move
     * i.e.  M = S * ShearX * R.  rotation is counter-clockwise degrees.
     */
    function decompose(f) {
        var phi = Math.atan2(f.c, f.d);
        var sy = Math.hypot(f.c, f.d);
        var cos = Math.cos(phi),
            sin = Math.sin(phi);
        var sx = f.a * cos - f.b * sin;
        var u01 = f.a * sin + f.b * cos;
        var k = sx !== 0 ? u01 / sx : 0;
        return {
            rotation: (phi * 180) / Math.PI,
            scaleX: sx,
            scaleY: sy,
            shear: k,
            skew: (Math.atan(k) * 180) / Math.PI,
            moveX: f.tx,
            moveY: f.ty,
            mirrored: sx <= 0,
        };
    }

    /*
     * The opensbp `transforms` config that reproduces a fit.
     * Engine sign conventions (runtime/opensbp/transformation.js): a
     * positive rotate angle is CLOCKWISE, and shearx's "angle" is used as
     * a plain factor, x += (-angle*pi/180) * y.
     * rotate.apply is always true: the engine only shears a move that has
     * both X and Y, and its rotate step is what fills in the missing one
     * for single-axis moves (MX, JY, ...).
     */
    function toEngineTransforms(f) {
        var d = decompose(f);
        var r = function (v, n) {
            var p = Math.pow(10, n);
            return Math.round(v * p) / p;
        };
        return {
            rotate: { apply: true, angle: r(-d.rotation, 6), x: 0, y: 0 },
            shearx: { apply: Math.abs(d.shear) > 1e-9, angle: r((-d.shear * 180) / Math.PI, 6) },
            sheary: { apply: false, angle: 0 },
            scale: {
                apply: Math.abs(d.scaleX - 1) > 1e-9 || Math.abs(d.scaleY - 1) > 1e-9,
                scalex: r(d.scaleX, 7),
                scaley: r(d.scaleY, 7),
                scalez: 1,
                x: 0,
                y: 0,
                z: 0,
            },
            move: { apply: true, x: r(d.moveX, 5), y: r(d.moveY, 5), z: 0 },
        };
    }

    function clearedTransforms() {
        return {
            rotate: { apply: false, angle: 0, x: 0, y: 0 },
            shearx: { apply: false, angle: 0 },
            sheary: { apply: false, angle: 0 },
            scale: { apply: false, scalex: 1, scaley: 1, scalez: 1, x: 0, y: 0, z: 0 },
            move: { apply: false, x: 0, y: 0, z: 0 },
        };
    }

    // Visit order: start at `first`, then always the nearest unvisited
    // mark, so each prediction leans on a close neighbour.
    function visitOrder(marks, first) {
        var order = [first || 0];
        while (order.length < marks.length) {
            var last = marks[order[order.length - 1]];
            var best = -1,
                bd = Infinity;
            for (var i = 0; i < marks.length; i++) {
                if (order.indexOf(i) >= 0) continue;
                var dd = Math.hypot(marks[i].x - last.x, marks[i].y - last.y);
                if (dd < bd) {
                    bd = dd;
                    best = i;
                }
            }
            order.push(best);
        }
        return order;
    }

    // ------------------------------------------------------------------
    // Camera model
    // ------------------------------------------------------------------
    // cam = { pxPerUnit, rotDeg, width, height }. (u, v) are pixels from
    // the image centre, u right, v down. With rotDeg = 0 image-up is +Y.

    function pixelToOffset(u, v, cam) {
        var r = ((cam.rotDeg || 0) * Math.PI) / 180;
        var x = u / cam.pxPerUnit,
            y = -v / cam.pxPerUnit;
        return { x: x * Math.cos(r) - y * Math.sin(r), y: x * Math.sin(r) + y * Math.cos(r) };
    }

    function offsetToPixel(dx, dy, cam) {
        var r = ((cam.rotDeg || 0) * Math.PI) / 180;
        var x = dx * Math.cos(r) + dy * Math.sin(r);
        var y = -dx * Math.sin(r) + dy * Math.cos(r);
        return { u: x * cam.pxPerUnit, v: -y * cam.pxPerUnit };
    }

    // ------------------------------------------------------------------
    // Dot detection
    // ------------------------------------------------------------------

    /*
     * Find a dark round dot in an RGBA frame ({data, width, height}, as
     * from canvas getImageData). opts.expectedDiaPx narrows the size
     * accepted. Returns the dot nearest the image centre:
     *   { found, x, y (pixels, sub-pixel), u, v (from centre), diaPx }
     */
    function detectDot(img, opts) {
        opts = opts || {};
        var w = img.width,
            h = img.height,
            n = w * h,
            d = img.data;
        var gray = new Uint8Array(n);
        var hist = new Uint32Array(256);
        var i, j;
        for (i = 0, j = 0; i < n; i++, j += 4) {
            var g = (d[j] * 299 + d[j + 1] * 587 + d[j + 2] * 114) / 1000;
            gray[i] = g;
            hist[gray[i]]++;
        }
        // Otsu threshold
        var total = 0;
        for (i = 0; i < 256; i++) total += i * hist[i];
        var wB = 0,
            sumB = 0,
            best = -1,
            thr = 127,
            mB = 0,
            mF = 255;
        for (i = 0; i < 256; i++) {
            wB += hist[i];
            if (!wB) continue;
            var wF = n - wB;
            if (!wF) break;
            sumB += i * hist[i];
            var m1 = sumB / wB,
                m2 = (total - sumB) / wF;
            var between = wB * wF * (m1 - m2) * (m1 - m2);
            if (between > best) {
                best = between;
                thr = i;
                mB = m1;
                mF = m2;
            }
        }
        var result = { found: false, threshold: thr, candidates: 0 };
        if (mF - mB < 40) return result; // flat frame: nothing printed here

        var label = new Uint8Array(n); // 0 unseen, 1 seen
        var stack = new Int32Array(n);
        var exp = opts.expectedDiaPx;
        var cx0 = w / 2,
            cy0 = h / 2;
        var pick = null;
        for (var start = 0; start < n; start++) {
            if (label[start] || gray[start] > thr) continue;
            var sp = 0;
            stack[sp++] = start;
            label[start] = 1;
            var area = 0,
                minx = w,
                maxx = 0,
                miny = h,
                maxy = 0;
            while (sp) {
                var p = stack[--sp];
                var px = p % w,
                    py = (p - px) / w;
                area++;
                if (px < minx) minx = px;
                if (px > maxx) maxx = px;
                if (py < miny) miny = py;
                if (py > maxy) maxy = py;
                if (px > 0 && !label[p - 1] && gray[p - 1] <= thr) {
                    label[p - 1] = 1;
                    stack[sp++] = p - 1;
                }
                if (px < w - 1 && !label[p + 1] && gray[p + 1] <= thr) {
                    label[p + 1] = 1;
                    stack[sp++] = p + 1;
                }
                if (py > 0 && !label[p - w] && gray[p - w] <= thr) {
                    label[p - w] = 1;
                    stack[sp++] = p - w;
                }
                if (py < h - 1 && !label[p + w] && gray[p + w] <= thr) {
                    label[p + w] = 1;
                    stack[sp++] = p + w;
                }
            }
            if (area < 30) continue;
            if (minx <= 0 || miny <= 0 || maxx >= w - 1 || maxy >= h - 1) continue; // cut off by the frame
            var bw = maxx - minx + 1,
                bh = maxy - miny + 1;
            var aspect = bw / bh;
            if (aspect < 0.8 || aspect > 1.25) continue;
            var fill = area / ((Math.PI / 4) * bw * bh);
            if (fill < 0.85 || fill > 1.12) continue;
            var dia = Math.sqrt((4 * area) / Math.PI);
            if (exp && (dia < 0.6 * exp || dia > 1.6 * exp)) continue;
            result.candidates++;
            var dist = Math.hypot((minx + maxx) / 2 - cx0, (miny + maxy) / 2 - cy0);
            if (!pick || dist < pick.dist) {
                pick = { dist: dist, minx: minx, maxx: maxx, miny: miny, maxy: maxy, dia: dia };
            }
        }
        if (!pick) return result;

        // Sub-pixel centre: darkness-weighted centroid over the blob and a
        // small rim, so the soft edge pixels contribute fractionally.
        var pad = 3;
        var x0 = Math.max(0, pick.minx - pad),
            x1 = Math.min(w - 1, pick.maxx + pad);
        var y0 = Math.max(0, pick.miny - pad),
            y1 = Math.min(h - 1, pick.maxy + pad);
        var lo = 255,
            hi = 0,
            xx,
            yy,
            gv;
        for (yy = y0; yy <= y1; yy++) {
            for (xx = x0; xx <= x1; xx++) {
                gv = gray[yy * w + xx];
                if (gv < lo) lo = gv;
                if (gv > hi) hi = gv;
            }
        }
        // robust dark / light levels: means either side of the threshold
        var sd = 0,
            nd = 0,
            sl = 0,
            nl = 0;
        for (yy = y0; yy <= y1; yy++) {
            for (xx = x0; xx <= x1; xx++) {
                gv = gray[yy * w + xx];
                if (gv <= thr) {
                    sd += gv;
                    nd++;
                } else {
                    sl += gv;
                    nl++;
                }
            }
        }
        var dark = nd ? sd / nd : lo,
            light = nl ? sl / nl : hi;
        var span = Math.max(1, light - dark);
        var sw = 0,
            swx = 0,
            swy = 0;
        for (yy = y0; yy <= y1; yy++) {
            for (xx = x0; xx <= x1; xx++) {
                var wt = (light - gray[yy * w + xx]) / span;
                if (wt <= 0.08) continue; // ignore background noise
                if (wt > 1) wt = 1;
                sw += wt;
                swx += wt * (xx + 0.5);
                swy += wt * (yy + 0.5);
            }
        }
        if (!sw) return result;
        result.found = true;
        result.x = swx / sw;
        result.y = swy / sw;
        result.u = result.x - w / 2;
        result.v = result.y - h / 2;
        result.diaPx = Math.sqrt((4 * sw) / Math.PI);
        return result;
    }

    // ------------------------------------------------------------------
    // Demo job (one geometry source for the SBP, the printable sheet and
    // the simulator)
    // ------------------------------------------------------------------

    function roundedRect(cx, cy, w, h, r, seg) {
        seg = seg || 12;
        var pts = [];
        var corners = [
            [cx + w / 2 - r, cy - h / 2 + r, -90],
            [cx + w / 2 - r, cy + h / 2 - r, 0],
            [cx - w / 2 + r, cy + h / 2 - r, 90],
            [cx - w / 2 + r, cy - h / 2 + r, 180],
        ];
        corners.forEach(function (c) {
            for (var i = 0; i <= seg; i++) {
                var a = ((c[2] + (90 * i) / seg) * Math.PI) / 180;
                pts.push({ x: c[0] + r * Math.cos(a), y: c[1] + r * Math.sin(a) });
            }
        });
        pts.push({ x: pts[0].x, y: pts[0].y });
        return pts;
    }

    function circle(cx, cy, r, seg) {
        seg = seg || 72;
        var pts = [];
        for (var i = 0; i <= seg; i++) {
            var a = (2 * Math.PI * i) / seg;
            pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
        }
        return pts;
    }

    // Letter sheet, landscape, inches. Origin = lower-left sheet corner.
    function demoDesign() {
        var bleed = 0.1; // cut line sits this far outside the printed edge
        return {
            units: "in",
            sheet: { w: 11, h: 8.5 },
            markDia: 0.25,
            bleed: bleed,
            marks: [
                { x: 0.6, y: 0.6 },
                { x: 10.4, y: 0.6 },
                { x: 10.4, y: 7.9 },
                { x: 0.6, y: 7.9 },
            ],
            parts: [
                { kind: "rrect", cx: 4.0, cy: 4.25, w: 5.6, h: 3.4, r: 0.6, color: "#1f6fb2", label: "PRINT + CUT" },
                { kind: "circle", cx: 8.55, cy: 4.25, r: 1.25, color: "#e2731c", label: "FabMo" },
            ],
        };
    }

    function partOutline(p, grow) {
        grow = grow || 0;
        if (p.kind === "circle") return circle(p.cx, p.cy, p.r + grow);
        return roundedRect(p.cx, p.cy, p.w + 2 * grow, p.h + 2 * grow, p.r + grow);
    }

    function f4(v) {
        return (Math.round(v * 10000) / 10000).toFixed(4);
    }

    function demoSBP(design, opts) {
        design = design || demoDesign();
        opts = opts || {};
        var safeZ = opts.safeZ !== undefined ? opts.safeZ : 0.5;
        var cutZ = opts.cutZ !== undefined ? opts.cutZ : -0.02;
        var L = [];
        L.push("'Print Registration demo job - letter sheet, inches");
        L.push("'Open this file in the Print Registration app. Run on its own it");
        L.push("'only hovers over the marks, then traces the cut lines.");
        L.push("'Z zero = top of the sheet. Cut depth " + cutZ + " (pen or drag knife).");
        L.push("SA");
        L.push("'");
        L.push("'Toolpath Name = Regmarks");
        L.push("'Tool Name   = Registration marks (" + design.markDia + " inch dots)");
        L.push("JZ," + f4(safeZ));
        design.marks.forEach(function (m) {
            L.push("J2," + f4(m.x) + "," + f4(m.y));
            L.push("M3," + f4(m.x) + "," + f4(m.y) + "," + f4(0.1));
            L.push("JZ," + f4(safeZ));
        });
        L.push("'");
        L.push("'Toolpath Name = Cut Contour");
        L.push("'Tool Name   = Pen / knife");
        design.parts.forEach(function (p) {
            var pts = partOutline(p, design.bleed);
            L.push("JZ," + f4(safeZ));
            L.push("J2," + f4(pts[0].x) + "," + f4(pts[0].y));
            L.push("MZ," + f4(cutZ));
            for (var i = 1; i < pts.length; i++) L.push("M2," + f4(pts[i].x) + "," + f4(pts[i].y));
        });
        L.push("JZ," + f4(safeZ));
        L.push("");
        return L.join("\n");
    }

    // Printable sheet. Marks and artwork only: the cut line is not printed.
    function demoSVG(design) {
        design = design || demoDesign();
        var H = design.sheet.h,
            W = design.sheet.w;
        var Y = function (y) {
            return f4(H - y);
        };
        var s = [];
        s.push(
            '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + 'in" height="' + H + 'in" viewBox="0 0 ' + W + " " + H + '">'
        );
        s.push('<rect width="' + W + '" height="' + H + '" fill="#fff"/>');
        design.parts.forEach(function (p) {
            var pts = partOutline(p, 0)
                .map(function (q) {
                    return f4(q.x) + "," + Y(q.y);
                })
                .join(" ");
            s.push('<polygon points="' + pts + '" fill="' + p.color + '"/>');
            var fs = p.kind === "circle" ? 0.42 : 0.62;
            s.push(
                '<text x="' + f4(p.cx) + '" y="' + f4(H - p.cy + fs * 0.35) + '" font-family="Helvetica, Arial, sans-serif" font-weight="bold" font-size="' +
                    fs + '" fill="#fff" text-anchor="middle">' + p.label + "</text>"
            );
        });
        design.marks.forEach(function (m) {
            s.push('<circle cx="' + f4(m.x) + '" cy="' + Y(m.y) + '" r="' + design.markDia / 2 + '" fill="#000"/>');
        });
        // scale check: a printer set to "fit to page" would spoil the demo
        s.push('<g stroke="#000" stroke-width="0.01" fill="none">');
        s.push('<path d="M3 ' + Y(1.0) + " H8 M3 " + Y(0.93) + " V" + Y(1.07) + " M8 " + Y(0.93) + " V" + Y(1.07) + '"/>');
        s.push("</g>");
        s.push(
            '<text x="5.5" y="' + Y(0.78) + '" font-family="Helvetica, Arial, sans-serif" font-size="0.13" text-anchor="middle" fill="#000">' +
                "This line is 5.000 in long. Print at 100% (actual size), landscape.</text>"
        );
        s.push(
            '<text x="5.5" y="' + Y(7.75) + '" font-family="Helvetica, Arial, sans-serif" font-size="0.16" text-anchor="middle" fill="#000">' +
                "FabMo Print Registration demo sheet - mark 1 is the lower-left dot</text>"
        );
        s.push("</svg>");
        return s.join("\n");
    }

    return {
        parseJob: parseJob,
        apply: apply,
        identity: identity,
        fit: fit,
        fitTranslation: fitTranslation,
        fitSimilarity: fitSimilarity,
        fitAffine: fitAffine,
        residuals: residuals,
        decompose: decompose,
        toEngineTransforms: toEngineTransforms,
        clearedTransforms: clearedTransforms,
        visitOrder: visitOrder,
        pixelToOffset: pixelToOffset,
        offsetToPixel: offsetToPixel,
        detectDot: detectDot,
        demoDesign: demoDesign,
        demoSBP: demoSBP,
        demoSVG: demoSVG,
        partOutline: partOutline,
    };
});
