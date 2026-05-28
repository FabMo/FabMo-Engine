/* eslint-disable no-undef */
/*
 * Pure G-code generator for a circular bore at a given center.
 *
 * Mode "pocket": clears the interior by spiralling concentric rings inward
 * from the perimeter, then plunges to the next depth pass and repeats.
 * Mode "perimeter": cuts only the outer circle at each depth — leaves a
 * slug in the middle.
 *
 * Parameters are absolute / work coords. Output is a flat array of G-code
 * lines plus a summary; no I/O, no engine coupling. Tested in isolation.
 */

var DEFAULTS = {
    diameter: 0.5,         // bore diameter (work piece)
    depth: 0.25,           // total cut depth below startZ (positive number)
    plungePerPass: 0.125,  // Z step per pass (positive)
    cutterDiameter: 0.25,  // tool diameter for compensation
    feedRateXY: 60,        // IPM
    feedRateZ: 30,         // IPM
    safeZ: 0.5,            // retract height above startZ
    mode: "pocket",        // "pocket" | "perimeter"
    pocketOverlap: 0.50,   // fraction of cutter diameter; stepOver = cutterDia * (1-overlap)
    direction: "cw",       // "cw" → G2, "ccw" → G3
};

function fmt(n) {
    return Number(n).toFixed(4);
}

function computeRings(pocketRadius, cutterDiameter, pocketOverlap) {
    if (pocketRadius <= 0) return [];
    var stepOver = cutterDiameter * (1 - pocketOverlap);
    if (stepOver <= 0) stepOver = cutterDiameter * 0.5;
    var rings = [];
    rings.push(pocketRadius);
    var r = pocketRadius - stepOver;
    while (r > 0) {
        rings.push(r);
        r -= stepOver;
    }
    return rings;
}

function circularBore(opts) {
    var p = {};
    for (var k in DEFAULTS) p[k] = DEFAULTS[k];
    for (var k2 in opts) p[k2] = opts[k2];

    if (!opts || !opts.center) {
        throw new Error("circularBore: center {x, y} is required");
    }
    if (opts.startZ === undefined) {
        throw new Error("circularBore: startZ is required");
    }
    var cx = opts.center.x;
    var cy = opts.center.y;
    var startZ = opts.startZ;

    if (p.diameter <= 0) throw new Error("circularBore: diameter must be > 0");
    if (p.depth <= 0) throw new Error("circularBore: depth must be > 0");
    if (p.plungePerPass <= 0) throw new Error("circularBore: plungePerPass must be > 0");
    if (p.cutterDiameter <= 0) throw new Error("circularBore: cutterDiameter must be > 0");

    var arcCmd = p.direction === "ccw" ? "G3" : "G2";
    var gcode = [];

    // Header — absolute mode, exact path stop. We don't change feedrate
    // modal directly; every motion line specifies F so it's explicit.
    gcode.push("; circular bore: dia=" + fmt(p.diameter) +
               " depth=" + fmt(p.depth) +
               " cutter=" + fmt(p.cutterDiameter) +
               " mode=" + p.mode);
    gcode.push("G90 G61");

    var tool = p.cutterDiameter;
    var pocketRadius = (p.diameter - tool) / 2;

    if (pocketRadius <= 0) {
        // Bore is smaller than (or equal to) the cutter — degenerate case.
        // A plain plunge at center is the closest sensible toolpath.
        gcode.push("; bore <= cutter dia; falling back to plunge-at-center");
        gcode.push("G0 Z" + fmt(startZ + p.safeZ));
        gcode.push("G0 X" + fmt(cx) + " Y" + fmt(cy));
        gcode.push("G1 Z" + fmt(startZ - p.depth) + " F" + fmt(p.feedRateZ));
        gcode.push("G0 Z" + fmt(startZ + p.safeZ));
        return {
            gcode: gcode,
            summary: {
                mode: "plunge",
                center: { x: cx, y: cy },
                depth: p.depth,
                numPasses: 1,
                numRings: 0,
            },
        };
    }

    var rings;
    if (p.mode === "perimeter") {
        rings = [pocketRadius];
    } else {
        rings = computeRings(pocketRadius, tool, p.pocketOverlap);
    }
    var outerRingX = cx + rings[0];

    // Compute depth schedule. Distribute depth evenly across the integer
    // number of passes so we don't take an awkward thin final cut.
    var numPasses = Math.ceil(p.depth / p.plungePerPass);
    var depthPerPass = p.depth / numPasses;

    // Retract + rapid to outer perimeter start.
    gcode.push("G0 Z" + fmt(startZ + p.safeZ));
    gcode.push("G0 X" + fmt(outerRingX) + " Y" + fmt(cy));
    // Bring Z down to startZ before plunging into stock.
    gcode.push("G0 Z" + fmt(startZ));

    for (var pass = 0; pass < numPasses; pass++) {
        var z = startZ - depthPerPass * (pass + 1);
        gcode.push("; pass " + (pass + 1) + "/" + numPasses + " z=" + fmt(z));
        // Plunge to this pass's depth at the outer ring start.
        gcode.push("G1 Z" + fmt(z) + " F" + fmt(p.feedRateZ));
        for (var ri = 0; ri < rings.length; ri++) {
            var r = rings[ri];
            var ringStartX = cx + r;
            if (ri > 0) {
                // Walk inward to the next ring's start point at cut feed.
                gcode.push("G1 X" + fmt(ringStartX) + " Y" + fmt(cy) +
                           " F" + fmt(p.feedRateXY));
            }
            // Full circle: end point == start point; I,J point from start
            // to center (i.e. -r, 0 since we're on the +X side).
            gcode.push(arcCmd +
                       " X" + fmt(ringStartX) +
                       " Y" + fmt(cy) +
                       " I" + fmt(-r) + " J" + fmt(0) +
                       " F" + fmt(p.feedRateXY));
        }
        if (pass < numPasses - 1) {
            // Return to outer perimeter at cut feed for the next plunge.
            gcode.push("G1 X" + fmt(outerRingX) + " Y" + fmt(cy) +
                       " F" + fmt(p.feedRateXY));
        }
    }

    // Final retract.
    gcode.push("G0 Z" + fmt(startZ + p.safeZ));

    return {
        gcode: gcode,
        summary: {
            mode: p.mode,
            center: { x: cx, y: cy },
            diameter: p.diameter,
            cutterDiameter: tool,
            depth: p.depth,
            depthPerPass: depthPerPass,
            numPasses: numPasses,
            numRings: rings.length,
            pocketRadius: pocketRadius,
            rings: rings,
        },
    };
}

module.exports = {
    circularBore: circularBore,
    computeRings: computeRings,
    DEFAULTS: DEFAULTS,
};
