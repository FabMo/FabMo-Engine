/* eslint-disable no-undef */
/*
 * Straight-line cut — pure G-code generator.
 *
 * Cuts a straight line from the current bit position outward, in the
 * +X / +Y quadrant. Angle is degrees from +X axis (0 = pure +X,
 * 90 = pure +Y, 45 = NE diagonal). Length is the Euclidean cut
 * distance.
 *
 * Pass strategy: bidirectional. Plunge at the current end, cut to the
 * other end, plunge again, cut back, etc. The cutter stays engaged in
 * the slot between passes — no retract-and-rapid between them, only
 * one final retract at the end. Halves the air-cut time vs. circular
 * bore's one-direction pattern (which has to come back to start to
 * follow the closed contour).
 */

var DEFAULTS = {
    length: 4,             // straight-line cut distance
    angleDeg: 0,           // 0 = +X, 90 = +Y
    depth: 0.25,           // total cut depth below startZ (positive)
    plungePerPass: 0.125,  // Z step per pass
    cutterDiameter: 0.25,  // tool diameter (not used for offset here)
    feedRateXY: 60,
    feedRateZ: 30,
    safeZ: 0.5,            // retract above startZ between passes
};

function fmt(n) { return Number(n).toFixed(4); }

function straightLine(opts) {
    var p = Object.assign({}, DEFAULTS, opts || {});

    if (!p.center) throw new Error("straightLine: center required");
    if (opts.startZ === undefined) {
        throw new Error("straightLine: startZ is required");
    }
    if (p.length <= 0) throw new Error("straightLine: length must be > 0");
    if (p.angleDeg < 0 || p.angleDeg > 90) {
        throw new Error("straightLine: angleDeg must be in [0, 90]");
    }
    if (p.depth <= 0) throw new Error("straightLine: depth must be > 0");
    if (p.plungePerPass <= 0) {
        throw new Error("straightLine: plungePerPass must be > 0");
    }

    var startZ = opts.startZ;
    var ang = p.angleDeg * Math.PI / 180;
    var endX = p.center.x + p.length * Math.cos(ang);
    var endY = p.center.y + p.length * Math.sin(ang);

    // Distribute depth evenly across an integer number of passes — gives
    // a slightly smaller-than-requested step rather than a too-thin
    // final pass.
    var numPasses = Math.ceil(p.depth / p.plungePerPass);
    var depthPerPass = p.depth / numPasses;

    var gcode = [];
    gcode.push("G90 G61");
    gcode.push("; Straight line: length=" + fmt(p.length) +
               " angleDeg=" + fmt(p.angleDeg) +
               " depth=" + fmt(p.depth));

    // Move to start (XY), then up to safe Z before the first plunge.
    gcode.push("G0 X" + fmt(p.center.x) + " Y" + fmt(p.center.y));
    gcode.push("G0 Z" + fmt(startZ + p.safeZ));

    // Bidirectional passes: stay in the slot between cuts. After an
    // odd number of cuts we're at the far end; after even, back at
    // start. The final retract happens at wherever the last cut ended.
    var atEnd = false;
    for (var pass = 0; pass < numPasses; pass++) {
        var z = startZ - depthPerPass * (pass + 1);
        gcode.push("G1 Z" + fmt(z) + " F" + fmt(p.feedRateZ));
        var targetX = atEnd ? p.center.x : endX;
        var targetY = atEnd ? p.center.y : endY;
        gcode.push("G1 X" + fmt(targetX) + " Y" + fmt(targetY) +
                   " F" + fmt(p.feedRateXY));
        atEnd = !atEnd;
    }
    // One retract at the end, from wherever we finished.
    gcode.push("G0 Z" + fmt(startZ + p.safeZ));

    return {
        gcode: gcode,
        summary: {
            type: "straight_line",
            start: { x: p.center.x, y: p.center.y },
            end: { x: endX, y: endY },
            length: p.length,
            angleDeg: p.angleDeg,
            depth: p.depth,
            depthPerPass: depthPerPass,
            numPasses: numPasses,
        },
    };
}

module.exports = {
    straightLine: straightLine,
};
