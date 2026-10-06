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

// Cap on the decimated toolpath polyline persisted with job bounds. The
// path exists so keep-out zone checks can test actual geometry instead of
// the bounding box; zones are clamp-sized, so sub-inch fidelity is plenty
// and the job record stays small (the jobs db is loaded whole at startup).
var PATH_MAX_POINTS = 600;

// Distance-thin a polyline to at most `cap` points, doubling the tolerance
// until it fits. Collinear interior points drop harmlessly; corners move by
// at most the final tolerance. First and last points always survive.
function decimatePath(path, cap) {
    if (path.length <= cap) return path;
    var tol = 0.05;
    var out = path;
    while (out.length > cap) {
        var kept = [out[0]];
        var last = out[0];
        for (var i = 1; i < out.length - 1; i++) {
            var p = out[i];
            if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= tol || Math.abs(p[2] - last[2]) >= tol) {
                kept.push(p);
                last = p;
            }
        }
        kept.push(out[out.length - 1]);
        out = kept;
        tol *= 2;
    }
    return out;
}

function round3(v) {
    return Math.round(v * 1000) / 1000;
}

// Walks gcode lines tracking modal absolute/relative motion and arc cardinal
// extremes. Returns { min, max, path } in the file's coordinate space
// (machine-coords are derived later via the active G55 offset). `path` is a
// decimated [[x, y, z], ...] polyline of the moves, with arcs sampled, for
// geometry-accurate keep-out checks.
function scanGCodeBounds(gcode) {
    var pos = { x: 0, y: 0, z: 0 };
    var min = { x: Infinity, y: Infinity, z: Infinity };
    var max = { x: -Infinity, y: -Infinity, z: -Infinity };
    var seen = false;
    var absolute = true; // G90
    var path = [[0, 0, 0]];

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
        var mi = isArc ? line.match(/I(-?\d+(?:\.\d+)?)/) : null;
        var mj = isArc ? line.match(/J(-?\d+(?:\.\d+)?)/) : null;
        if (!isArc || !mi || !mj) { // R-form arcs tracked as chords
            path.push([round3(pos.x), round3(pos.y), round3(pos.z)]);
            continue;
        }
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
        // Sample the sweep into the path (chords alone would cut the
        // corner of a zone the arc actually enters). ~15° steps.
        var sweep = a1 - a0;
        var steps = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 12)));
        for (var si = 1; si <= steps; si++) {
            var sa = a0 + (sweep * si) / steps;
            path.push([round3(cx + r * Math.cos(sa)), round3(cy + r * Math.sin(sa)), round3(pos.z)]);
        }
    }

    return seen ? { min: min, max: max, path: decimatePath(path, PATH_MAX_POINTS) } : null;
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

    // Z ceiling is fixed at machine_z = 0 (homed top of travel) regardless of
    // envelope.zmax — work-Z zero shifts every bit change, so the only stable
    // ceiling is the invariant table-base top. No Z min check: low-Z in a CAM
    // file is cut depth, which depends on bit length and would noise-fire on
    // normal jobs.
    // g55z of exactly 0 means Z has never been zeroed (a real zero always
    // lands at a fractional offset below the top prox) — skip the Z check
    // rather than flag every file's safe-height pullup.
    var bMaxZ = bounds.max.z;
    var offZ = (g55 && typeof g55.z === "number") ? g55.z : 0;
    if (typeof bMaxZ === "number" && offZ !== 0) {
        if (bMaxZ + offZ > 0) {
            violations.push({ axis: "z", direction: "max", overage: bMaxZ + offZ });
        }
    }

    // Zeroed or not, the file's own Z range is a hard constraint: if it spans
    // more than the machine's total Z travel, it goes out of bounds no matter
    // where Z is zeroed. Travel is ceiling (machine 0, per above — zmax is not
    // meaningful for Z) down to envelope.zmin.
    var bMinZ = bounds.min.z;
    if (
        typeof bMaxZ === "number" && typeof bMinZ === "number" &&
        typeof envelope.zmin === "number"
    ) {
        var zTravel = -envelope.zmin;
        if (zTravel > 0 && bMaxZ - bMinZ > zTravel) {
            violations.push({ axis: "z", direction: "span", overage: bMaxZ - bMinZ - zTravel });
        }
    }

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
                runtime.simulateString(data, 0, 0, 0, function (err, gcode, info) {
                    if (err) return callback(err);
                    var result = { bounds: scanGCodeBounds(gcode || ""), durationMs: Date.now() - t0 };
                    if (info && info.partial) result.partial = true;
                    callback(null, result);
                });
            } catch (e) {
                callback(e);
            }
        } else {
            callback(null, { bounds: scanGCodeBounds(data), durationMs: Date.now() - t0 });
        }
    });
}

// Compute bounds for in-memory code (no disk file). Used by the editor-run
// pre-check so code typed/pasted in the editor gets the same soft-limit
// scrutiny as submitted jobs. `runtime` is "sbp" or "gcode".
function computeStringBounds(code, runtime, callback) {
    var t0 = Date.now();
    if (typeof code !== "string") return callback(new Error("code must be a string"));
    var rt = (runtime || "gcode").toLowerCase();

    if (rt === "sbp" || rt === "opensbp") {
        var SBPRuntime = require("./opensbp/opensbp").SBPRuntime;
        var sbp = new SBPRuntime();
        try {
            sbp.simulateString(code, 0, 0, 0, function (err, gcode, info) {
                if (err) return callback(err);
                var result = { bounds: scanGCodeBounds(gcode || ""), durationMs: Date.now() - t0 };
                if (info && info.partial) result.partial = true;
                callback(null, result);
            });
        } catch (e) {
            callback(e);
        }
    } else {
        callback(null, { bounds: scanGCodeBounds(code), durationMs: Date.now() - t0 });
    }
}

// ---------------------------------------------------------------------------
// Keep-out zones (machine.keepout.zones, drawn in the camera app). Zones are
// stored in MACHINE coordinates:
//   { id, type: "rect", x0, y0, x1, y1 }
//   { id, type: "poly", pts: [[x, y], ...] }   closed polygon
// A zone may carry a numeric `z` (obstacle height in machine Z): moves whose
// Z stays at or above it clear the obstacle and don't violate. Without `z`
// the zone is treated as full-height. If Z has never been zeroed (g55z of
// exactly 0, same convention as the envelope check) the Z gate is skipped
// and the zone checked conservatively.

function pointInPoly(x, y, pts) {
    var inside = false;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        if (
            pts[i][1] > y !== pts[j][1] > y &&
            x < ((pts[j][0] - pts[i][0]) * (y - pts[i][1])) / (pts[j][1] - pts[i][1]) + pts[i][0]
        ) {
            inside = !inside;
        }
    }
    return inside;
}

function segsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
    function ccw(px, py, qx, qy, rx, ry) {
        return (qx - px) * (ry - py) - (qy - py) * (rx - px);
    }
    var d1 = ccw(cx, cy, dx, dy, ax, ay);
    var d2 = ccw(cx, cy, dx, dy, bx, by);
    var d3 = ccw(ax, ay, bx, by, cx, cy);
    var d4 = ccw(ax, ay, bx, by, dx, dy);
    return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

function zoneEdges(zone) {
    if (zone.type === "rect") {
        var x0 = Math.min(zone.x0, zone.x1), x1 = Math.max(zone.x0, zone.x1);
        var y0 = Math.min(zone.y0, zone.y1), y1 = Math.max(zone.y0, zone.y1);
        return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    }
    return zone.pts || [];
}

function pointInZone(zone, x, y) {
    if (zone.type === "rect") {
        return (
            x >= Math.min(zone.x0, zone.x1) && x <= Math.max(zone.x0, zone.x1) &&
            y >= Math.min(zone.y0, zone.y1) && y <= Math.max(zone.y0, zone.y1)
        );
    }
    return pointInPoly(x, y, zone.pts || []);
}

// Does the segment (ax,ay)→(bx,by) touch the zone? Endpoint inside, or
// crossing any boundary edge.
function segmentHitsZone(zone, ax, ay, bx, by) {
    if (pointInZone(zone, ax, ay) || pointInZone(zone, bx, by)) return true;
    var edges = zoneEdges(zone);
    for (var i = 0, j = edges.length - 1; i < edges.length; j = i++) {
        if (segsIntersect(ax, ay, bx, by, edges[j][0], edges[j][1], edges[i][0], edges[i][1])) return true;
    }
    return false;
}

// Test a job's stored path (work coords) against keep-out zones (machine
// coords) using the active G55 offset. Returns
// { enters, zones: [ids], approximate }. Jobs scanned before path storage
// existed fall back to a bounding-box overlap test (approximate: true).
function checkAgainstZones(jobBounds, zones, g55) {
    var result = { enters: false, zones: [], approximate: false };
    if (!jobBounds || !zones || !zones.length) return result;
    var offx = (g55 && typeof g55.x === "number") ? g55.x : 0;
    var offy = (g55 && typeof g55.y === "number") ? g55.y : 0;
    var offz = (g55 && typeof g55.z === "number") ? g55.z : 0;
    var path = jobBounds.path;

    zones.forEach(function (zone) {
        if (!zone || (zone.type !== "rect" && zone.type !== "poly")) return;
        var hit = false;
        if (path && path.length > 1) {
            for (var i = 1; i < path.length; i++) {
                var a = path[i - 1], b = path[i];
                // Z gate: a move that stays above the obstacle clears it
                if (typeof zone.z === "number" && offz !== 0 && Math.min(a[2], b[2]) + offz >= zone.z) continue;
                if (segmentHitsZone(zone, a[0] + offx, a[1] + offy, b[0] + offx, b[1] + offy)) {
                    hit = true;
                    break;
                }
            }
        } else if (jobBounds.min && jobBounds.max) {
            // No path stored — bounding-box overlap, conservatively
            var bbox = {
                type: "rect",
                x0: jobBounds.min.x + offx, y0: jobBounds.min.y + offy,
                x1: jobBounds.max.x + offx, y1: jobBounds.max.y + offy,
            };
            var edges = zoneEdges(zone);
            for (var k = 0; k < edges.length && !hit; k++) {
                if (pointInZone(bbox, edges[k][0], edges[k][1])) hit = true;
            }
            var bEdges = zoneEdges(bbox);
            for (var m = 0; m < bEdges.length && !hit; m++) {
                if (pointInZone(zone, bEdges[m][0], bEdges[m][1])) hit = true;
            }
            for (var p = 0, q = bEdges.length - 1; p < bEdges.length && !hit; q = p++) {
                for (var r = 0, s = edges.length - 1; r < edges.length && !hit; s = r++) {
                    if (segsIntersect(
                        bEdges[q][0], bEdges[q][1], bEdges[p][0], bEdges[p][1],
                        edges[s][0], edges[s][1], edges[r][0], edges[r][1]
                    )) hit = true;
                }
            }
            if (hit) result.approximate = true;
        }
        if (hit) result.zones.push(zone.id || zone.type);
    });

    result.enters = result.zones.length > 0;
    return result;
}

exports.scanGCodeBounds = scanGCodeBounds;
exports.checkAgainstEnvelope = checkAgainstEnvelope;
exports.checkAgainstZones = checkAgainstZones;
exports.computeFileBounds = computeFileBounds;
exports.computeStringBounds = computeStringBounds;
