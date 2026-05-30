/* eslint-disable no-undef */
/*
 * Planer — pure G-code generator.
 *
 * Cuts a rectangular area in a unidirectional raster aligned to the
 * grain direction. The bit's current XY is the near corner of the
 * rectangle. `length` extends in the grain direction; `width` extends
 * perpendicular (rotated +90° CCW from grain — so for a 0° grain the
 * area sweeps into +Y).
 *
 * Pass strategy: every cut runs in the same direction (along grain).
 * Between passes the bit retracts to safeZ, rapids back to the start
 * of the next row (offset across width by stepover), and plunges
 * again. The "lift and return" wastes time vs. bidirectional but
 * keeps cutting direction consistent so the cut never raises the
 * grain on a back-stroke.
 *
 * Depth is layered: all width-passes at depth1, then all at depth2,
 * etc. Skim planing is usually a single layer.
 */

var DEFAULTS = {
    width: 4,              // extent perpendicular to grain
    length: 4,             // extent along grain
    depth: 0.05,           // total Z removal
    plungePerPass: 0.05,   // Z step per layer
    cutterDiameter: 0.25,
    stepoverPct: 40,       // percent of cutter diameter per row (10..95)
    grainDeg: 0,           // 0 = +X, 90 = +Y
    feedRateXY: 60,
    feedRateZ: 30,
    safeZ: 0.5,
};

function fmt(n) { return Number(n).toFixed(4); }

function planer(opts) {
    var p = Object.assign({}, DEFAULTS, opts || {});

    if (!p.center) throw new Error("planer: center required");
    if (opts.startZ === undefined) {
        throw new Error("planer: startZ is required");
    }
    if (p.width <= 0)  throw new Error("planer: width must be > 0");
    if (p.length <= 0) throw new Error("planer: length must be > 0");
    if (p.depth <= 0)  throw new Error("planer: depth must be > 0");
    if (p.plungePerPass <= 0) {
        throw new Error("planer: plungePerPass must be > 0");
    }
    if (p.cutterDiameter <= 0) {
        throw new Error("planer: cutterDiameter must be > 0");
    }
    if (p.stepoverPct <= 0 || p.stepoverPct >= 100) {
        throw new Error("planer: stepoverPct must be in (0, 100)");
    }
    if (p.grainDeg < 0 || p.grainDeg > 90) {
        throw new Error("planer: grainDeg must be in [0, 90]");
    }

    var startZ = opts.startZ;
    var ang = p.grainDeg * Math.PI / 180;
    // Unit vector along grain (cut direction)…
    var gx = Math.cos(ang);
    var gy = Math.sin(ang);
    // …and perpendicular (rotated +90° CCW: −sin, cos).
    var px = -Math.sin(ang);
    var py = Math.cos(ang);

    // Stepover distance and number of width passes. Last pass is
    // clamped to the requested width so the cutter exactly covers the
    // edge rather than slightly overshooting.
    var stepDist = p.cutterDiameter * (p.stepoverPct / 100);
    var numWidthPasses = Math.ceil(p.width / stepDist) + 1;

    // Depth layers — distribute evenly across an integer pass count.
    var numLayers = Math.ceil(p.depth / p.plungePerPass);
    var depthPerLayer = p.depth / numLayers;

    var startX = p.center.x;
    var startY = p.center.y;

    var gcode = [];
    gcode.push("G90 G61");
    gcode.push("; Planer: width=" + fmt(p.width) +
               " length=" + fmt(p.length) +
               " depth=" + fmt(p.depth) +
               " grainDeg=" + fmt(p.grainDeg) +
               " stepoverPct=" + fmt(p.stepoverPct));

    gcode.push("G0 X" + fmt(startX) + " Y" + fmt(startY));
    gcode.push("G0 Z" + fmt(startZ + p.safeZ));

    for (var layer = 0; layer < numLayers; layer++) {
        var z = startZ - depthPerLayer * (layer + 1);

        for (var w = 0; w < numWidthPasses; w++) {
            var wOffset = Math.min(w * stepDist, p.width);
            var sx = startX + px * wOffset;
            var sy = startY + py * wOffset;
            var ex = sx + gx * p.length;
            var ey = sy + gy * p.length;

            // Position at the start of this row (already at safe Z),
            // plunge, cut along length, retract for the next row.
            gcode.push("G0 X" + fmt(sx) + " Y" + fmt(sy));
            gcode.push("G1 Z" + fmt(z) + " F" + fmt(p.feedRateZ));
            gcode.push("G1 X" + fmt(ex) + " Y" + fmt(ey) +
                       " F" + fmt(p.feedRateXY));
            gcode.push("G0 Z" + fmt(startZ + p.safeZ));
        }
    }

    return {
        gcode: gcode,
        summary: {
            type: "planer",
            corner: { x: startX, y: startY },
            width: p.width,
            length: p.length,
            depth: p.depth,
            grainDeg: p.grainDeg,
            stepoverPct: p.stepoverPct,
            stepDist: stepDist,
            numWidthPasses: numWidthPasses,
            numLayers: numLayers,
            depthPerLayer: depthPerLayer,
        },
    };
}

module.exports = {
    planer: planer,
};
