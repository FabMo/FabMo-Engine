/*
 * Job-attached registration (print-and-cut).
 *
 * A registration is a 2D affine map from the coordinates a job file was
 * drawn in to where that sheet really lies on the table:
 *
 *     X' = a*x + b*y + tx
 *     Y' = c*x + d*y + ty
 *
 * It belongs to ONE job (db.Job.registration) and is deliberately separate
 * from the machine-wide opensbp `transforms` config:
 *   - `transforms` corrects the machine (squareness etc.) and applies to
 *     every move, forever, until someone changes the setting;
 *   - a registration corrects one sheet. It is applied only to the moves of
 *     the job's own top-level file (never to macros - tool changes, homing
 *     and the like stay in true machine/work coordinates), it runs BEFORE
 *     the machine transforms so the two compose, and it is never written to
 *     config, so there is nothing to clear after an abort, crash or restart.
 *
 * Pure maths, no engine dependencies - see test/opensbp.registration.test.js
 */

var MM_PER_INCH = 25.4;

// Sanity window for the stretch of either axis. A printed sheet is off by a
// few percent at the very most; anything outside this is a bad fit or a bad
// request, and cutting it would be worse than refusing it.
var MIN_STRETCH = 0.5;
var MAX_STRETCH = 2.0;

// Chord tolerance when an arc is broken into lines (see arcChords)
var ARC_TOLERANCE_IN = 0.0005;
var MAX_ARC_SEGMENTS = 4000;

function isNum(v) {
    return typeof v === "number" && isFinite(v);
}

// Validate and copy a registration. Returns the clean object, or null when
// given nothing. Throws an Error describing what is wrong otherwise.
function normalize(reg) {
    if (reg === undefined || reg === null || reg === "") return null;
    if (typeof reg === "string") {
        try {
            reg = JSON.parse(reg);
        } catch (e) {
            throw new Error("registration is not valid JSON");
        }
    }
    if (typeof reg !== "object") throw new Error("registration must be an object");
    var out = {};
    ["a", "b", "c", "d", "tx", "ty"].forEach(function (k) {
        var v = typeof reg[k] === "string" && reg[k].trim() !== "" ? Number(reg[k]) : reg[k];
        if (!isNum(v)) throw new Error("registration." + k + " must be a finite number");
        out[k] = v;
    });
    var det = out.a * out.d - out.b * out.c;
    if (!(det > 0)) {
        throw new Error("registration is mirrored or degenerate (determinant " + det + ")");
    }
    var sx = Math.hypot(out.a, out.c);
    var sy = Math.hypot(out.b, out.d);
    if (sx < MIN_STRETCH || sx > MAX_STRETCH || sy < MIN_STRETCH || sy > MAX_STRETCH) {
        throw new Error("registration stretch out of range (X " + sx.toFixed(4) + ", Y " + sy.toFixed(4) + ")");
    }
    if (reg.units !== "in" && reg.units !== "mm") {
        throw new Error('registration.units must be "in" or "mm"');
    }
    out.units = reg.units;
    return out;
}

// The same registration expressed for a runtime working in `units`.
// Only the translation carries units; the linear part is a pure ratio.
function inUnits(reg, units) {
    if (!reg || !units || units === reg.units) return reg;
    var k = units === "mm" ? MM_PER_INCH : 1 / MM_PER_INCH;
    return { a: reg.a, b: reg.b, c: reg.c, d: reg.d, tx: reg.tx * k, ty: reg.ty * k, units: units };
}

// file coordinates -> table coordinates
function apply(reg, x, y) {
    return { x: reg.a * x + reg.b * y + reg.tx, y: reg.c * x + reg.d * y + reg.ty };
}

// table coordinates -> file coordinates
function invert(reg, x, y) {
    var det = reg.a * reg.d - reg.b * reg.c;
    var px = x - reg.tx;
    var py = y - reg.ty;
    return { x: (reg.d * px - reg.b * py) / det, y: (-reg.c * px + reg.a * py) / det };
}

/*
 * Break a G2/G3 arc (XY plane, I/J centre offsets relative to the start)
 * into chord end points, all still in FILE coordinates.
 *
 * A sheet that is stretched differently in X and Y, or skewed, turns a
 * circle into an ellipse, which g-code arcs cannot express - so a registered
 * job never sends arcs: they are cut as short lines that the registration
 * then maps like any other move.
 *
 *   cw     - true for G2 (clockwise), false for G3
 *   start  - {x, y, z}   z may be undefined
 *   end    - {x, y, z}   z undefined = no Z motion (flat arc)
 *   i, j   - centre offset from start
 *   units  - "in" | "mm" (sets the chord tolerance)
 *
 * Returns [{x, y, z?}, ...]; the last point is exactly `end`.
 * As in g-code, an arc that ends where it starts is a full circle.
 */
function arcChords(cw, start, end, i, j, units) {
    i = i || 0;
    j = j || 0;
    var r0 = Math.hypot(i, j);
    if (!(r0 > 0)) throw new Error("Arc with zero radius");
    var cx = start.x + i;
    var cy = start.y + j;
    var r1 = Math.hypot(end.x - cx, end.y - cy);
    var a0 = Math.atan2(start.y - cy, start.x - cx);
    var a1 = r1 > 0 ? Math.atan2(end.y - cy, end.x - cx) : a0;
    var sweep = cw ? a0 - a1 : a1 - a0;
    while (sweep < 1e-9) sweep += 2 * Math.PI;
    while (sweep > 2 * Math.PI + 1e-9) sweep -= 2 * Math.PI;

    var tol = units === "mm" ? ARC_TOLERANCE_IN * MM_PER_INCH : ARC_TOLERANCE_IN;
    var r = Math.max(r0, r1);
    var step = 2 * Math.acos(Math.max(0, 1 - tol / r));
    if (!(step > 0) || step > Math.PI / 4) step = Math.PI / 4;
    var n = Math.max(1, Math.min(MAX_ARC_SEGMENTS, Math.ceil(sweep / step)));

    var helical = isNum(end.z) && isNum(start.z) && end.z !== start.z;
    var pts = [];
    for (var k = 1; k <= n; k++) {
        var t = k / n;
        var p;
        if (k === n) {
            p = { x: end.x, y: end.y };
        } else {
            var ang = cw ? a0 - sweep * t : a0 + sweep * t;
            // file rounding can leave start and end at slightly different
            // radii; blend so the last chord is not a visible step
            var rad = r0 + (r1 - r0) * t;
            p = { x: cx + rad * Math.cos(ang), y: cy + rad * Math.sin(ang) };
        }
        if (helical) p.z = start.z + (end.z - start.z) * t;
        else if (k === n && isNum(end.z)) p.z = end.z;
        pts.push(p);
    }
    return pts;
}

exports.normalize = normalize;
exports.inUnits = inUnits;
exports.apply = apply;
exports.invert = invert;
exports.arcChords = arcChords;
