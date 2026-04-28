/*
 * runtime/bounds.js
 *
 * Computes the X/Y/Z extents of an uploaded job file without rendering it.
 * Used at submit time so the dashboard can warn that a job exceeds the
 * machine soft-limit envelope before the user opens the previewer.
 *
 * For .sbp files we run the SBP runtime's simulator to expand commands
 * (CG arcs, M3/M5 multi-axis, custom cuts) into gcode and then scan that.
 * For .nc/.gcode files we scan directly.
 */
"use strict";

var fs = require("fs");
var path = require("path");
var log = require("../log").logger("bounds");

// Walks gcode lines tracking modal absolute/relative motion and arc cardinal
// extremes. Returns { min: {x,y,z}, max: {x,y,z} } in the file's coordinate
// space (machine-coords are derived later via the active G55 offset).
function scanGCodeBounds(gcode) {
    var pos = { x: 0, y: 0, z: 0 };
    var min = { x: Infinity, y: Infinity, z: Infinity };
    var max = { x: -Infinity, y: -Infinity, z: -Infinity };
    var seen = false;
    var absolute = true; // G90

    function update(x, y, z) {
        if (x < min.x) min.x = x;
        if (x > max.x) max.x = x;
        if (y < min.y) min.y = y;
        if (y > max.y) max.y = y;
        if (z < min.z) min.z = z;
        if (z > max.z) max.z = z;
        seen = true;
    }

    var lines = gcode.split("\n");
    for (var i = 0; i < lines.length; i++) {
        // Strip comments — () inline and ; to end of line.
        var line = lines[i].toUpperCase().replace(/\([^)]*\)/g, "").replace(/;.*$/, "");

        if (/\bG90(?!\.)\b/.test(line)) absolute = true;
        if (/\bG91(?!\.)\b/.test(line)) absolute = false;

        // No \b — gcode often packs words together (e.g. `G0X1.5Y2.5`),
        // and \b doesn't fire between two word characters like `0` and `X`.
        var mx = line.match(/X(-?\d+(?:\.\d+)?)/);
        var my = line.match(/Y(-?\d+(?:\.\d+)?)/);
        var mz = line.match(/Z(-?\d+(?:\.\d+)?)/);
        if (!mx && !my && !mz) continue;

        var prev = { x: pos.x, y: pos.y, z: pos.z };
        var nx = mx ? parseFloat(mx[1]) : null;
        var ny = my ? parseFloat(my[1]) : null;
        var nz = mz ? parseFloat(mz[1]) : null;
        pos.x = nx === null ? pos.x : (absolute ? nx : pos.x + nx);
        pos.y = ny === null ? pos.y : (absolute ? ny : pos.y + ny);
        pos.z = nz === null ? pos.z : (absolute ? nz : pos.z + nz);

        update(pos.x, pos.y, pos.z);

        // Arc cardinal extremes — bounding box of an arc can extend past
        // its endpoints when the sweep crosses 0°, 90°, 180°, or 270°
        // around the arc center.
        var isArc = /\bG[23]\b/.test(line);
        if (!isArc) continue;
        var mi = line.match(/I(-?\d+(?:\.\d+)?)/);
        var mj = line.match(/J(-?\d+(?:\.\d+)?)/);
        if (!mi || !mj) continue; // R-form arcs not handled here
        var clockwise = /\bG2\b/.test(line);
        var cx = prev.x + parseFloat(mi[1]);
        var cy = prev.y + parseFloat(mj[1]);
        var r = Math.hypot(prev.x - cx, prev.y - cy);
        var a0 = Math.atan2(prev.y - cy, prev.x - cx);
        var a1 = Math.atan2(pos.y - cy, pos.x - cx);
        if (clockwise) {
            if (a1 >= a0) a1 -= 2 * Math.PI;
        } else {
            if (a1 <= a0) a1 += 2 * Math.PI;
        }
        var lo = Math.min(a0, a1);
        var hi = Math.max(a0, a1);
        for (var n = 0; n < 4; n++) {
            var base = (n * Math.PI) / 2;
            for (var k = -1; k <= 2; k++) {
                var a = base + k * 2 * Math.PI;
                if (a >= lo && a <= hi) {
                    update(cx + r * Math.cos(a), cy + r * Math.sin(a), pos.z);
                    break;
                }
            }
        }
    }

    return seen ? { min: min, max: max } : null;
}

// Compare bounds (work coords) against the soft-limit envelope (machine
// coords) using the active G55 offset. Returns
// { exceeds: bool, violations: [{axis, direction, overage}] }.
function checkAgainstEnvelope(bounds, envelope, g55) {
    var violations = [];
    if (!bounds || !envelope) return { exceeds: false, violations: violations };
    ["x", "y"].forEach(function (a) {
        var bMin = bounds.min[a];
        var bMax = bounds.max[a];
        if (typeof bMin !== "number" || typeof bMax !== "number") return;
        var off = (g55 && typeof g55[a] === "number") ? g55[a] : 0;
        var envMin = envelope[a + "min"];
        var envMax = envelope[a + "max"];
        if (typeof envMax === "number" && bMax + off > envMax) {
            violations.push({ axis: a, direction: "max", overage: bMax + off - envMax });
        }
        if (typeof envMin === "number" && bMin + off < envMin) {
            violations.push({ axis: a, direction: "min", overage: envMin - (bMin + off) });
        }
    });
    return { exceeds: violations.length > 0, violations: violations };
}

// Compute bounds for a job file (path on disk). Calls back with
// { bounds, durationMs } or an error.
function computeFileBounds(filePath, callback) {
    var t0 = Date.now();
    fs.readFile(filePath, "utf8", function (err, data) {
        if (err) return callback(err);
        var ext = path.extname(filePath).toLowerCase();

        if (ext === ".sbp") {
            // Lazy require to avoid circular deps at module load time.
            var SBPRuntime = require("./opensbp/opensbp").SBPRuntime;
            var runtime = new SBPRuntime();
            try {
                runtime.simulateString(data, 0, 0, 0, function (err, gcode) {
                    if (err) return callback(err);
                    callback(null, { bounds: scanGCodeBounds(gcode || ""), durationMs: Date.now() - t0 });
                });
            } catch (e) {
                callback(e);
            }
        } else {
            callback(null, { bounds: scanGCodeBounds(data), durationMs: Date.now() - t0 });
        }
    });
}

exports.scanGCodeBounds = scanGCodeBounds;
exports.checkAgainstEnvelope = checkAgainstEnvelope;
exports.computeFileBounds = computeFileBounds;
