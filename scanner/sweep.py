"""Straight-line laser sweep + triangulation into machine coordinates.

Capture (moves ONE axis in steps from the start pose, laser off/on pair at
every stop; laser always switched off and the head returned to the start
position at the end):
  python3 sweep.py capture <name> --axis y --start -0.5 --end 5.5 --step 0.1
    offsets are relative to the current position, inches
    -> captures/<name>/ off_NNN.jpg, on_NNN.jpg, manifest.json
       (same shot format as orbit.py / laser_plane.py manifests)

Triangulate:
  python3 sweep.py process captures/<name>
    -> points.npy (N x 4: x y z signal), points.bin (float32 x y z, for the
       viewer), cloud.ply, surface.bin (float32 height grid), heightmap.png,
       scan.json (stats + grid geometry). All mm, machine axes, Z levelled
       to the table.

scand.py drives the same code through run_capture() / process_dir().

Geometry. The laser sheet is a fixed plane in the camera frame (laser.json:
m . X = c). A stripe pixel's ray r gives X_cam = r * c / (m . r). The
camera moves rigidly with the gantry (pan/B fixed), so with R_mc the
machine->camera rotation (mount.json) a point in machine axes is

    P = R_mc^T X_cam + 25.4 * (pose - pose_0)          [mm]

i.e. relative to the camera centre at the first shot. Absolute machine
coordinates would need the camera-to-tool offset, which isn't calibrated;
heights are reported relative to the table (lowest large flat level).
"""

import argparse
import json
import os
import time

import cv2
import numpy as np

import stripe

HERE = os.path.dirname(os.path.abspath(__file__))
IN_TO_MM = 25.4
AXES = ("x", "y", "z")
SURFACE_CELL_MM = 1.0


class Aborted(Exception):
    pass


# ---------------------------------------------------------------- capture
def run_capture(fabmo, grab, outdir, axis, start, end, step, laser_out,
                progress=None, abort=None, log=print):
    """Step `axis` from origin+start to origin+end (inches, relative to the
    current position), grabbing a laser off/on pair at each stop.

    grab()      -> BGR frame (must return a fresh frame)
    progress(done, total), abort: threading.Event-like (checked per stop)
    Always switches the laser off and returns the axis to its start
    position, also on abort/error; the manifest is written either way.
    Returns the manifest dict.
    """
    ax = axis.lower()
    if ax not in ("x", "y"):
        raise ValueError("axis must be x or y")
    if step <= 0 or end <= start:
        raise ValueError("need step > 0 and end > start")
    n = int(round((end - start) / step)) + 1
    if n > 2000:
        raise ValueError("%d stops is too many" % n)
    offs = start + step * np.arange(n)
    os.makedirs(outdir, exist_ok=True)

    origin = fabmo.pose()
    log("origin %s; %d stops along %s from %+.3f to %+.3f in; laser out%d"
        % (origin, n, ax, offs[0], offs[-1], laser_out))
    man = {"kind": "sweep", "units": "inches", "origin": origin, "axis": ax,
           "start": start, "end": end, "step": step, "laser_output": laser_out,
           "created": time.strftime("%Y-%m-%d %H:%M:%S"), "complete": False,
           "shots": []}
    t0 = time.time()
    try:
        fabmo.set_output(laser_out, 0)
        for i, o in enumerate(offs):
            if abort is not None and abort.is_set():
                raise Aborted()
            fabmo.goto(**{ax: origin[ax] + float(o)})
            time.sleep(0.3)
            pose = fabmo.pose()
            off = grab()
            fabmo.set_output(laser_out, 1)
            time.sleep(0.2)
            on = grab()
            fabmo.set_output(laser_out, 0)
            rec = {"pose": pose, "img_off": "off_%03d.jpg" % i, "img_on": "on_%03d.jpg" % i}
            cv2.imwrite(os.path.join(outdir, rec["img_off"]), off)
            cv2.imwrite(os.path.join(outdir, rec["img_on"]), on)
            man["shots"].append(rec)
            if progress:
                progress(i + 1, n)
            if i % 10 == 0 or i == n - 1:
                log("  [%d/%d] %s=%.4f  %.0fs" % (i + 1, n, ax, pose[ax], time.time() - t0))
        man["complete"] = True
    finally:
        try:
            fabmo.set_output(laser_out, 0)
        finally:
            try:
                fabmo.goto(**{ax: origin[ax]})
            finally:
                man["duration_s"] = round(time.time() - t0, 1)
                with open(os.path.join(outdir, "manifest.json"), "w") as fh:
                    json.dump(man, fh, indent=2)
    log("wrote %s/manifest.json (%d shots); laser off, %s back to %.4f"
        % (outdir, len(man["shots"]), ax, origin[ax]))
    return man


def capture(args):
    import camera
    import fabmo_client as fabmo
    import scan_settings

    cap = camera.open_camera()
    time.sleep(1.0)
    run_capture(fabmo, lambda: camera.grab(cap, flush=8),
                os.path.join("captures", args.name), args.axis, args.start,
                args.end, args.step, int(scan_settings.load()["laser_output"]),
                log=lambda s: print(s, flush=True))


# ------------------------------------------------------------ triangulate
def load_cal():
    def rd(name):
        with open(os.path.join(HERE, name)) as fh:
            return json.load(fh)
    cam, mount, las = rd("camera.json"), rd("mount.json"), rd("laser.json")
    return {"K": np.array(cam["camera_matrix"]), "D": np.array(cam["dist_coeffs"]),
            "R_mc": np.array(mount["R_machine_to_camera"]),
            "m": np.array(las["plane_normal_cam"]), "c": float(las["plane_offset_mm"])}


def triangulate_shot(off, on, cal, dpose_mm, signal="rg"):
    """-> (N, 4) [x, y, z, signal], mm, machine axes."""
    pts = stripe.extract(off, on, orientation="horizontal", signal=signal)
    pts = stripe.clean(pts, orientation="horizontal")
    if len(pts) == 0:
        return np.zeros((0, 4))
    u = cv2.undistortPoints(pts[:, [1, 0]].reshape(-1, 1, 2).astype(np.float64),
                            cal["K"], cal["D"]).reshape(-1, 2)
    r = np.c_[u, np.ones(len(u))]                       # camera rays
    X = r * (cal["c"] / (r @ cal["m"]))[:, None]        # on the laser sheet, camera frame
    P = X @ cal["R_mc"] + dpose_mm                      # R_mc^T X, machine axes, mm
    return np.c_[P, pts[:, 2]]


def plane_z(Q, iters=4):
    """Robust fit z = a x + b y + c. Returns ((a, b, c), rms of inliers)."""
    A = np.c_[Q[:, 0], Q[:, 1], np.ones(len(Q))]
    keep = np.ones(len(Q), bool)
    for _ in range(iters):
        co = np.linalg.lstsq(A[keep], Q[keep, 2], rcond=None)[0]
        r = Q[:, 2] - A @ co
        keep = np.abs(r) < 3 * max(r[keep].std(), 0.05)
    return co, float(r[keep].std())


def _neighbourhood_counts(key3, dims):
    """For integer voxel coords key3 (N,3, >= 1, < dims-1), number of points
    in each point's 3x3x3 voxel neighbourhood (itself included)."""
    key = (key3[:, 0] * dims[1] + key3[:, 1]) * dims[2] + key3[:, 2]
    uk, cnt = np.unique(key, return_counts=True)
    total = np.zeros(len(key), np.int64)
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for dz in (-1, 0, 1):
                k = key + (dx * dims[1] + dy) * dims[2] + dz
                i = np.searchsorted(uk, k)
                i[i >= len(uk)] = 0
                total += np.where(uk[i] == k, cnt[i], 0)
    return total


def drop_unsupported(P, shot, step_mm, min_support=3, vz=2.0):
    """Keep points that OTHER shots confirm: at least min_support points
    from different shots in the 3x3x3 voxel neighbourhood (XY voxel sized
    to the sweep step, Z voxel vz mm). A real surface is crossed by
    neighbouring stripes; a reflection or speck shows up in one shot only
    (e.g. a glint off a chip on the table triangulated 105 mm up)."""
    vxy = max(2.0, 1.2 * step_mm)
    v = np.floor(P[:, :3] / np.array([vxy, vxy, vz])).astype(np.int64)
    v -= v.min(0) - 1
    dims = v.max(0) + 2
    all_n = _neighbourhood_counts(v, dims)
    # same-shot counts: separate the shots along X by a gap > 1 voxel
    vs = v.copy()
    vs[:, 0] += shot.astype(np.int64) * (dims[0] + 2)
    dims_s = dims.copy()
    dims_s[0] = vs[:, 0].max() + 2
    same_n = _neighbourhood_counts(vs, dims_s)
    return (all_n - same_n) >= min_support


def write_ply(path, P):
    with open(path, "w") as fh:
        fh.write("ply\nformat ascii 1.0\nelement vertex %d\n"
                 "property float x\nproperty float y\nproperty float z\nend_header\n" % len(P))
        np.savetxt(fh, P[:, :3], fmt="%.3f")


def _fill_runs(line, max_gap):
    """Linearly interpolate NaN runs of length <= max_gap that have valid
    values on both sides (in place)."""
    ok = ~np.isnan(line)
    idx = np.nonzero(ok)[0]
    if len(idx) < 2:
        return
    gaps = np.diff(idx)
    for k in np.nonzero((gaps > 1) & (gaps <= max_gap + 1))[0]:
        a, b = idx[k], idx[k + 1]
        line[a + 1:b] = np.interp(np.arange(a + 1, b), [a, b], [line[a], line[b]])


def height_grid(P, cell, sweep_axis="y", max_gap_mm=4.0):
    """Max-height grid: (H, W) float32 (rows = Y, cols = X) with NaN holes,
    and its origin (mm). Gaps between successive stripes are bridged by
    linear interpolation along the sweep direction (up to max_gap_mm);
    larger holes (occlusion shadows) stay NaN."""
    lo = np.floor(P[:, :2].min(0) / cell) * cell
    ij = np.floor((P[:, :2] - lo) / cell).astype(int)
    W, H = ij.max(0) + 1
    grid = np.full((H, W), np.nan, np.float32)
    order = np.argsort(P[:, 2])                       # last write wins -> max
    grid[ij[order, 1], ij[order, 0]] = P[order, 2]
    gap = int(round(max_gap_mm / cell))
    if sweep_axis == "y":
        for col in range(W):
            _fill_runs(grid[:, col], gap)
    else:
        for row in range(H):
            _fill_runs(grid[row, :], gap)
    # isolated single-cell holes across the stripe direction
    for row in range(H):
        _fill_runs(grid[row, :], 1)
    return grid, lo


def process_dir(capdir, signal="rg", log=print, progress=None):
    """Triangulate a sweep capture directory. Returns the stats dict (also
    written to scan.json)."""
    cal = load_cal()
    with open(os.path.join(capdir, "manifest.json")) as fh:
        man = json.load(fh)
    shots = man["shots"]
    if not shots:
        raise RuntimeError("no shots in %s" % capdir)
    p0 = np.array([shots[0]["pose"][a] for a in AXES])
    allP, shot_ids = [], []
    for i, s in enumerate(shots):
        off = cv2.imread(os.path.join(capdir, s["img_off"]))
        on = cv2.imread(os.path.join(capdir, s["img_on"]))
        dp = (np.array([s["pose"][a] for a in AXES]) - p0) * IN_TO_MM
        allP.append(triangulate_shot(off, on, cal, dp, signal))
        shot_ids.append(np.full(len(allP[-1]), i))
        if progress:
            progress(i + 1, len(shots))
    P = np.vstack(allP)
    sid = np.concatenate(shot_ids)
    n_raw = len(P)
    step_mm = abs(float(man.get("step", 0.1))) * IN_TO_MM
    keep = drop_unsupported(P, sid, step_mm)
    P = P[keep]
    log("%d shots -> %d points (%d unsupported by neighbouring shots dropped)"
        % (len(shots), len(P), n_raw - len(P)))
    if len(P) < 100:
        raise RuntimeError("only %d stripe points found" % len(P))

    # Flat levels = histogram peaks holding >= 5% of the points. The table
    # is the LOWEST such level (a large part's top can outnumber the table).
    z = P[:, 2]
    hist, edges = np.histogram(z, bins=np.arange(z.min(), z.max() + 1.0, 1.0))
    big = np.nonzero(hist >= 0.05 * len(z))[0]
    zt = edges[big[0] if len(big) else np.argmax(hist)] + 0.5
    zt = np.median(z[np.abs(z - zt) < 2.0])
    tab_co, tab_rms = plane_z(P[np.abs(z - zt) < 2.0])
    P[:, 2] -= P[:, 0] * tab_co[0] + P[:, 1] * tab_co[1] + tab_co[2]   # level to the table
    stats = {
        "n_shots": len(shots), "n_points": int(len(P)), "signal": signal,
        "table": {"rms_mm": round(tab_rms, 3),
                  "tilt_x_deg": round(float(np.degrees(np.arctan(tab_co[0]))), 3),
                  "tilt_y_deg": round(float(np.degrees(np.arctan(tab_co[1]))), 3)},
        "bounds_mm": {"min": np.round(P[:, :3].min(0), 2).tolist(),
                      "max": np.round(P[:, :3].max(0), 2).tolist()},
        "top": None,
    }
    log("table: plane rms %.3f mm, tilt %.2f deg in X, %.2f deg in Y (levelled out)"
        % (tab_rms, stats["table"]["tilt_x_deg"], stats["table"]["tilt_y_deg"]))

    # top: the most populated level clearly above the table
    hi = P[P[:, 2] > 5.0]
    if len(hi) > 100:
        zh = hi[:, 2]
        hh, he = np.histogram(zh, bins=np.arange(zh.min(), zh.max() + 1.0, 1.0))
        top = he[np.argmax(hh)] + 0.5
        top = np.median(zh[np.abs(zh - top) < 2.0])
        topP = hi[np.abs(zh - top) < 2.0]
        co, rms = plane_z(topP)
        topP = topP[np.abs(topP[:, 2] - (topP[:, :2] @ co[:2] + co[2])) < 3 * rms]
        h = float(np.median(topP[:, 2]))
        ext = {}
        for lab, k in (("x", 0), ("y", 1)):
            lo, hi_ = np.percentile(topP[:, k], [0.5, 99.5])
            ext[lab] = [round(float(lo), 2), round(float(hi_), 2)]
        stats["top"] = {"height_mm": round(h, 3), "n_points": int(len(topP)),
                        "rms_mm": round(rms, 3),
                        "tilt_x_deg": round(float(np.degrees(np.arctan(co[0]))), 3),
                        "tilt_y_deg": round(float(np.degrees(np.arctan(co[1]))), 3),
                        "extent_mm": ext}
        log("top:   %d pts, height %.2f mm (%.4f in), plane rms %.3f mm, tilt %.2f / %.2f deg"
            % (len(topP), h, h / IN_TO_MM, rms, stats["top"]["tilt_x_deg"],
               stats["top"]["tilt_y_deg"]))
        for lab in ("x", "y"):
            lo, hi_ = ext[lab]
            log("  top extent %s: %.1f .. %.1f mm  -> %.1f mm (%.3f in)"
                % (lab.upper(), lo, hi_, hi_ - lo, (hi_ - lo) / IN_TO_MM))

    # outputs
    np.save(os.path.join(capdir, "points.npy"), P)
    P[:, :3].astype("<f4").tofile(os.path.join(capdir, "points.bin"))
    write_ply(os.path.join(capdir, "cloud.ply"), P)
    grid, lo = height_grid(P, SURFACE_CELL_MM, man.get("axis", "y"))
    grid.astype("<f4").tofile(os.path.join(capdir, "surface.bin"))
    stats["surface"] = {"cell_mm": SURFACE_CELL_MM, "origin_mm": lo.tolist(),
                        "width": int(grid.shape[1]), "height": int(grid.shape[0])}
    v = np.nan_to_num((grid - np.nanmin(grid)) /
                      max(float(np.nanmax(grid) - np.nanmin(grid)), 1e-6) * 255)
    img = cv2.applyColorMap(v.astype(np.uint8), cv2.COLORMAP_JET)
    img[np.isnan(grid)] = 0
    cv2.imwrite(os.path.join(capdir, "heightmap.png"), cv2.flip(img, 0))   # +Y up
    stats["processed"] = time.strftime("%Y-%m-%d %H:%M:%S")
    with open(os.path.join(capdir, "scan.json"), "w") as fh:
        json.dump(stats, fh, indent=2)
    log("wrote points.bin, surface.bin, cloud.ply, heightmap.png, scan.json in %s" % capdir)
    return stats


def process(args):
    process_dir(args.capdir, args.signal)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("capture")
    c.add_argument("name")
    c.add_argument("--axis", default="y")
    c.add_argument("--start", type=float, default=-0.5)
    c.add_argument("--end", type=float, default=5.5)
    c.add_argument("--step", type=float, default=0.1)
    c.set_defaults(fn=capture)
    p = sub.add_parser("process")
    p.add_argument("capdir")
    p.add_argument("--signal", default="rg", choices=("r", "rg"),
                   help="stripe signal (see stripe.extract); rg copes with clipped red")
    p.set_defaults(fn=process)
    a = ap.parse_args()
    a.fn(a)
