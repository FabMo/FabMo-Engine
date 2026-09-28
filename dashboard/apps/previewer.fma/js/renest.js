/**
 * Renest core: reverse-engineer the individual parts in an OpenSBP toolpath
 * so they can be moved / rotated / duplicated / deleted without a CAM
 * round-trip. Ported from the ShopBot Labs renest app (labs.shopbottools.com
 * /apps/previewer/lib/{parse,analyze,emit}.mjs).
 *
 * Pipeline:
 *   parseSbp(text)         — tokenize + simulate modal XY/Z so every motion
 *                            line knows its start/end; raw text preserved.
 *   analyze(lines)         — segment cut episodes, group multi-pass episodes
 *                            into features, build the containment tree, and
 *                            detect the sheet outline.
 *   applyTransforms(...)   — re-emit the file with per-part affine transforms;
 *   insertDuplicates(...)    untouched lines are byte-identical.
 *
 * Episode = positioning jogs + plunge + cutting moves, ended by the next jog.
 * Ownership rule for translation: every XY-bearing jog belongs to the episode
 * that FOLLOWS it (it positions that cut); pure-Z retracts stay with the
 * episode they end so they travel with it.
 *
 * All linear tolerances are in inches; pass { scale: 25.4 } to analyze()
 * for millimeter files.
 */

'use strict';

var EPS = 1e-4;

var MOVE_CMDS = {
  M2: 1, M3: 1, M4: 1, M5: 1, MX: 1, MY: 1, MZ: 1,
  J2: 1, J3: 1, J4: 1, J5: 1, JX: 1, JY: 1, JZ: 1,
  CG: 1,
};

// ── parse ──────────────────────────────────────────────────────────────────

function parseSbp(text) {
  var rawLines = text.split(/\r?\n/);
  var lines = [];
  var pos = { x: 0, y: 0, z: 0 };
  var relative = false; // SA = absolute (default), SR = relative
  var usesRelative = false;

  for (var i = 0; i < rawLines.length; i++) {
    var raw = rawLines[i];
    var trimmed = raw.trim();
    var rec = { idx: i, raw: raw, cmd: null, params: null, from: null, to: null, isCut: false, isJog: false, hasXY: false };

    if (trimmed === '' || trimmed.charAt(0) === "'") {
      var m = trimmed.match(/^'\s*Toolpath Name\s*=\s*(.+)$/i);
      if (m) rec.toolpathName = m[1].trim();
      lines.push(rec);
      continue;
    }

    // strip inline comments (PartWorks: `SA <tab>'Set program...`)
    var code = trimmed;
    var q = code.indexOf("'");
    if (q > 0) code = code.slice(0, q).replace(/\s+$/, '');

    var parts = code.split(',');
    var cmd = parts[0].trim().toUpperCase();
    rec.cmd = cmd;
    rec.params = parts.slice(1).map(function (p) { return p.trim(); });

    if (cmd === 'SA') relative = false;
    else if (cmd === 'SR') { relative = true; usesRelative = true; }

    if (MOVE_CMDS[cmd]) {
      var from = { x: pos.x, y: pos.y, z: pos.z };
      var to = { x: pos.x, y: pos.y, z: pos.z };
      var num = function (s) { return (s === undefined || s === '' ? null : parseFloat(s)); };
      var p = rec.params.map(num);
      var set = function (axis, v) {
        if (v === null || isNaN(v)) return;
        to[axis] = relative ? pos[axis] + v : v;
      };

      switch (cmd) {
        case 'M2': case 'J2':
          set('x', p[0]); set('y', p[1]); break;
        case 'M3': case 'J3':
          set('x', p[0]); set('y', p[1]); set('z', p[2]); break;
        case 'M4': case 'J4': case 'M5': case 'J5':
          set('x', p[0]); set('y', p[1]); set('z', p[2]); break; // ignore A/B for footprint
        case 'MX': case 'JX': set('x', p[0]); break;
        case 'MY': case 'JY': set('y', p[0]); break;
        case 'MZ': case 'JZ': set('z', p[0]); break;
        case 'CG':
          // CG, diameter, Xend, Yend, I-off, J-off, T, Dir, ...
          // End XY absolute (SA mode); I/J center offsets are relative to start.
          set('x', p[1]); set('y', p[2]);
          rec.arc = { i: p[3] != null ? p[3] : 0, j: p[4] != null ? p[4] : 0, dir: p[6] != null ? p[6] : 1, dia: p[0] };
          break;
      }

      rec.from = from;
      rec.to = to;
      rec.isJog = cmd.charAt(0) === 'J';
      rec.isCut = !rec.isJog;
      rec.hasXY = to.x !== from.x || to.y !== from.y ||
        ['M2', 'M3', 'M4', 'M5', 'J2', 'J3', 'J4', 'J5', 'CG'].indexOf(cmd) >= 0;
      pos = to;
    }

    lines.push(rec);
  }

  return { lines: lines, usesRelative: usesRelative };
}

// Sample an arc line record into XY points (for footprint/containment work).
// Returns array of {x,y} including the end point, excluding the start.
function arcPoints(rec, maxSeg) {
  if (!maxSeg) maxSeg = 0.1;
  var from = rec.from, to = rec.to, arc = rec.arc;
  var cx = from.x + (arc.i || 0);
  var cy = from.y + (arc.j || 0);
  var r = Math.sqrt((from.x - cx) * (from.x - cx) + (from.y - cy) * (from.y - cy));
  if (r < 1e-9) return [{ x: to.x, y: to.y }];
  var a0 = Math.atan2(from.y - cy, from.x - cx);
  var a1 = Math.atan2(to.y - cy, to.x - cx);
  var cw = (arc.dir != null ? arc.dir : 1) >= 0; // ShopBot: 1 = CW, -1 = CCW
  var sweep = a1 - a0;
  if (cw && sweep >= -1e-9) sweep -= Math.PI * 2;
  if (!cw && sweep <= 1e-9) sweep += Math.PI * 2;
  // full circle: start == end
  if (Math.hypot(to.x - from.x, to.y - from.y) < 1e-6) sweep = cw ? -Math.PI * 2 : Math.PI * 2;
  var n = Math.max(4, Math.ceil((Math.abs(sweep) * r) / maxSeg));
  var pts = [];
  for (var k = 1; k <= n; k++) {
    var a = a0 + (sweep * k) / n;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  pts[pts.length - 1] = { x: to.x, y: to.y };
  return pts;
}

// ── analyze ────────────────────────────────────────────────────────────────

function segmentEpisodes(lines) {
  var episodes = [];
  var pendingJogs = []; // line idxs of XY-bearing jogs since last episode end
  var cur = null;

  var endEpisode = function () {
    if (cur && cur.cutIdxs.length) episodes.push(cur);
    cur = null;
  };

  var curLabel = null;
  for (var li = 0; li < lines.length; li++) {
    var rec = lines[li];
    if (rec.toolpathName) curLabel = rec.toolpathName;
    if (!rec.cmd) continue;
    if (rec.isJog) {
      // A jog that doesn't move in XY is a retract (PartWorks emits
      // `J3,x,y,safe` at the cut-end XY): it belongs to the episode it
      // ends — it must translate with it or the rapid starts below the
      // surface at the old location after a move.
      var pureZ = !rec.from ||
        (Math.abs(rec.to.x - rec.from.x) < EPS && Math.abs(rec.to.y - rec.from.y) < EPS);
      if (cur && pureZ) {
        if (rec.hasXY) cur.tailIdxs.push(rec.idx);
        continue; // stay open: a follow-on plunge at the same XY rejoins
      }
      endEpisode();
      if (rec.hasXY) pendingJogs.push(rec.idx);
      continue;
    }
    if (rec.isCut) {
      if (!cur) {
        cur = { jogIdxs: pendingJogs, cutIdxs: [], tailIdxs: [], label: curLabel };
        pendingJogs = [];
      }
      cur.cutIdxs.push(rec.idx);
    }
  }
  endEpisode();
  return episodes;
}

// Flatten an episode's cutting motion into an XY polyline (arcs sampled).
function episodePath(ep, lines) {
  var pts = [];
  var minZ = Infinity;
  for (var i = 0; i < ep.cutIdxs.length; i++) {
    var rec = lines[ep.cutIdxs[i]];
    if (!rec.from) continue;
    if (pts.length === 0) pts.push({ x: rec.from.x, y: rec.from.y });
    if (rec.cmd === 'CG') pts.push.apply(pts, arcPoints(rec));
    else if (rec.to.x !== rec.from.x || rec.to.y !== rec.from.y)
      pts.push({ x: rec.to.x, y: rec.to.y });
    if (rec.to.z < minZ) minZ = rec.to.z;
  }
  return { pts: pts, minZ: minZ };
}

function bboxOf(pts) {
  var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (var i = 0; i < pts.length; i++) {
    var p = pts[i];
    if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
  }
  return { x0: x0, y0: y0, x1: x1, y1: y1, w: x1 - x0, h: y1 - y0, area: Math.max(0, (x1 - x0) * (y1 - y0)) };
}

// Resample a polyline to roughly-even sample points for containment voting.
function samplePath(pts, target) {
  if (!target) target = 80;
  if (pts.length <= 2) return pts.slice();
  var len = 0, i;
  for (i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  var step = Math.max(len / target, 1e-6);
  var out = [pts[0]];
  var acc = 0;
  for (i = 1; i < pts.length; i++) {
    var a = { x: pts[i - 1].x, y: pts[i - 1].y }, b = pts[i];
    var seg = Math.hypot(b.x - a.x, b.y - a.y);
    while (acc + seg >= step) {
      var t = (step - acc) / seg;
      var p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      out.push(p);
      a.x = p.x; a.y = p.y;
      seg = Math.hypot(b.x - a.x, b.y - a.y);
      acc = 0;
    }
    acc += seg;
  }
  return out;
}

function cross(a, b, p) {
  return (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y);
}

function windingInside(p, poly) {
  var wn = 0;
  for (var i = 1; i < poly.length; i++) {
    var a = poly[i - 1], b = poly[i];
    if (a.y <= p.y) {
      if (b.y > p.y && cross(a, b, p) > 0) wn++;
    } else if (b.y <= p.y && cross(a, b, p) < 0) wn--;
  }
  return wn !== 0;
}

function distToPath(p, poly) {
  var best = Infinity;
  for (var i = 1; i < poly.length; i++) {
    var a = poly[i - 1], b = poly[i];
    var dx = b.x - a.x, dy = b.y - a.y;
    var L2 = dx * dx + dy * dy;
    var t = L2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    var d = Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
    if (d < best) best = d;
  }
  return best;
}

// Fraction of sample points inside (or within tol of) a closed polygon.
function containFrac(samples, poly, tol) {
  if (!samples.length) return 0;
  var inside = 0;
  for (var i = 0; i < samples.length; i++) {
    var p = samples[i];
    if (windingInside(p, poly)) inside++;
    else if (tol > 0 && distToPath(p, poly) <= tol) inside++;
  }
  return inside / samples.length;
}

/**
 * Full analysis. Returns { episodes, features, roots, sheetBucket, extent }.
 * Each feature: { id, episodes[], pts, samples, bbox, closed, minZ,
 *                 parent, children[], frac, ambiguous, kind, label }
 * kind: 'part' (top-level closed), 'sheet-outline', 'feature', 'loose'
 */
function analyze(lines, opts) {
  opts = opts || {};
  var scale = opts.scale || 1;                 // 1 = inches, 25.4 = mm file
  var tol = (opts.tol != null ? opts.tol : 0.15) * scale;  // containment slack ~ tool radius
  var assignThresh = opts.assignThresh != null ? opts.assignThresh : 0.6;
  var ambigLo = opts.ambigLo != null ? opts.ambigLo : 0.35;
  var i, f, ep;

  var episodes = segmentEpisodes(lines);
  for (i = 0; i < episodes.length; i++) {
    ep = episodes[i];
    var path = episodePath(ep, lines);
    ep.pts = path.pts;
    ep.minZ = path.minZ;
    ep.bbox = bboxOf(path.pts);
  }
  var cutEps = episodes.filter(function (e) { return e.pts.length >= 1; }); // 1 pt = drill/plunge

  // --- group identical-footprint episodes (multi-pass with retracts) ---
  var features = [];
  var groupTol = 0.01 * scale;
  for (i = 0; i < cutEps.length; i++) {
    ep = cutEps[i];
    f = null;
    for (var j = 0; j < features.length; j++) {
      var g = features[j];
      if (Math.abs(g.bbox.x0 - ep.bbox.x0) < groupTol && Math.abs(g.bbox.y0 - ep.bbox.y0) < groupTol &&
          Math.abs(g.bbox.x1 - ep.bbox.x1) < groupTol && Math.abs(g.bbox.y1 - ep.bbox.y1) < groupTol) {
        f = g; break;
      }
    }
    if (f) {
      f.episodes.push(ep);
      if (ep.minZ < f.minZ) f.minZ = ep.minZ;
    } else {
      features.push({
        id: features.length, episodes: [ep], pts: ep.pts, bbox: ep.bbox,
        minZ: ep.minZ, closed: false, parent: null, children: [],
        frac: 0, ambiguous: false, kind: 'feature', label: ep.label || null,
      });
    }
  }

  // a single toolpath name across the whole file carries no information
  var labelSet = {};
  var nLabels = 0;
  for (i = 0; i < features.length; i++) {
    if (features[i].label && !labelSet[features[i].label]) { labelSet[features[i].label] = 1; nLabels++; }
  }
  if (nLabels <= 1) for (i = 0; i < features.length; i++) features[i].label = null;

  var closeTol = 0.02 * scale;
  for (i = 0; i < features.length; i++) {
    f = features[i];
    var a = f.pts[0], b = f.pts[f.pts.length - 1];
    f.closed = f.pts.length > 3 && Math.hypot(a.x - b.x, a.y - b.y) < closeTol;
    f.samples = samplePath(f.pts.map(function (p) { return { x: p.x, y: p.y }; }));
    if (f.closed) {
      // downsampled closed polygon for live collision checks in the UI
      var poly = samplePath(f.pts.map(function (p) { return { x: p.x, y: p.y }; }), 240);
      var p0 = poly[0], pn = poly[poly.length - 1];
      if (Math.hypot(p0.x - pn.x, p0.y - pn.y) > 1e-9) poly.push({ x: p0.x, y: p0.y });
      f.collPoly = poly;
    }
  }

  // --- containment tree ---
  var containers = features.filter(function (x) { return x.closed; })
    .sort(function (p, q) { return p.bbox.area - q.bbox.area; });

  for (i = 0; i < features.length; i++) {
    f = features[i];
    var best = null, bestFrac = 0, second = 0;
    for (var ci = 0; ci < containers.length; ci++) {
      var c = containers[ci];
      if (c === f) continue;
      if (c.bbox.area <= f.bbox.area * 1.001) continue;
      // cheap bbox reject (with slack)
      if (f.bbox.x1 < c.bbox.x0 - tol || f.bbox.x0 > c.bbox.x1 + tol ||
          f.bbox.y1 < c.bbox.y0 - tol || f.bbox.y0 > c.bbox.y1 + tol) continue;
      var frac = containFrac(f.samples, c.pts, tol);
      if (!best && frac >= assignThresh) { best = c; bestFrac = frac; }
      else if (best && frac >= ambigLo && frac < assignThresh && c.bbox.area < best.bbox.area * 4) second = Math.max(second, frac);
      if (!best && frac >= ambigLo) second = Math.max(second, frac);
    }
    if (best) {
      f.parent = best; f.frac = bestFrac;
      best.children.push(f);
    } else if (second >= ambigLo) {
      f.ambiguous = true; // straddles containers without a clear owner
    }
  }

  // --- classify roots / sheet outline ---
  var roots = features.filter(function (x) { return !x.parent; });
  var allPts = [];
  for (i = 0; i < cutEps.length; i++) {
    allPts.push({ x: cutEps[i].bbox.x0, y: cutEps[i].bbox.y0 });
    allPts.push({ x: cutEps[i].bbox.x1, y: cutEps[i].bbox.y1 });
  }
  var allBbox = bboxOf(allPts);

  for (i = 0; i < roots.length; i++) {
    f = roots[i];
    if (!f.closed) { f.kind = 'loose'; continue; }
    var closedKids = f.children.filter(function (k) { return k.closed; });
    var coverage = allBbox.area > 0 ? f.bbox.area / allBbox.area : 0;
    // Coverage of the drawing alone can't tell a sheet from a lone part:
    // a single profile cutout with holes in it also spans ~the whole
    // drawing, and calling it a sheet strands the outline and breaks the
    // part into its holes. What distinguishes a sheet is that the closed
    // shapes nested on it fill a substantial share of its area (that's
    // the point of nesting), while holes are a small share of a part.
    var kidArea = 0;
    for (var ka = 0; ka < closedKids.length; ka++) kidArea += closedKids[ka].bbox.area;
    var kidFrac = f.bbox.area > 0 ? kidArea / f.bbox.area : 0;
    if (closedKids.length >= 2 && coverage >= 0.6 && kidFrac >= 0.25) {
      f.kind = 'sheet-outline';
      // promote children to parts in the default view
      for (var ki = 0; ki < f.children.length; ki++)
        if (f.children[ki].closed) f.children[ki].kind = 'part';
    } else {
      f.kind = 'part';
    }
  }
  // open path directly under sheet outline = sheet-level
  for (i = 0; i < features.length; i++) {
    f = features[i];
    if (f.parent && f.kind === 'feature' && f.parent.kind === 'sheet-outline' && !f.closed)
      f.kind = 'loose';
  }

  var sheetBucket = features.filter(function (x) {
    return x.kind === 'loose' || (x.ambiguous && !x.parent);
  });

  return { episodes: cutEps, features: features, roots: roots, sheetBucket: sheetBucket, extent: allBbox };
}

// The set of "parts" to present at the default selection depth.
function defaultParts(analysis) {
  return analysis.features.filter(function (f) { return f.kind === 'part'; });
}

// All line indexes owned by a feature's subtree (for translation/deletion).
function subtreeLineIdxs(feature) {
  var idxs = [];
  var walk = function (f) {
    for (var i = 0; i < f.episodes.length; i++) {
      var ep = f.episodes[i];
      idxs.push.apply(idxs, ep.jogIdxs);
      idxs.push.apply(idxs, ep.cutIdxs);
      if (ep.tailIdxs) idxs.push.apply(idxs, ep.tailIdxs);
    }
    for (var k = 0; k < f.children.length; k++) walk(f.children[k]);
  };
  walk(feature);
  return idxs.sort(function (a, b) { return a - b; });
}

// ── emit ───────────────────────────────────────────────────────────────────
//
// Apply affine transforms (rotate about pivot + translate) to owned lines and
// rebuild the file. Untouched lines re-emit byte-identical.
//
// Pure translation keeps the sparse/sticky-axis style of the source (only
// present X/Y fields shift). Rotation must resolve axes: sticky X/Y are
// filled from the tracked position, and axis-hold moves (MX/JX/MY/JY) become
// full XY moves (M2/J2) — an axis-hold under rotation is a different line in
// space otherwise. CG I/J center offsets are start-relative vectors: they
// rotate with the linear part of the transform and ignore translation.
// Handedness (dir) is preserved — we never mirror.

function fmt(n) {
  var r = Math.round(n * 1e6) / 1e6;
  return r === 0 ? '0' : String(r);
}

// affine transform: p' = (a·x − b·y + tx, b·x + a·y + ty)
var IDENT = { a: 1, b: 0, tx: 0, ty: 0 };

function makeTransform(t) {
  var dx = t.dx || 0, dy = t.dy || 0, deg = t.deg || 0, cx = t.cx || 0, cy = t.cy || 0;
  var r = (deg * Math.PI) / 180;
  var a = Math.cos(r), b = Math.sin(r);
  return { a: a, b: b, tx: cx - a * cx + b * cy + dx, ty: cy - b * cx - a * cy + dy };
}

// m2 ∘ m1 (apply m1 first)
function mulT(m2, m1) {
  return {
    a: m2.a * m1.a - m2.b * m1.b,
    b: m2.b * m1.a + m2.a * m1.b,
    tx: m2.a * m1.tx - m2.b * m1.ty + m2.tx,
    ty: m2.b * m1.tx + m2.a * m1.ty + m2.ty,
  };
}

function applyT(m, x, y) {
  return { x: m.a * x - m.b * y + m.tx, y: m.b * x + m.a * y + m.ty };
}

function invT(m) {
  var d = m.a * m.a + m.b * m.b;
  var a = m.a / d, b = -m.b / d;
  return { a: a, b: b, tx: -(a * m.tx - b * m.ty), ty: -(b * m.tx + a * m.ty) };
}

function isIdent(m) {
  return Math.abs(m.a - 1) < 1e-12 && Math.abs(m.b) < 1e-12 &&
    Math.abs(m.tx) < 1e-9 && Math.abs(m.ty) < 1e-9;
}

// X/Y param slots per command (0-based into params array).
var XY_SLOTS = {
  M2: [0, 1], J2: [0, 1],
  M3: [0, 1], J3: [0, 1],
  M4: [0, 1], J4: [0, 1],
  M5: [0, 1], J5: [0, 1],
  MX: [0, null], JX: [0, null],
  MY: [null, 0], JY: [null, 0],
  CG: [1, 2],
};

function rewriteLine(rec, m) {
  var rotated = Math.abs(m.b) > 1e-12 || Math.abs(m.a - 1) > 1e-12;
  var params = rec.params.slice();

  if (!rotated) {
    // pure translation: shift only the X/Y fields that are present
    var slots = XY_SLOTS[rec.cmd];
    var shift = function (slot, d) {
      if (slot === null) return;
      var v = params[slot];
      if (v === undefined || v === '' || v === ' ') return; // sticky axis carries
      var n = parseFloat(v);
      if (isNaN(n)) return; // &variable or expression — leave alone
      params[slot] = fmt(n + d);
    };
    shift(slots[0], m.tx);
    shift(slots[1], m.ty);
    while (params.length && params[params.length - 1] === '') params.pop();
    return rec.cmd + ',' + params.join(',');
  }

  // rotation: resolve X/Y explicitly from the tracked end position
  var p = applyT(m, rec.to.x, rec.to.y);

  switch (rec.cmd) {
    case 'MX': case 'MY':
      return 'M2,' + fmt(p.x) + ',' + fmt(p.y);
    case 'JX': case 'JY':
      return 'J2,' + fmt(p.x) + ',' + fmt(p.y);
    case 'CG': {
      while (params.length < 5) params.push('');
      params[1] = fmt(p.x);
      params[2] = fmt(p.y);
      var ai = rec.arc ? (rec.arc.i || 0) : 0, aj = rec.arc ? (rec.arc.j || 0) : 0;
      params[3] = fmt(m.a * ai - m.b * aj); // center offset rotates as a vector,
      params[4] = fmt(m.b * ai + m.a * aj); // translation does not apply
      return 'CG,' + params.join(',');
    }
    default: {
      while (params.length < 2) params.push('');
      params[0] = fmt(p.x);
      params[1] = fmt(p.y);
      while (params.length && params[params.length - 1] === '') params.pop();
      return rec.cmd + ',' + params.join(',');
    }
  }
}

/**
 * jobs: [{ idxs: [lineIdx...], m: affine }] — each line owned by at most one
 * job (a feature's own episodes are assigned exactly once, with the full
 * ancestor chain composed into m).
 */
function applyTransforms(lines, jobs) {
  var byLine = {};
  for (var j = 0; j < jobs.length; j++)
    for (var i = 0; i < jobs[j].idxs.length; i++) byLine[jobs[j].idxs[i]] = jobs[j].m;

  return lines.map(function (rec) {
    var m = byLine[rec.idx];
    if (!m || !rec.cmd || !(rec.cmd in XY_SLOTS) || isIdent(m)) return rec.raw;
    return rewriteLine(rec, m);
  }).join('\n');
}

// ── duplication: emit a part's lines a second time, transformed ────────────
//
// A duplicate block is appended near the end of the program (before the
// trailing retract / spindle-off / END group). It carries its own safe-Z
// retract on both ends, replays any modal lines (speeds, toolchanges) that
// fell INSIDE the source span so multi-tool parts replicate faithfully, and
// re-asserts the span's entry state when the end-of-file state differs.

var MODAL_CMDS = { MS: 1, JS: 1, TR: 1, C6: 1, C7: 1, C9: 1, PAUSE: 1, JZ: 1 };

function modalStateAt(lines, end) {
  var s = { ms: null, tr: null, tool: null };
  for (var i = 0; i < end; i++) {
    var rec = lines[i];
    if (!rec.cmd) continue;
    if (rec.cmd === 'MS') s.ms = rec.raw;
    else if (rec.cmd === 'TR') s.tr = rec.raw;
    else if (rec.cmd.indexOf('&TOOL') === 0) s.tool = rec.raw;
  }
  return s;
}

function duplicateBlock(lines, dup, safeZ) {
  var idxs = dup.idxs, m = dup.m, label = dup.label;
  var owned = {};
  for (var i = 0; i < idxs.length; i++) owned[idxs[i]] = 1;
  var lo = Math.min.apply(null, idxs), hi = Math.max.apply(null, idxs);
  var atSpan = modalStateAt(lines, lo);
  var atEof = modalStateAt(lines, lines.length);

  var out = ["' == renest: duplicate of " + label + ' ==', 'JZ,' + safeZ];
  if (atSpan.tool && atSpan.tool !== atEof.tool) {
    out.push(atSpan.tool, 'C9');
    if (atSpan.tr) out.push(atSpan.tr);
    out.push('C6', 'PAUSE 2');
  }
  if (atSpan.ms && atSpan.ms !== atEof.ms) out.push(atSpan.ms);

  for (i = lo; i <= hi; i++) {
    var rec = lines[i];
    if (!rec.cmd) continue;
    if (owned[i])
      out.push(rec.cmd in XY_SLOTS ? rewriteLine(rec, m) : rec.raw);
    else if (MODAL_CMDS[rec.cmd] || rec.cmd.indexOf('&TOOL') === 0)
      out.push(rec.raw); // context switches + retracts between the part's episodes
  }
  out.push('JZ,' + safeZ);
  return out;
}

// Insertion point: before the trailing retract / C7 / END group.
function insertionIdx(lines) {
  var end = -1;
  for (var i = 0; i < lines.length; i++) if (lines[i].cmd === 'END') { end = i; break; }
  if (end < 0) return lines.length;
  var j = end - 1;
  while (j >= 0) {
    var rec = lines[j];
    if (!rec.cmd || rec.cmd === 'C7' || rec.cmd === 'JZ') { j--; continue; }
    break;
  }
  return j + 1;
}

/** Insert duplicate blocks into already-transformed output text. */
function insertDuplicates(lines, text, dups, safeZ) {
  var outLines = text.split(/\r?\n/); // normalize to LF, matching applyTransforms output
  var at = insertionIdx(lines);
  var blocks = [];
  for (var i = 0; i < dups.length; i++)
    blocks.push.apply(blocks, duplicateBlock(lines, dups[i], safeZ));
  var args = [at, 0].concat(blocks);
  outLines.splice.apply(outLines, args);
  return outLines.join('\n');
}

module.exports = {
  parseSbp: parseSbp,
  arcPoints: arcPoints,
  segmentEpisodes: segmentEpisodes,
  episodePath: episodePath,
  windingInside: windingInside,
  containFrac: containFrac,
  analyze: analyze,
  defaultParts: defaultParts,
  subtreeLineIdxs: subtreeLineIdxs,
  IDENT: IDENT,
  makeTransform: makeTransform,
  mulT: mulT,
  applyT: applyT,
  invT: invT,
  isIdent: isIdent,
  applyTransforms: applyTransforms,
  insertDuplicates: insertDuplicates,
};
