"""Fill gaps in a finished scan: rescan only the sweep positions whose
surface has holes, stop-and-go (laser off/on pairs: more sensitive on dim
or glossy surfaces than continuous mode), and merge into the same scan.

    find_gap_ranges(capdir) -> sweep-axis ranges (scan mm) with holes
    patch_targets(capdir, ranges, step_in) -> absolute machine stops
    (scand: POST /fillgaps {session} runs both, captures into
     <scan>/patch_N/, and process_dir merges the patches.)

Holes inside laser shadows (beside tall parts) can't be filled from the
same heading; the before/after hole count in the result says how much
was recoverable.
"""

import json
import os

import cv2
import numpy as np

IN_TO_MM = 25.4
AXES = ("x", "y", "z")


def _grid(capdir):
    with open(os.path.join(capdir, "scan.json")) as fh:
        st = json.load(fh)
    s = st["surface"]
    g = np.fromfile(os.path.join(capdir, "surface.bin"), "<f4").reshape(s["height"], s["width"])
    return g, s, st


def _nearest_valid(g, axis, reverse):
    """Value of the nearest valid cell before each cell along `axis`
    (after it, if reverse); NaN where there is none."""
    a = g if axis == 1 else g.T
    if reverse:
        a = a[:, ::-1]
    H, W = a.shape
    idx = np.where(np.isfinite(a), np.arange(W)[None, :], -1)
    idx = np.maximum.accumulate(idx, axis=1)
    out = np.where(idx >= 0, a[np.arange(H)[:, None], np.clip(idx, 0, None)], np.nan)
    # the cell itself counts only if valid: shift so a NaN cell sees the one before it
    if reverse:
        out = out[:, ::-1]
    return out if axis == 1 else out.T


def hole_mask(g, min_part_mm=3.0):
    """Fillable holes: NaN cells bounded by PART on both sides, along X or
    along Y (nearest valid cell before and after is higher than
    min_part_mm). Laser/camera shadows beside a part have table on one
    side and part on the other — they can't be filled from the same
    heading, so they're left out."""
    nan = ~np.isfinite(g)
    part = lambda v: np.nan_to_num(v, nan=-1e9) > min_part_mm
    lx, rx = _nearest_valid(g, 1, False), _nearest_valid(g, 1, True)
    ly, ry = _nearest_valid(g, 0, False), _nearest_valid(g, 0, True)
    return nan & ((part(lx) & part(rx)) | (part(ly) & part(ry)))


def shadow_mask(g):
    """All interior holes (for reporting): NaN with valid cells on both
    sides along X and along Y."""
    nan = ~np.isfinite(g)
    ok = lambda v: np.isfinite(v)
    return nan & ok(_nearest_valid(g, 1, False)) & ok(_nearest_valid(g, 1, True)) & \
        ok(_nearest_valid(g, 0, False)) & ok(_nearest_valid(g, 0, True))


def find_gap_ranges(capdir, min_hole_cells=8, min_frac=0.15, pad_mm=2.0, merge_mm=3.0):
    """Sweep-axis ranges (scan mm, the axis the scan stepped along) whose
    grid rows/columns contain holes near the part. -> (ranges, n_hole_cells)"""
    g, s, st = _grid(capdir)
    with open(os.path.join(capdir, "manifest.json")) as fh:
        man = json.load(fh)
    ax = man.get("axis", "y")
    if ax not in ("x", "y"):
        raise RuntimeError("gap filling needs a single-axis sweep (got %r)" % ax)
    holes = hole_mask(g)
    cell = s["cell_mm"]
    sm = 1 if ax == "y" else 0                       # sum across the line
    per = holes.sum(axis=sm)                          # holes per sweep position
    partc = (np.nan_to_num(g, nan=-1) > 3.0).sum(axis=sm)
    o = s["origin_mm"][1] if ax == "y" else s["origin_mm"][0]
    pos = o + (np.arange(len(per)) + 0.5) * cell
    # target real dropouts (a good share of the part missing on that line),
    # not the thin steady trickle along grooves/steep edges
    hit = (per >= min_hole_cells) & (per >= min_frac * np.maximum(partc, 1))
    ranges = []
    for p, h in zip(pos, hit):
        if not h:
            continue
        if ranges and p - ranges[-1][1] <= merge_mm:
            ranges[-1][1] = p
        else:
            ranges.append([p, p])
    out = []
    for a, b in ([a - pad_mm, b + pad_mm] for a, b in ranges):
        if out and a <= out[-1][1]:
            out[-1][1] = max(out[-1][1], b)          # padded ranges touching: merge
        else:
            out.append([a, b])
    return out, int(holes.sum())


def line_offset_mm(capdir, man):
    """Where the laser line lands along the sweep axis relative to the
    camera position, in scan coordinates: from a few frames/shots,
    median(point position) - (shot position - first shot position)."""
    import sweep
    ax = man.get("axis", "y")
    k = AXES.index(ax)
    shots = man["shots"]
    p0 = shots[0]["pose"][ax]
    cal = sweep.load_cal()
    offs = []
    for s in shots[:: max(1, len(shots) // 8)][:8]:
        on = cv2.imread(os.path.join(capdir, s["img_on"]))
        if on is None:
            continue
        dp = np.zeros(3)
        if "img_off" in s:
            off = cv2.imread(os.path.join(capdir, s["img_off"]))
            P = sweep.triangulate_shot(off, on, cal, dp)
        else:
            import stripe
            pts = stripe.extract_on_only(on)
            if len(pts) == 0:
                continue
            u = cv2.undistortPoints(pts[:, [1, 0]].reshape(-1, 1, 2).astype(np.float64),
                                    cal["K"], cal["D"]).reshape(-1, 2)
            r = np.c_[u, np.ones(len(u))]
            P = (r * (cal["c"] / (r @ cal["m"]))[:, None]) @ cal["R_mc"]
        if len(P):
            offs.append(np.median(P[:, k]))
    if not offs:
        raise RuntimeError("couldn't locate the laser line in the scan's frames")
    # each was computed with dp = 0, i.e. relative to that shot's own camera
    return float(np.median(offs)), p0


def patch_targets(capdir, ranges, step_in=0.04):
    """Absolute machine stops (x, y, row 0) that put the laser line over
    each range, at the original scan's fixed coordinates."""
    with open(os.path.join(capdir, "manifest.json")) as fh:
        man = json.load(fh)
    ax = man.get("axis", "y")
    off, p0 = line_offset_mm(capdir, man)
    o = man["shots"][0]["pose"]
    stops = []
    for a, b in ranges:
        g0 = p0 + (a - off) / IN_TO_MM          # gantry position whose line lands at a
        g1 = p0 + (b - off) / IN_TO_MM
        n = int(np.floor((g1 - g0) / step_in)) + 1
        for i in range(max(1, n)):
            g = round(g0 + i * step_in, 4)
            t = {"x": o["x"], "y": o["y"], "row": 0}
            t[ax] = g
            stops.append(t)
    return stops, {"axis": ax, "line_offset_mm": off, "z": o["z"], "b": o.get("b")}
