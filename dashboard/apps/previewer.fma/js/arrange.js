/**
 * Arrange mode — renest part editing inside the previewer.
 *
 * A 2D plan-view canvas overlays the 3D preview while active. The loaded
 * SBP is analyzed into parts (js/renest.js); the user drags parts to move
 * them, rotates in 90°/15° steps, duplicates, or deletes them. The parts
 * tree renders into the toolpath drawer, and app.js reads back the
 * rearranged SBP (untouched lines byte-identical) to submit as a new job.
 *
 * Adapted from the ShopBot Labs renest/previewer component (2D plan mode;
 * AR view and part scaling intentionally left out).
 */

'use strict';

var renest = require('./renest');

var PALETTE = ['#4f8ef7', '#f7a34f', '#4fc47f', '#e05a7a', '#a06ff7', '#38b6c4', '#c4a338', '#8a8f98'];

function Arrange(options) {
  var self = this;
  var opts = options || {};
  var host = opts.container;                 // #preview element
  var canvas = opts.canvas;                  // #arrange-canvas
  var ctx = canvas.getContext('2d');
  var treeEl = opts.treeEl || null;          // #parts-list in the drawer
  var t = opts.t || function (k, v) { return k; };
  var unitScale = opts.unitScale || 1;       // 1 = inches, 25.4 = mm file
  // Machine table bounds in job coordinates ({x0,y0,x1,y1}, envelope
  // minus the active work offset — same placement as the 3D table).
  var table = opts.table || null;

  var state = {
    fileName: null,
    text: null,
    lines: null,
    analysis: null,
    parts: [],             // top-level movable nodes (kind 'part')
    transforms: null,      // Map: feature -> {dx, dy, deg, cx, cy} (pivot = subtree center)
    warns: null,           // Map: part -> [reasons] from collision/bounds checks
    copies: [],            // duplicates: { isCopy, source, ...display fields }
    deleted: null,         // Set: features whose cuts are dropped from the export
    clipboard: null,       // part (or copy) captured by Ctrl+C
    selected: null,        // selected feature node (part or drilled-down child)
    view: { x: 0, y: 0, scale: 30 }, // world->screen: sx = (wx - x) * scale
    drag: null,
  };
  var active = false;

  function setStatus(msg, warn) {
    var el = host.querySelector('#arrange-status');
    if (!el) return;
    el.textContent = msg || '';
    el.classList.toggle('warn', !!warn);
    el.style.display = msg ? 'block' : 'none';
  }

  function emitChange() {
    if (opts.onChange) opts.onChange({ modified: self.isModified() });
  }

  self.isModified = function () {
    return !!state.analysis &&
      (state.transforms.size > 0 || state.copies.length > 0 || state.deleted.size > 0);
  };

  // deleted = self or any ancestor marked deleted (copies are simply removed)
  function isDeleted(f) {
    for (var n = f.isCopy ? null : f; n; n = n.parent) {
      if (state.deleted.has(n)) return true;
    }
    return false;
  }

  // ── loading ──────────────────────────────────────────────────────────────

  /** Analyze the SBP text. Returns false for relative-mode (SR) files. */
  self.load = function (text, name) {
    var parsed = renest.parseSbp(text);
    if (parsed.usesRelative) return false;
    state.fileName = name || 'toolpath.sbp';
    state.text = text;
    state.lines = parsed.lines;
    state.analysis = renest.analyze(parsed.lines, { scale: unitScale });
    state.parts = renest.defaultParts(state.analysis);
    state.transforms = new Map();
    state.warns = new Map();
    state.copies = [];
    state.deleted = new Set();
    state.clipboard = null;
    state.selected = null;
    fitView();
    checkCollisions();
    buildTree();
    if (active) draw();
    return true;
  };

  self.hasFile = function () { return !!state.analysis; };
  self.fileName = function () { return state.fileName; };
  self.partCount = function () { return state.parts.length; };

  // ── transforms ───────────────────────────────────────────────────────────

  function topLevelOf(f) {
    var n = f;
    while (n.parent && n.parent.kind !== 'sheet-outline') n = n.parent;
    return n;
  }
  function colorOf(f) {
    if (f.isCopy) return PALETTE[(state.parts.length + state.copies.indexOf(f)) % PALETTE.length];
    var top = topLevelOf(f);
    var i = state.parts.indexOf(top);
    if (i >= 0) return PALETTE[i % PALETTE.length];
    return '#8a8f98';
  }

  // composed transform of a feature = own transform, then each ancestor's
  function matrixOf(f) {
    var m = renest.IDENT;
    for (var n = f; n; n = n.parent) {
      var tr = state.transforms.get(n);
      if (tr) m = renest.mulT(renest.makeTransform(tr), m);
    }
    return m;
  }

  function ensureTransform(f) {
    var tr = state.transforms.get(f);
    if (!tr) {
      var bb = subtreeBbox(f);
      tr = { dx: 0, dy: 0, deg: 0, cx: (bb.x0 + bb.x1) / 2, cy: (bb.y0 + bb.y1) / 2 };
      state.transforms.set(f, tr);
    }
    return tr;
  }

  function rotateSelected(deltaDeg) {
    if (!state.selected) return;
    var tr = ensureTransform(state.selected);
    tr.deg = ((tr.deg + deltaDeg) % 360 + 360) % 360;
    afterTransform();
    readout(state.selected);
  }

  function resetSelected() {
    if (!state.selected) return;
    if (state.selected.isCopy) { removeCopy(state.selected); return; }
    state.transforms.delete(state.selected);
    afterTransform();
    setStatus(t('previewer.arrange.part_reset', { name: nameOf(state.selected) }));
  }

  function removeCopy(c) {
    var name = nameOf(c);
    state.copies = state.copies.filter(function (x) { return x !== c; });
    state.transforms.delete(c);
    if (state.selected === c) state.selected = null;
    afterTransform();
    setStatus(t('previewer.arrange.copy_removed', { name: name }));
  }

  /** Drop the selected part's cuts from the export. A copy just disappears;
      an original is marked deleted and can be restored from the parts list. */
  function deleteSelected() {
    var f = state.selected;
    if (!f) return;
    if (f.isCopy) { removeCopy(f); return; }
    state.deleted.add(f);
    state.selected = null;
    afterTransform();
    setStatus(t('previewer.arrange.part_deleted', { name: nameOf(f) }));
  }

  // ── duplicate (copy/paste) ───────────────────────────────────────────────

  function subtreeList(f) {
    var out = [f];
    var walk = function (n) {
      for (var i = 0; i < n.children.length; i++) {
        var k = n.children[i];
        if (k.kind === 'part' || k.kind === 'loose') continue;
        out.push(k);
        walk(k);
      }
    };
    walk(f);
    return out;
  }

  function duplicatePart(of) {
    if (!of) return;
    var source = of.isCopy ? of.source : topLevelOf(of);
    if (source.kind !== 'part' && !of.isCopy) {
      setStatus(t('previewer.arrange.whole_parts_only'));
      return;
    }
    // land the copy where the original (or the copied copy) sits, nudged by
    // one unit so it's visibly a new part
    var base = state.transforms.get(of.isCopy ? of : source);
    var bb = subtreeBbox(source);
    var tr = base
      ? { dx: base.dx, dy: base.dy, deg: base.deg, cx: base.cx, cy: base.cy }
      : { dx: 0, dy: 0, deg: 0, cx: (bb.x0 + bb.x1) / 2, cy: (bb.y0 + bb.y1) / 2 };
    tr.dx += unitScale; tr.dy += unitScale;

    var copy = {
      isCopy: true, source: source,
      // display fields duck-typed so tree / collision / hit code reads them
      pts: source.pts, bbox: source.bbox, samples: source.samples,
      collPoly: source.collPoly, children: [], episodes: source.episodes,
      minZ: source.minZ, closed: source.closed, label: null,
      kind: 'part', parent: null, ambiguous: false,
    };
    state.copies.push(copy);
    state.transforms.set(copy, tr);
    state.selected = copy;
    afterTransform();
    setStatus(t('previewer.arrange.copy_placed', { name: nameOf(copy) }));
  }

  function afterTransform() {
    checkCollisions();
    buildTree();
    if (active) draw();
    emitChange();
  }

  // ── collision / bounds warnings ──────────────────────────────────────────

  function bboxOfPts(pts) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
      if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
    }
    return { x0: x0, y0: y0, x1: x1, y1: y1 };
  }

  function checkCollisions() {
    state.warns = new Map();
    if (!state.analysis) { updateWarnbar(); return; }
    var addWarn = function (p, r) {
      if (!state.warns.has(p)) state.warns.set(p, []);
      state.warns.get(p).push(r);
    };

    var parts = state.parts.filter(function (p) { return p.collPoly && !isDeleted(p); })
      .concat(state.copies.filter(function (c) { return c.collPoly; }));
    var mats = new Map(), polys = new Map(), samps = new Map(), bbs = new Map();
    parts.forEach(function (p) {
      var m = matrixOf(p);
      mats.set(p, m);
      polys.set(p, p.collPoly.map(function (pt) { return renest.applyT(m, pt.x, pt.y); }));
      samps.set(p, p.samples.map(function (pt) { return renest.applyT(m, pt.x, pt.y); }));
      bbs.set(p, bboxOfPts(polys.get(p)));
    });

    for (var i = 0; i < parts.length; i++) {
      for (var j = i + 1; j < parts.length; j++) {
        var P = parts[i], Q = parts[j];
        var a = bbs.get(P), b = bbs.get(Q);
        if (a.x1 < b.x0 || a.x0 > b.x1 || a.y1 < b.y0 || a.y0 > b.y1) continue;
        var hit = samps.get(P).some(function (pt) { return renest.windingInside(pt, polys.get(Q)); }) ||
                  samps.get(Q).some(function (pt) { return renest.windingInside(pt, polys.get(P)); });
        if (hit) {
          addWarn(P, t('previewer.arrange.overlaps', { name: nameOf(Q) }));
          addWarn(Q, t('previewer.arrange.overlaps', { name: nameOf(P) }));
        }
      }
    }

    // material bounds: sheet outline if present, else the machine table.
    // The file's own cut extent is NOT a usable fallback — for a file
    // that is one part, the extent IS the part's original footprint, so
    // any move at all got flagged "off the sheet". With neither a sheet
    // nor table bounds we have nothing meaningful to check against.
    var so = state.analysis.features.find(function (f) { return f.kind === 'sheet-outline'; });
    var mat = so ? so.bbox : table;
    var offMsg = so ? 'previewer.arrange.off_sheet' : 'previewer.arrange.off_table';
    var slack = 0.05 * unitScale;
    if (mat) parts.forEach(function (p) {
      var bb = bbs.get(p);
      if (bb.x0 < mat.x0 - slack || bb.x1 > mat.x1 + slack ||
          bb.y0 < mat.y0 - slack || bb.y1 > mat.y1 + slack)
        addWarn(p, t(offMsg));
    });
    updateWarnbar();
  }

  function updateWarnbar() {
    var el = host.querySelector('#arrange-warnbar');
    if (!el) return;
    if (!state.warns || !state.warns.size || !active) { el.style.display = 'none'; el.textContent = ''; return; }
    var msgs = [];
    var seen = {};
    state.warns.forEach(function (rs, p) {
      rs.forEach(function (r) {
        var key = [nameOf(p), r].sort().join('|');
        if (seen[key]) return;
        seen[key] = 1;
        msgs.push(nameOf(p) + ' ' + r);
      });
    });
    el.textContent = '⚠ ' + msgs.join(' · ');
    el.style.display = 'block';
  }

  // ── canvas ───────────────────────────────────────────────────────────────

  function fitView() {
    if (!state.analysis) return;
    var ext = state.analysis.extent;
    // Frame the table too (when known) so its boundary is on screen and
    // the user can see where parts sit relative to the machine.
    if (table) {
      ext = {
        x0: Math.min(ext.x0, table.x0), y0: Math.min(ext.y0, table.y0),
        x1: Math.max(ext.x1, table.x1), y1: Math.max(ext.y1, table.y1),
      };
      ext.w = ext.x1 - ext.x0; ext.h = ext.y1 - ext.y0;
    }
    var pad = 60;
    var sx = (canvas.width - 2 * pad) / Math.max(ext.w, 0.1);
    var sy = (canvas.height - 2 * pad) / Math.max(ext.h, 0.1);
    state.view.scale = Math.max(0.01, Math.min(sx, sy));
    // center the extent in the canvas
    state.view.x = ext.x0 - (canvas.width / state.view.scale - ext.w) / 2;
    state.view.y = ext.y1 + (canvas.height / state.view.scale - ext.h) / 2; // y flipped
  }
  function w2s(wx, wy) {
    return { x: (wx - state.view.x) * state.view.scale, y: (state.view.y - wy) * state.view.scale };
  }
  function s2w(sx, sy) {
    return { x: sx / state.view.scale + state.view.x, y: state.view.y - sy / state.view.scale };
  }

  // hit threshold in world units
  function thresh() {
    return 8 * (window.devicePixelRatio || 1) / state.view.scale;
  }

  function cssVar(name, fallback) {
    var v = getComputedStyle(document.body).getPropertyValue(name).trim();
    return v || fallback;
  }

  self.resize = function () {
    var r = host.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(200, r.width * dpr);
    canvas.height = Math.max(200, r.height * dpr);
    canvas.style.width = r.width + 'px';
    canvas.style.height = r.height + 'px';
    if (active && state.analysis) draw();
  };

  function drawFeature(f, dopts, mOverride) {
    var m = mOverride || matrixOf(f);
    var dpr = window.devicePixelRatio || 1;
    ctx.beginPath();
    if (f.pts.length === 1) {
      var p1 = renest.applyT(m, f.pts[0].x, f.pts[0].y);
      var sp1 = w2s(p1.x, p1.y);
      ctx.arc(sp1.x, sp1.y, 3 * dpr, 0, Math.PI * 2);
      ctx.fillStyle = dopts.stroke;
      ctx.fill();
      return;
    }
    for (var i = 0; i < f.pts.length; i++) {
      var p = renest.applyT(m, f.pts[i].x, f.pts[i].y);
      var sp = w2s(p.x, p.y);
      if (i) ctx.lineTo(sp.x, sp.y); else ctx.moveTo(sp.x, sp.y);
    }
    ctx.strokeStyle = dopts.stroke;
    ctx.lineWidth = dopts.width * dpr;
    ctx.globalAlpha = dopts.alpha != null ? dopts.alpha : 1;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function draw() {
    var dpr = window.devicePixelRatio || 1;
    ctx.fillStyle = cssVar('--pv-bg', '#ffffff');
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!state.analysis) { positionToolbar(); return; }

    // grid every 1 unit
    ctx.strokeStyle = 'rgba(49, 51, 102, 0.10)';
    ctx.lineWidth = 1;
    var gx0 = Math.floor(s2w(0, 0).x), gx1 = Math.ceil(s2w(canvas.width, 0).x);
    var gy1 = Math.ceil(s2w(0, 0).y), gy0 = Math.floor(s2w(0, canvas.height).y);
    var gstep = unitScale > 1 ? 25 : 1; // 25 mm ≈ 1 inch grid density
    if ((gx1 - gx0) / gstep < 200) {
      ctx.beginPath();
      for (var gx = Math.floor(gx0 / gstep) * gstep; gx <= gx1; gx += gstep) {
        ctx.moveTo(w2s(gx, 0).x, 0); ctx.lineTo(w2s(gx, 0).x, canvas.height);
      }
      for (var gy = Math.floor(gy0 / gstep) * gstep; gy <= gy1; gy += gstep) {
        ctx.moveTo(0, w2s(0, gy).y); ctx.lineTo(canvas.width, w2s(0, gy).y);
      }
      ctx.stroke();
    }

    var muted = cssVar('--pv-text-dim', '#666');
    var accent = cssVar('--pv-accent', '#313366');

    // machine table boundary (drawn under the parts)
    if (table) {
      var tA = w2s(table.x0, table.y0);
      var tB = w2s(table.x1, table.y1);
      var tw = tB.x - tA.x, th = tB.y - tA.y;
      ctx.fillStyle = 'rgba(49, 51, 102, 0.04)';
      ctx.fillRect(tA.x, tA.y, tw, th);
      ctx.strokeStyle = 'rgba(49, 51, 102, 0.45)';
      ctx.lineWidth = 1.5 * dpr;
      ctx.strokeRect(tA.x, tA.y, tw, th);
      ctx.fillStyle = muted;
      ctx.font = 11 * dpr + 'px sans-serif';
      ctx.fillText(t('previewer.arrange.table_label'), tA.x + 5 * dpr, tA.y - 5 * dpr);
    }

    var selTop = state.selected ? topLevelOf(state.selected) : null;

    state.analysis.features.forEach(function (f) {
      if (f.kind === 'sheet-outline') {
        drawFeature(f, { stroke: muted, width: 1, alpha: 0.5 });
        return;
      }
      if (f.kind === 'loose') {
        drawFeature(f, { stroke: muted, width: 1, alpha: 0.35 });
        return;
      }
      if (isDeleted(f)) return;
      var top = topLevelOf(f);
      var isSelTree = selTop && top === selTop;
      var isSelNode = state.selected && (f === state.selected || isDescendant(f, state.selected));
      var warned = state.warns.has(top);
      drawFeature(f, {
        stroke: warned ? '#e05555' : colorOf(f),
        width: isSelNode ? 2.5 : (isSelTree || (warned && f === top) ? 1.8 : 1.2),
        alpha: selTop && !isSelTree && !warned ? 0.45 : 1,
      });
    });

    // duplicates: the source's whole subtree through the copy's transform
    state.copies.forEach(function (c) {
      var m = matrixOf(c);
      var warned = state.warns.has(c);
      var sel = state.selected === c;
      var color = warned ? '#e05555' : colorOf(c);
      subtreeList(c.source).forEach(function (sf) {
        drawFeature(sf, { stroke: color, width: sel ? 2 : 1.2, alpha: sel || warned ? 1 : 0.85 }, m);
      });
    });

    // selection outline: subtree bbox through the feature's transform
    if (state.selected) {
      var corners = selectedCorners();
      ctx.strokeStyle = accent;
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      corners.forEach(function (p, i) {
        var sp = w2s(p.x, p.y);
        if (i) ctx.lineTo(sp.x, sp.y); else ctx.moveTo(sp.x, sp.y);
      });
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
    }
    positionToolbar();
  }

  function selectedCorners() {
    var f = state.selected;
    var m = matrixOf(f);
    var bb = subtreeBbox(f);
    return [
      renest.applyT(m, bb.x0, bb.y0), renest.applyT(m, bb.x1, bb.y0),
      renest.applyT(m, bb.x1, bb.y1), renest.applyT(m, bb.x0, bb.y1),
    ];
  }

  function isDescendant(f, anc) {
    for (var n = f.parent; n; n = n.parent) if (n === anc) return true;
    return false;
  }
  function subtreeBbox(f) {
    if (f.isCopy) f = f.source;
    var x0 = f.bbox.x0, y0 = f.bbox.y0, x1 = f.bbox.x1, y1 = f.bbox.y1;
    var walk = function (n) {
      for (var i = 0; i < n.children.length; i++) {
        var k = n.children[i];
        if (k.kind === 'part' || k.kind === 'loose') continue;
        x0 = Math.min(x0, k.bbox.x0); y0 = Math.min(y0, k.bbox.y0);
        x1 = Math.max(x1, k.bbox.x1); y1 = Math.max(y1, k.bbox.y1);
        walk(k);
      }
    };
    walk(f);
    return { x0: x0, y0: y0, x1: x1, y1: y1 };
  }

  // ── hit testing ──────────────────────────────────────────────────────────

  function distToFeature(p, f) {
    var d = Infinity;
    if (f.pts.length === 1) d = Math.hypot(p.x - f.pts[0].x, p.y - f.pts[0].y);
    for (var i = 1; i < f.pts.length; i++) {
      var a = f.pts[i - 1], b = f.pts[i];
      var ddx = b.x - a.x, ddy = b.y - a.y;
      var L2 = ddx * ddx + ddy * ddy;
      var tt = L2 > 0 ? ((p.x - a.x) * ddx + (p.y - a.y) * ddy) / L2 : 0;
      tt = Math.max(0, Math.min(1, tt));
      d = Math.min(d, Math.hypot(p.x - (a.x + tt * ddx), p.y - (a.y + tt * ddy)));
    }
    return d;
  }

  function hitFeature(wx, wy, th) {
    var best = null, bestD = Infinity;
    state.analysis.features.forEach(function (f) {
      if (f.kind === 'sheet-outline' || f.kind === 'loose') return;
      if (isDeleted(f)) return;
      // undo the feature's transform, test against original geometry
      var p = renest.applyT(renest.invT(matrixOf(f)), wx, wy);
      if (p.x < f.bbox.x0 - th || p.x > f.bbox.x1 + th ||
          p.y < f.bbox.y0 - th || p.y > f.bbox.y1 + th) return;
      var d = distToFeature(p, f);
      if (d < th && d < bestD) { bestD = d; best = f; }
    });
    // duplicates: test the source subtree through the copy's transform
    state.copies.forEach(function (c) {
      var p = renest.applyT(renest.invT(matrixOf(c)), wx, wy);
      var bb = subtreeBbox(c);
      if (p.x < bb.x0 - th || p.x > bb.x1 + th ||
          p.y < bb.y0 - th || p.y > bb.y1 + th) return;
      subtreeList(c.source).forEach(function (sf) {
        var d = distToFeature(p, sf);
        if (d < th && d < bestD) { bestD = d; best = c; }
      });
    });
    return best;
  }

  // ── mouse ────────────────────────────────────────────────────────────────

  function onMouseDown(e) {
    if (!state.analysis) return;
    var dpr = window.devicePixelRatio || 1;
    var sx = e.offsetX * dpr, sy = e.offsetY * dpr;
    var w = s2w(sx, sy);
    var hit = hitFeature(w.x, w.y, thresh());
    if (hit && e.button === 0) {
      var target = topLevelOf(hit);
      if (state.selected && (hit === state.selected || isDescendant(hit, state.selected)))
        target = state.selected; // keep drilled-down selection when grabbing it
      state.selected = target;
      var tr = ensureTransform(target);
      state.drag = { kind: 'move', f: target, wx: w.x, wy: w.y, odx: tr.dx, ody: tr.dy };
      buildTree();
    } else {
      state.drag = { kind: 'pan', sx: e.offsetX, sy: e.offsetY, vx: state.view.x, vy: state.view.y };
      if (e.button === 0 && !hit) { state.selected = null; buildTree(); }
    }
    draw();
  }

  function onMouseMove(e) {
    if (!state.analysis) return;
    var dpr = window.devicePixelRatio || 1;
    var sx = e.offsetX * dpr, sy = e.offsetY * dpr;
    var w = s2w(sx, sy);
    var coords = host.querySelector('#arrange-coords');
    if (coords) coords.textContent = w.x.toFixed(3) + ', ' + w.y.toFixed(3);
    if (!state.drag) {
      canvas.style.cursor = hitFeature(w.x, w.y, thresh()) ? 'grab' : 'default';
      return;
    }
    if (state.drag.kind === 'pan') {
      state.view.x = state.drag.vx - (e.offsetX - state.drag.sx) * dpr / state.view.scale;
      state.view.y = state.drag.vy + (e.offsetY - state.drag.sy) * dpr / state.view.scale;
    } else {
      var d = state.drag;
      var tr = ensureTransform(d.f);
      var dx = d.odx + (w.x - d.wx), dy = d.ody + (w.y - d.wy);
      if (e.shiftKey) { // axis lock
        if (Math.abs(dx - d.odx) > Math.abs(dy - d.ody)) dy = d.ody; else dx = d.odx;
      }
      tr.dx = dx; tr.dy = dy;
      canvas.style.cursor = 'grabbing';
      checkCollisions();
      readout(d.f);
    }
    draw();
  }

  function onWindowMouseUp() {
    if (!active) return;
    if (state.drag && state.drag.kind === 'move') {
      var tr = state.transforms.get(state.drag.f);
      if (tr && !tr.dx && !tr.dy && !tr.deg && !state.drag.f.isCopy)
        state.transforms.delete(state.drag.f);
      checkCollisions();
      buildTree();
      emitChange();
    }
    state.drag = null;
    if (state.analysis) draw();
  }

  function onWheel(e) {
    if (!state.analysis) return;
    e.preventDefault();
    var dpr = window.devicePixelRatio || 1;
    var factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    var w = s2w(e.offsetX * dpr, e.offsetY * dpr);
    state.view.scale *= factor;
    state.view.x = w.x - (e.offsetX * dpr) / state.view.scale;
    state.view.y = w.y + (e.offsetY * dpr) / state.view.scale;
    draw();
  }

  function onKeyDown(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    var handled = true;
    if (e.key === 'r') rotateSelected(-90);
    else if (e.key === 'R') rotateSelected(90);
    else if (e.key === 'd' && !e.ctrlKey && !e.metaKey) duplicatePart(state.selected);
    else if ((e.ctrlKey || e.metaKey) && e.key === 'c' && state.selected) {
      state.clipboard = state.selected;
      setStatus(t('previewer.arrange.copied', { name: nameOf(state.selected) }));
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'v' && state.clipboard) {
      duplicatePart(state.clipboard);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && state.selected) {
      deleteSelected();
    } else if (e.key === 'Escape') {
      if (opts.onRequestExit) opts.onRequestExit();
    } else {
      handled = false;
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  function readout(f) {
    var tr = state.transforms.get(f);
    setStatus(tr ? nameOf(f) + ': Δx ' + tr.dx.toFixed(3) + '  Δy ' + tr.dy.toFixed(3) +
      (tr.deg ? '  ⟲ ' + tr.deg + '°' : '') : '');
  }

  // ── selection toolbar ────────────────────────────────────────────────────

  function positionToolbar() {
    var tb = host.querySelector('#part-toolbar');
    if (!tb) return;
    if (!active || !state.selected || !state.analysis) { tb.style.display = 'none'; return; }
    var dpr = window.devicePixelRatio || 1;
    var corners = selectedCorners();
    var minSy = Infinity, maxSy = -Infinity, sumSx = 0;
    corners.forEach(function (p) {
      var sp = w2s(p.x, p.y);
      minSy = Math.min(minSy, sp.y / dpr);
      maxSy = Math.max(maxSy, sp.y / dpr);
      sumSx += sp.x / dpr;
    });
    var tr = state.transforms.get(state.selected);
    tb.querySelector('#tb-name').textContent =
      nameOf(state.selected) + (tr && tr.deg ? ' · ' + tr.deg + '°' : '');
    tb.style.display = 'flex';

    // clamp inside the viewport; flip below the selection when no room above
    var hw = tb.offsetWidth / 2, th = tb.offsetHeight;
    var cx = Math.max(hw + 8, Math.min(sumSx / 4, host.clientWidth - hw - 8));
    var top = minSy - th - 10;
    if (top < 8) top = maxSy + 12;
    top = Math.max(8, Math.min(top, host.clientHeight - th - 8));
    tb.style.left = cx + 'px';
    tb.style.top = top + 'px';
  }

  // ── tree panel ───────────────────────────────────────────────────────────

  function nameOf(f) {
    if (f.isCopy) {
      var siblings = state.copies.filter(function (c) { return c.source === f.source; });
      var n = siblings.indexOf(f) + 1;
      return t('previewer.arrange.copy_name', { name: nameOf(f.source), n: n > 1 ? ' ' + n : '' });
    }
    if (f.kind === 'sheet-outline') return t('previewer.arrange.sheet_outline');
    var i0 = state.parts.indexOf(f);
    if (i0 >= 0) return t('previewer.arrange.part_name', { letter: String.fromCharCode(65 + (i0 % 26)) });
    if (f.label)
      return f.label + ' ' + (f.bbox.w > 0.05 * unitScale
        ? f.bbox.w.toFixed(1) + '×' + f.bbox.h.toFixed(1)
        : '@ ' + f.pts[0].x.toFixed(1) + ',' + f.pts[0].y.toFixed(1));
    if (f.pts.length === 1)
      return t('previewer.arrange.drill_at', { x: f.pts[0].x.toFixed(2), y: f.pts[0].y.toFixed(2) });
    var kindName = !f.closed ? t('previewer.arrange.path')
      : t('previewer.arrange.profile');
    return kindName + ' ' + f.bbox.w.toFixed(1) + '×' + f.bbox.h.toFixed(1);
  }

  function buildTree() {
    if (!treeEl) return;
    treeEl.innerHTML = '';
    if (!state.analysis) return;

    var addNode = function (f, depth) {
      if (depth > 0 && (f.kind === 'part' || f.kind === 'loose')) return;
      var div = document.createElement('div');
      if (state.deleted.has(f)) {
        // deleted: struck-through entry, one click restores; children hidden
        div.className = 'tree-node deleted';
        div.style.paddingLeft = (8 + depth * 16) + 'px';
        div.title = t('previewer.arrange.restore_title');
        div.innerHTML = '<span class="swatch" style="background:' + colorOf(f) + '"></span>' +
          '<span class="nname"></span><span class="restore">↩ ' + t('previewer.arrange.restore') + '</span>';
        div.querySelector('.nname').textContent = nameOf(f);
        div.addEventListener('click', function () {
          state.deleted.delete(f);
          state.selected = f;
          afterTransform();
          setStatus(t('previewer.arrange.part_restored', { name: nameOf(f) }));
        });
        treeEl.appendChild(div);
        return;
      }
      div.className = 'tree-node' + (f === state.selected ? ' selected' : '');
      div.style.paddingLeft = (8 + depth * 16) + 'px';
      var tr = state.transforms.get(f);
      var moved = tr && (tr.dx || tr.dy || tr.deg)
        ? ' <span class="moved">' + (tr.dx || tr.dy ? 'Δ(' + tr.dx.toFixed(2) + ', ' + tr.dy.toFixed(2) + ')' : '') +
          (tr.deg ? ' ⟲' + tr.deg + '°' : '') + '</span>' : '';
      var warnTitle = state.warns.has(f) ? state.warns.get(f).join(', ')
        : (f.ambiguous ? t('previewer.arrange.ambiguous') : null);
      var warn = warnTitle ? ' <span class="amb"></span>' : '';
      div.innerHTML = '<span class="swatch" style="background:' + colorOf(f) + '"></span>' +
        '<span class="nname"></span>' +
        '<span class="ninfo">' + (f.episodes.length > 1 ? f.episodes.length + '× ' : '') +
        'z ' + f.minZ.toFixed(2) + '</span>' + moved + warn;
      div.querySelector('.nname').textContent = nameOf(f);
      if (warnTitle) {
        var ambEl = div.querySelector('.amb');
        ambEl.textContent = '⚠';
        ambEl.title = warnTitle;
      }
      div.addEventListener('click', function () {
        state.selected = f === state.selected ? null : f;
        buildTree();
        draw();
      });
      treeEl.appendChild(div);
      for (var i = 0; i < f.children.length; i++) addNode(f.children[i], depth + 1);
    };

    state.parts.forEach(function (p) { addNode(p, 0); });
    state.copies.forEach(function (c) { addNode(c, 0); });

    var so = state.analysis.features.find(function (f) { return f.kind === 'sheet-outline'; });
    if (so || state.analysis.sheetBucket.length) {
      var h = document.createElement('div');
      h.className = 'tree-section';
      h.textContent = t('previewer.arrange.sheet_section');
      treeEl.appendChild(h);
      if (so) addNode(so, 0);
      state.analysis.sheetBucket.forEach(function (f) {
        if (f.parent === null || f.kind === 'loose') addNode(f, 0);
      });
    }
  }

  // ── export ───────────────────────────────────────────────────────────────

  function ownLineIdxs(f) {
    var idxs = [];
    for (var i = 0; i < f.episodes.length; i++) {
      var ep = f.episodes[i];
      idxs.push.apply(idxs, ep.jogIdxs);
      idxs.push.apply(idxs, ep.cutIdxs);
      if (ep.tailIdxs) idxs.push.apply(idxs, ep.tailIdxs);
    }
    return idxs;
  }

  function fileSafeZ() {
    var z = -Infinity;
    for (var i = 0; i < state.lines.length; i++) {
      var rec = state.lines[i];
      if (rec.cmd !== 'JZ') continue;
      var v = parseFloat(rec.params[0]);
      if (isFinite(v) && v > z) z = v;
    }
    return isFinite(z) && z > 0 ? z : 0.75 * unitScale;
  }

  /** SBP with all transforms applied; untouched lines byte-identical. */
  self.getExportText = function () {
    if (!state.analysis) return null;
    // every feature whose composed chain is non-identity gets its own lines
    // rewritten exactly once with the full chain
    var jobs = [];
    state.analysis.features.forEach(function (f) {
      var m = matrixOf(f);
      if (!renest.isIdent(m)) jobs.push({ idxs: ownLineIdxs(f), m: m });
    });
    var out = jobs.length ? renest.applyTransforms(state.lines, jobs) : state.text;
    // deletions: blank the owned lines IN PLACE first — the line count must
    // stay unchanged so insertDuplicates' index-based splice still lands
    // right — then strip the markers at the very end.
    var DEL = ' renest-deleted ';
    if (state.deleted.size) {
      var arr = out.split(/\r?\n/);
      state.deleted.forEach(function (f) {
        renest.subtreeLineIdxs(f).forEach(function (i) {
          if (i < arr.length) arr[i] = DEL;
        });
      });
      out = arr.join('\n');
    }
    if (state.copies.length) {
      var dups = state.copies.map(function (c) {
        return { idxs: renest.subtreeLineIdxs(c.source), m: matrixOf(c), label: nameOf(c) };
      });
      out = renest.insertDuplicates(state.lines, out, dups, fileSafeZ());
    }
    if (state.deleted.size) {
      out = out.split('\n').filter(function (l) { return l !== DEL; }).join('\n');
    }
    return out;
  };

  self.resetAll = function () {
    if (!state.analysis) return;
    state.transforms.clear();
    state.copies = [];
    state.deleted.clear();
    state.selected = null;
    afterTransform();
    setStatus(t('previewer.arrange.all_reset'));
  };

  // ── mode enter / exit ────────────────────────────────────────────────────

  self.isActive = function () { return active; };

  self.enter = function () {
    if (active) return;
    active = true;
    canvas.style.display = 'block';
    var coords = host.querySelector('#arrange-coords');
    if (coords) coords.style.display = 'block';
    self.resize();
    fitView();
    checkCollisions();
    buildTree();
    draw();
    window.addEventListener('keydown', onKeyDown, true);
    setStatus(t('previewer.arrange.entered', {
      parts: state.parts.length,
      episodes: state.analysis ? state.analysis.episodes.length : 0,
    }));
  };

  self.exit = function () {
    if (!active) return;
    active = false;
    state.drag = null;
    canvas.style.display = 'none';
    var coords = host.querySelector('#arrange-coords');
    if (coords) coords.style.display = 'none';
    setStatus('');
    updateWarnbar();
    positionToolbar(); // hides it
    window.removeEventListener('keydown', onKeyDown, true);
  };

  // ── wiring ───────────────────────────────────────────────────────────────

  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('mouseup', onWindowMouseUp);
  window.addEventListener('resize', function () { if (active) self.resize(); });

  var tb = host.querySelector('#part-toolbar');
  if (tb) {
    tb.querySelector('#tb-ccw90').addEventListener('click', function () { rotateSelected(90); });
    tb.querySelector('#tb-ccw15').addEventListener('click', function () { rotateSelected(15); });
    tb.querySelector('#tb-cw15').addEventListener('click', function () { rotateSelected(-15); });
    tb.querySelector('#tb-cw90').addEventListener('click', function () { rotateSelected(-90); });
    tb.querySelector('#tb-dup').addEventListener('click', function () { duplicatePart(state.selected); });
    tb.querySelector('#tb-del').addEventListener('click', deleteSelected);
    tb.querySelector('#tb-reset').addEventListener('click', resetSelected);
  }
}

module.exports = Arrange;
