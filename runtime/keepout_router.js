/*
 * runtime/keepout_router.js
 *
 * Plans a detour for a jog (rapid) whose straight line would cross a
 * keep-out zone (machine.keepout.zones, drawn in the camera app). Jogs are
 * transport, not geometry — any path to the destination is as good as the
 * straight one — so we route around the zones: a visibility graph over the
 * inflated convex hulls of the active zones, shortest path by Dijkstra.
 *
 * Cutting moves are never routed here; they must run as written (the
 * pre-run job check warns about those).
 *
 * All planning happens in MACHINE coordinates; inputs/outputs are WORK
 * coordinates (the g55 offset is applied internally), matching what the
 * OpenSBP runtime tracks in cmd_posx/y/z.
 */
"use strict";

var bounds = require("./bounds");

// Convex hull (Andrew monotone chain). Points: [[x, y], ...]. Returns CCW.
function convexHull(points) {
    var pts = points
        .slice()
        .sort(function (a, b) {
            return a[0] - b[0] || a[1] - b[1];
        })
        .filter(function (p, i, arr) {
            return i === 0 || p[0] !== arr[i - 1][0] || p[1] !== arr[i - 1][1];
        });
    if (pts.length <= 2) return pts;
    function cross(o, a, b) {
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    }
    var lower = [];
    pts.forEach(function (p) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
        lower.push(p);
    });
    var upper = [];
    pts.slice().reverse().forEach(function (p) {
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
        upper.push(p);
    });
    lower.pop();
    upper.pop();
    return lower.concat(upper);
}

// Push each hull vertex outward by ~margin along the bisector of its two
// edge normals. Hull is CCW, so the outward normal of edge a→b is
// (dy, -dx) normalized... for CCW traversal the left side is inside, so
// outward is (b.y - a.y, -(b.x - a.x)) negated — verified by the tests.
function inflateHull(hull, margin) {
    var n = hull.length;
    if (n < 3) {
        // Degenerate (point/line) zone: a box around it
        var xs = hull.map(function (p) { return p[0]; });
        var ys = hull.map(function (p) { return p[1]; });
        var x0 = Math.min.apply(null, xs) - margin, x1 = Math.max.apply(null, xs) + margin;
        var y0 = Math.min.apply(null, ys) - margin, y1 = Math.max.apply(null, ys) + margin;
        return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    }
    function edgeNormal(a, b) {
        var dx = b[0] - a[0], dy = b[1] - a[1];
        var len = Math.hypot(dx, dy) || 1;
        // CCW polygon: interior is to the left of a→b, outward is to the right
        return [dy / len, -dx / len];
    }
    var out = [];
    for (var i = 0; i < n; i++) {
        var prev = hull[(i - 1 + n) % n], v = hull[i], next = hull[(i + 1) % n];
        var n1 = edgeNormal(prev, v), n2 = edgeNormal(v, next);
        var bx = n1[0] + n2[0], by = n1[1] + n2[1];
        var blen = Math.hypot(bx, by);
        if (blen < 1e-6) { bx = n1[0]; by = n1[1]; blen = 1; }
        // Scale so the offset along each edge normal is >= margin, capped
        // for very sharp corners
        var scale = Math.min(margin / (blen / 2), 3 * margin);
        out.push([v[0] + (bx / blen) * scale, v[1] + (by / blen) * scale]);
    }
    return out;
}

function zoneIds(zones) {
    return zones.map(function (z) {
        return z.id || z.type;
    });
}

// Plan a route for the jog start → end (WORK coords, {x, y, z}).
// Returns:
//   null                      — straight jog is fine, no detour needed
//   { blocked: true, zones }  — endpoint inside a zone / no route exists
//   { waypoints: [{x, y}...], zones } — intermediate WORK-coord waypoints
function planJog(start, end, zones, envelope, g55, margin) {
    margin = margin || 0.5;
    var gx = (g55 && g55.x) || 0, gy = (g55 && g55.y) || 0, gz = (g55 && g55.z) || 0;
    var sx = start.x + gx, sy = start.y + gy;
    var ex = end.x + gx, ey = end.y + gy;

    // Same Z gate as bounds.checkAgainstZones: a zone with a height is
    // cleared by a jog that stays at or above it; unzeroed Z (g55z exactly
    // 0) skips the gate conservatively.
    var zmin = Math.min(start.z, end.z) + gz;
    function zoneActive(z) {
        if (!z || (z.type !== "rect" && z.type !== "poly")) return false;
        if (typeof z.z === "number" && gz !== 0 && zmin >= z.z) return false;
        return true;
    }
    var active = (zones || []).filter(zoneActive);
    if (!active.length) return null;

    // Degenerate XY (pure Z / rotary jog): nothing to route around. Moving
    // up (or staying level) is always allowed — it's how a tool escapes a
    // zone footprint; plunging below a zone's height while inside it is
    // blocked.
    if (Math.abs(ex - sx) < 1e-9 && Math.abs(ey - sy) < 1e-9) {
        if (end.z >= start.z) return null;
        var plungeInto = active.filter(function (z) {
            return bounds.pointInZone(z, sx, sy);
        });
        return plungeInto.length ? { blocked: true, zones: zoneIds(plungeInto) } : null;
    }

    var crossed = active.filter(function (z) {
        return bounds.segmentHitsZone(z, sx, sy, ex, ey);
    });
    if (!crossed.length) return null;

    // An endpoint inside a zone can't be routed around
    var containing = active.filter(function (z) {
        return bounds.pointInZone(z, sx, sy) || bounds.pointInZone(z, ex, ey);
    });
    if (containing.length) return { blocked: true, zones: zoneIds(containing) };

    // Visibility graph: start, end, and the inflated hull vertices of every
    // active zone (not just the crossed ones — a detour around one zone must
    // not cut through another). Vertices outside the envelope or inside some
    // other zone are unusable.
    function inEnvelope(p) {
        var e = envelope || {};
        if (typeof e.xmin === "number" && p[0] < e.xmin) return false;
        if (typeof e.xmax === "number" && p[0] > e.xmax) return false;
        if (typeof e.ymin === "number" && p[1] < e.ymin) return false;
        if (typeof e.ymax === "number" && p[1] > e.ymax) return false;
        return true;
    }
    var nodes = [[sx, sy], [ex, ey]];
    active.forEach(function (z) {
        inflateHull(convexHull(bounds.zoneEdges(z)), margin).forEach(function (v) {
            if (!inEnvelope(v)) return;
            var insideOther = active.some(function (az) {
                return bounds.pointInZone(az, v[0], v[1]);
            });
            if (!insideOther) nodes.push(v);
        });
    });

    function edgeFree(a, b) {
        return !active.some(function (z) {
            return bounds.segmentHitsZone(z, a[0], a[1], b[0], b[1]);
        });
    }

    // Dijkstra over the implicit visibility graph
    var N = nodes.length;
    var dist = new Array(N).fill(Infinity);
    var prev = new Array(N).fill(-1);
    var done = new Array(N).fill(false);
    dist[0] = 0;
    for (;;) {
        var u = -1, best = Infinity;
        for (var i = 0; i < N; i++) {
            if (!done[i] && dist[i] < best) { best = dist[i]; u = i; }
        }
        if (u === -1 || u === 1) break;
        done[u] = true;
        for (var v = 0; v < N; v++) {
            if (done[v]) continue;
            var d = Math.hypot(nodes[v][0] - nodes[u][0], nodes[v][1] - nodes[u][1]);
            if (dist[u] + d < dist[v] && edgeFree(nodes[u], nodes[v])) {
                dist[v] = dist[u] + d;
                prev[v] = u;
            }
        }
    }
    if (dist[1] === Infinity) return { blocked: true, zones: zoneIds(crossed) };

    var order = [];
    for (var at = 1; at !== 0; at = prev[at]) order.unshift(at);
    // order = node indices from (first hop after start) ... 1(end); drop the
    // final end node — the caller emits the original target as the last leg.
    order.pop();
    var waypoints = order.map(function (idx) {
        return { x: nodes[idx][0] - gx, y: nodes[idx][1] - gy };
    });
    return { waypoints: waypoints, zones: zoneIds(crossed) };
}

exports.planJog = planJog;
exports._convexHull = convexHull;
exports._inflateHull = inflateHull;
