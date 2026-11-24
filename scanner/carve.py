"""Cut a copy: ball-nose raster toolpath (.sbp) from a processed scan.

The strategy is Terrain Carver's (ShopBot Labs, kernel/src/ballnose.rs,
toolpath.rs, sbp.rs), applied to the scan's height surface instead of a
terrain image:

  * Ball-nose compensation. The tool tip under the ball centre (x, y) must
    sit at  max over the ball's footprint of  h(x+dx, y+dy) + sqrt(R^2 - d^2) - R
    so the hemisphere touches the surface without cutting into it anywhere.
  * Serpentine raster along X, stepping over in Y by a fraction of the bit
    diameter; points along a line at the same spacing.
  * Roughing on the first line only: it is the one full-width slot, so it is
    repeated at depth steps; every later line takes just one stepover of
    material at full depth.
  * Optional Gaussian smoothing of Z along each line, never below the
    compensated value (cannot overcut).
  * Line simplification: runs of points within a Z tolerance of a chord are
    replaced by the chord (slope-interval test against every skipped point).

Coordinates of the cut file (inches): X0 Y0 is the lower-left corner of the
cut area, Z0 the top of the blank = the highest point of the scanned part.
The scan's own X/Y directions are kept (machine axes), so the copy comes out
the same way round as the original sat on the table.

    python3 carve.py <session> [--bit 0.25 --stepover 10 --depth 1.0 ...]

writes data/scans/<session>/copy.sbp, copy.json and copy_path.bin (the tool-tip
path in scan coordinates, for the app's 3D preview). Nothing is run or sent
to the machine.
"""

import argparse
import json
import os
import time

import numpy as np

IN_TO_MM = 25.4

DEFAULTS = {
    "bit_diameter": 0.25,       # in, ball-nose
    "stepover_pct": 10.0,       # % of the bit diameter
    "max_depth": 1.0,           # in below the part's top; deeper surface is cut flat there
    "roughing_depth": 0.125,    # in per step on the first line (0 = off)
    "feed_rate": 100.0,         # in/min
    "plunge_rate": 50.0,        # in/min
    "safe_z": 0.5,              # in above the blank
    "spindle_speed": 18000,
    "smoothing": 2,             # Gaussian radius in toolpath points (0 = off)
    "simplify_tolerance": 0.001,  # in
    "margin": 0.25,             # in of table kept round the part (crop = part)
    "crop": "part",             # "part" or "all"
    "cell_mm": 0.25,            # largest height-grid cell; the actual one divides the stepover
    "scale": 1.0,
}


# ------------------------------------------------------------- height surface
def _fill_holes(g, floor):
    """NaN cells (laser shadows beside walls, steep faces) -> filled from
    their neighbours, working inwards from the hole's edge (mean of the
    valid cells in the 3 x 3 neighbourhood each round). Anything still empty
    after that (no data at all) is set to `floor`."""
    g = g.copy()
    for _ in range(4 * max(g.shape)):
        nan = np.isnan(g)
        if not nan.any():
            break
        v = np.where(nan, 0.0, g)
        w = (~nan).astype(np.float32)
        ps = np.pad(v, 1)
        pw = np.pad(w, 1)
        s = np.zeros_like(v)
        n = np.zeros_like(w)
        for dy in (0, 1, 2):
            for dx in (0, 1, 2):
                s += ps[dy:dy + g.shape[0], dx:dx + g.shape[1]]
                n += pw[dy:dy + g.shape[0], dx:dx + g.shape[1]]
        fill = nan & (n > 0)
        if not fill.any():
            break
        g[fill] = s[fill] / n[fill]
    g[np.isnan(g)] = floor
    return g


def _despike(g, cell_mm, width_mm=2.0, height_mm=3.0):
    """Remove stray tall points: cells standing more than height_mm above
    what is left when everything narrower than width_mm is taken away (a
    grey opening). One false point 60 mm up would otherwise become a pillar
    in the copy and set the top of the blank. Real features that thin and
    that tall could not be cut with a ball-nose bit anyway. -> (grid with
    the spikes set to NaN, number removed)."""
    import cv2
    k = max(3, int(round(width_mm / cell_mm)) | 1)
    low = np.where(np.isnan(g), -1e3, g).astype(np.float32)
    opened = cv2.morphologyEx(low, cv2.MORPH_OPEN,
                              cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
    spike = (low - opened > height_mm) & ~np.isnan(g)
    g = g.copy()
    g[spike] = np.nan
    return g, int(spike.sum())


def scan_surface(capdir, cell_mm=0.25, crop="part", margin_mm=6.0, part_min_mm=3.0):
    """Height grid of a processed scan for carving: (H, W) float32 mm above
    the table (rows = Y, cols = X), no holes, and info (cell, origin, how
    much was filled)."""
    import sweep
    P = np.load(os.path.join(capdir, "points.npy"))[:, :3]
    axis = "y"
    try:
        with open(os.path.join(capdir, "manifest.json")) as fh:
            man = json.load(fh)
        axis = "both" if man.get("kind") == "multi" else man.get("axis", "y")
    except Exception:
        pass
    g, lo = sweep.height_grid(P, cell_mm, axis, max_gap_mm=4.0)
    g, n_spikes = _despike(g, cell_mm)
    H, W = g.shape
    r0, r1, c0, c1 = 0, H, 0, W
    if crop == "part":
        rr, cc = np.nonzero(np.nan_to_num(g, nan=0.0) > part_min_mm)
        if len(rr) == 0:
            raise RuntimeError("nothing in this scan stands more than %.0f mm above the table"
                               % part_min_mm)
        m = int(np.ceil(margin_mm / cell_mm))
        r0, r1 = max(0, rr.min() - m), min(H, rr.max() + m + 1)
        c0, c1 = max(0, cc.min() - m), min(W, cc.max() + m + 1)
    g = g[r0:r1, c0:c1]
    holes = float(np.isnan(g).mean())
    g = np.maximum(_fill_holes(g, 0.0), 0.0)        # nothing below the table
    info = {"cell_mm": cell_mm, "origin_mm": [float(lo[0] + c0 * cell_mm), float(lo[1] + r0 * cell_mm)],
            "width": int(g.shape[1]), "height": int(g.shape[0]), "filled_pct": round(100 * holes, 2),
            "spike_cells": n_spikes}
    return g.astype(np.float32), info


# ------------------------------------------------------------------ toolpath
def tip_surface(h, radius, cell):
    """Ball-nose compensated tool-tip height for the ball centred over every
    grid cell: max over the footprint of h + sqrt(R^2 - d^2) - R (a grey
    dilation with the ball). h, radius, cell in the same units."""
    n = int(np.ceil(radius / cell))
    hp = np.pad(h, n, mode="edge")
    out = np.full(h.shape, -np.inf, np.float32)
    H, W = h.shape
    r2 = radius * radius
    for dy in range(-n, n + 1):
        for dx in range(-n, n + 1):
            d2 = (dx * cell) ** 2 + (dy * cell) ** 2
            if d2 < r2:
                zo = np.float32(np.sqrt(r2 - d2) - radius)
                np.maximum(out, hp[n + dy:n + dy + H, n + dx:n + dx + W] + zo, out=out)
    return out


def _smooth(z, radius):
    r = int(radius)
    sigma = r / 2.5
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    num = np.convolve(z, k, mode="same")
    den = np.convolve(np.ones_like(z), k, mode="same")
    return np.maximum(num / den, z)              # only ever raises the tool


def _simplify(d, z, tol):
    """Indices to keep of a profile z(d): every dropped point stays within
    tol (in Z) of the chord that replaces it."""
    n = len(z)
    if n < 3 or tol <= 0:
        return np.arange(n)
    keep = [0]
    anchor = 0
    lo, hi = -np.inf, np.inf
    prev = 0
    for i in range(1, n):
        dist = d[i] - d[anchor]
        dz = z[i] - z[anchor]
        if dist < 1e-9:
            prev = i
            continue
        s = dz / dist
        if s < lo or s > hi:
            keep.append(prev)
            anchor = prev
            lo, hi = -np.inf, np.inf
            dist = d[i] - d[anchor]
            dz = z[i] - z[anchor]
            if dist < 1e-9:
                prev = i
                continue
        lo = max(lo, (dz - tol) / dist)
        hi = min(hi, (dz + tol) / dist)
        prev = i
    if keep[-1] != n - 1:
        keep.append(n - 1)
    return np.array(keep)


def toolpath(h_in, cell_in, cfg, rows_per_step=1):
    """h_in: (H, W) surface in inches, 0 at the top of the blank, negative
    below (already limited to -max_depth); cell_in: grid cell in inches;
    rows_per_step: raster lines are this many grid rows apart.
    -> list of passes, each an (N, 3) array of x, y, z (inches).

    Every toolpath point sits exactly on a grid node — lines on grid rows,
    points on every column — so the compensated height is used as computed,
    never interpolated: interpolating it across a steep wall let the ball
    cut up to 0.065 in into the wall of the letter scan. Simplification
    then thins the points along each line."""
    R = cfg["bit_diameter"] / 2.0
    if R <= 0:
        raise ValueError("bit diameter must be positive")
    min_z = float(h_in.min())
    tip = np.clip(tip_surface(h_in, R, cell_in), min_z, 0.0)
    H, W = h_in.shape
    xs = np.arange(W) * cell_in
    rows = list(range(0, H, int(rows_per_step)))
    if rows[-1] != H - 1:
        rows.append(H - 1)
    passes = []

    def one(row, forward, ceiling):
        y = row * cell_in
        z = tip[row].astype(np.float64)
        if ceiling is not None:
            z = np.maximum(z, ceiling)
        if cfg.get("smoothing", 0) and len(z) > 2:
            z = _smooth(z, cfg["smoothing"])
        k = _simplify(xs, z, cfg.get("simplify_tolerance", 0.0))
        p = np.c_[xs[k], np.full(len(k), y), z[k]]
        passes.append(p if forward else p[::-1])

    rough = float(cfg.get("roughing_depth") or 0.0)
    for j, row in enumerate(rows):
        if j == 0 and rough > 0:
            ceiling = -rough                 # (a first step at Z0 would cut air)
            while ceiling > min_z:
                one(row, len(passes) % 2 == 0, ceiling)
                ceiling -= rough
        one(row, len(passes) % 2 == 0, None)
    return passes


def sbp(passes, cfg, title="3D Scanner copy", notes=()):
    """ShopBot part file, same layout as Terrain Carver's."""
    n_pts = sum(len(p) for p in passes)
    out = ["'%s - Ballnose Raster Toolpath" % title,
           "'Bit diameter: %.4f" % cfg["bit_diameter"],
           "'Stepover: %.1f%%" % cfg["stepover_pct"],
           "'Min Z: %.4f, Max Z: %.4f" % (min(float(p[:, 2].min()) for p in passes), 0.0),
           "'Passes: %d, Points: %d" % (len(passes), n_pts)]
    out += ["'" + n for n in notes]
    out += ["",
            "SA",
            "TR,%d" % int(cfg["spindle_speed"]),
            "C6",
            "PAUSE 2",
            "MS,%.4f,%.4f" % (cfg["feed_rate"] / 60.0, cfg["plunge_rate"] / 60.0),
            "JZ,%.4f" % cfg["safe_z"],
            ""]
    first = True
    for i, p in enumerate(passes):
        out.append("'Pass %d" % (i + 1))
        if first:
            out.append("J2,%.4f,%.4f" % (p[0, 0], p[0, 1]))
            first = False
        out.extend("M3,%.4f,%.4f,%.4f" % (x, y, z) for x, y, z in p)
    out += ["JZ,%.4f" % cfg["safe_z"], "", "C7", "JZ,%.4f" % cfg["safe_z"], "J2,0,0", "END", ""]
    return "\n".join(out)


def _length(passes):
    pts = np.vstack(passes)
    return float(np.sqrt((np.diff(pts, axis=0) ** 2).sum(1)).sum())


# ---------------------------------------------------------------- top level
def make_copy(capdir, params=None, log=print):
    """Generate copy.sbp + copy.json in the scan's folder. -> stats dict."""
    cfg = dict(DEFAULTS)
    for k, v in (params or {}).items():
        if k in cfg and v is not None and v != "":
            cfg[k] = v if k == "crop" else float(v)
    cfg["smoothing"] = int(cfg["smoothing"])
    if not (0.02 <= cfg["bit_diameter"] <= 2.0):
        raise ValueError("bit diameter must be 0.02 to 2 in")
    if not (1.0 <= cfg["stepover_pct"] <= 100.0):
        raise ValueError("stepover must be 1 to 100 % of the bit diameter")
    if not (0.1 <= cfg["scale"] <= 10.0):
        raise ValueError("scale must be 0.1 to 10")
    if cfg["max_depth"] <= 0 or cfg["feed_rate"] <= 0 or cfg["plunge_rate"] <= 0:
        raise ValueError("depth and speeds must be positive")
    t0 = time.time()
    sc = cfg["scale"]
    # grid cell (scan mm) = the stepover divided by a whole number, so that
    # raster lines fall on grid rows
    step_mm = cfg["bit_diameter"] * cfg["stepover_pct"] / 100.0 * IN_TO_MM / sc
    n_sub = max(1, int(np.ceil(step_mm / cfg["cell_mm"] - 1e-9)))
    cell_mm = step_mm / n_sub
    g, info = scan_surface(capdir, cell_mm, cfg["crop"], cfg["margin"] * IN_TO_MM)
    top_mm = float(g.max())
    h = (g - top_mm) / IN_TO_MM * sc                 # inches, 0 at the top
    clipped = float((h < -cfg["max_depth"]).mean())
    h = np.maximum(h, -cfg["max_depth"]).astype(np.float32)
    cell_in = cell_mm / IN_TO_MM * sc
    passes = toolpath(h, cell_in, cfg, n_sub)
    length = _length(passes)
    width_in = (g.shape[1] - 1) * cell_in
    height_in = (g.shape[0] - 1) * cell_in
    depth = -min(float(p[:, 2].min()) for p in passes)
    notes = ["Scan: %s" % os.path.basename(os.path.normpath(capdir)),
             "Blank: %.3f x %.3f in, at least %.3f thick" % (width_in, height_in, depth),
             "X0 Y0 = lower-left corner of the blank, Z0 = top of the blank",
             "Scale: %.3f" % sc]
    text = sbp(passes, cfg, notes=notes)
    with open(os.path.join(capdir, "copy.sbp"), "w") as fh:
        fh.write(text)
    # the same path for the 3D preview: tool-tip positions in the scan's own
    # coordinates (mm, Z above the table), float32 x y z in cutting order
    pts = np.vstack(passes)
    ox, oy = info["origin_mm"]
    prev = np.c_[ox + pts[:, 0] * IN_TO_MM / sc, oy + pts[:, 1] * IN_TO_MM / sc,
                 top_mm + pts[:, 2] * IN_TO_MM / sc]
    prev.astype("<f4").tofile(os.path.join(capdir, "copy_path.bin"))
    stats = {"params": cfg, "surface": info,
             "blank_in": {"x": round(width_in, 3), "y": round(height_in, 3),
                          "z_min": round(depth, 3)},
             "part_top_mm": round(top_mm, 2),
             "cut_depth_in": round(depth, 4),
             "flattened_pct": round(100 * clipped, 1),
             "passes": len(passes), "points": int(sum(len(p) for p in passes)),
             "length_in": round(length, 1),
             "minutes": round(length / cfg["feed_rate"], 1),
             "file": "copy.sbp", "bytes": len(text),
             "created": time.strftime("%Y-%m-%d %H:%M:%S")}
    with open(os.path.join(capdir, "copy.json"), "w") as fh:
        json.dump(stats, fh, indent=1)
    log("copy: blank %.2f x %.2f in, cut %.3f in deep, %d passes, %d points, %.0f in of cutting "
        "(~%.0f min at %.0f in/min); %.1f%% of the area filled in, %.1f%% flattened at max depth; "
        "%.1f s" % (width_in, height_in, depth, stats["passes"], stats["points"], length,
                    stats["minutes"], cfg["feed_rate"], info["filled_pct"],
                    stats["flattened_pct"], time.time() - t0))
    return stats


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("session")
    ap.add_argument("--bit", type=float, dest="bit_diameter")
    ap.add_argument("--stepover", type=float, dest="stepover_pct")
    ap.add_argument("--depth", type=float, dest="max_depth")
    ap.add_argument("--roughing", type=float, dest="roughing_depth")
    ap.add_argument("--feed", type=float, dest="feed_rate")
    ap.add_argument("--plunge", type=float, dest="plunge_rate")
    ap.add_argument("--safe-z", type=float, dest="safe_z")
    ap.add_argument("--rpm", type=float, dest="spindle_speed")
    ap.add_argument("--smoothing", type=float)
    ap.add_argument("--margin", type=float)
    ap.add_argument("--crop", choices=["part", "all"])
    ap.add_argument("--scale", type=float)
    a = vars(ap.parse_args())
    here = os.path.dirname(os.path.abspath(__file__))
    capdir = a.pop("session")
    if not os.path.isdir(capdir):
        capdir = os.path.join(here, "data", "scans", capdir)
    make_copy(capdir, a)


if __name__ == "__main__":
    main()
