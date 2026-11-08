"""Straight-line laser sweep + triangulation into machine coordinates.

Capture (moves ONE axis in steps from the start pose, laser off/on pair at
every stop; laser always switched off and the head returned to the start
position at the end):
  python3 sweep.py capture <name> --axis y --start -0.5 --end 5.5 --step 0.1
    offsets are relative to the current position, inches
    -> captures/<name>/ off_NNN.jpg, on_NNN.jpg, manifest.json
       (same shot format as orbit.py / laser_plane.py manifests)

Triangulate:
  python3 sweep.py process captures/<name> [--ply out.ply]
    -> points.npy / cloud.ply (mm, machine axes) + a height map PNG and
       a table/top height report.

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
from laser_plane import load_cal, rays

IN_TO_MM = 25.4
AXES = ("x", "y", "z")


# ---------------------------------------------------------------- capture
def capture(args):
    import camera
    import fabmo_client as fabmo
    import scan_settings

    out_n = int(scan_settings.load()["laser_output"])
    ax = args.axis.lower()
    if ax not in ("x", "y"):
        raise SystemExit("--axis must be x or y")
    n = int(round((args.end - args.start) / args.step)) + 1
    offs = args.start + args.step * np.arange(n)
    outdir = os.path.join("captures", args.name)
    os.makedirs(outdir, exist_ok=True)

    cap = camera.open_camera()
    time.sleep(1.0)
    origin = fabmo.pose()
    print("origin %s; %d stops along %s from %+.3f to %+.3f in; laser out%d"
          % (origin, n, ax, offs[0], offs[-1], out_n), flush=True)
    shots = []
    t0 = time.time()
    try:
        fabmo.set_output(out_n, 0)
        for i, o in enumerate(offs):
            fabmo.goto(**{ax: origin[ax] + float(o)})
            time.sleep(0.3)
            pose = fabmo.pose()
            off = camera.grab(cap, flush=8)
            fabmo.set_output(out_n, 1)
            time.sleep(0.2)
            on = camera.grab(cap, flush=8)
            fabmo.set_output(out_n, 0)
            rec = {"pose": pose, "img_off": "off_%03d.jpg" % i, "img_on": "on_%03d.jpg" % i}
            cv2.imwrite(os.path.join(outdir, rec["img_off"]), off)
            cv2.imwrite(os.path.join(outdir, rec["img_on"]), on)
            shots.append(rec)
            if i % 10 == 0 or i == n - 1:
                print("  [%d/%d] %s=%.4f  %.0fs" % (i + 1, n, ax, pose[ax], time.time() - t0),
                      flush=True)
    finally:
        try:
            fabmo.set_output(out_n, 0)
        finally:
            try:
                fabmo.goto(**{ax: origin[ax]})
            finally:
                with open(os.path.join(outdir, "manifest.json"), "w") as fh:
                    json.dump({"units": "inches", "origin": origin, "axis": ax,
                               "laser_output": out_n, "shots": shots}, fh, indent=2)
    print("wrote %s/manifest.json (%d shots); laser off, %s back to %.4f"
          % (outdir, len(shots), ax, origin[ax]))


# ------------------------------------------------------------ triangulate
def triangulate_shot(off, on, K, D, m, c, R_mc, dpose_mm, signal="rg"):
    pts = stripe.extract(off, on, orientation="horizontal", signal=signal)
    pts = stripe.clean(pts, orientation="horizontal")
    if len(pts) == 0:
        return np.zeros((0, 4))
    r = rays(pts[:, [1, 0]], K, D)                  # (col, row) -> rays
    X = r * (c / (r @ m))[:, None]                  # on the laser sheet, camera frame
    P = X @ R_mc + dpose_mm                         # R_mc^T X, machine axes, mm
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


def write_ply(path, P):
    with open(path, "w") as fh:
        fh.write("ply\nformat ascii 1.0\nelement vertex %d\n"
                 "property float x\nproperty float y\nproperty float z\nend_header\n" % len(P))
        np.savetxt(fh, P[:, :3], fmt="%.3f")


def process(args):
    K, D, R_mc, _ = load_cal()
    with open("laser.json") as fh:
        las = json.load(fh)
    m, c = np.array(las["plane_normal_cam"]), float(las["plane_offset_mm"])
    with open(os.path.join(args.capdir, "manifest.json")) as fh:
        man = json.load(fh)
    p0 = np.array([man["shots"][0]["pose"][a] for a in AXES])
    allP = []
    for s in man["shots"]:
        off = cv2.imread(os.path.join(args.capdir, s["img_off"]))
        on = cv2.imread(os.path.join(args.capdir, s["img_on"]))
        dp = (np.array([s["pose"][a] for a in AXES]) - p0) * IN_TO_MM
        allP.append(triangulate_shot(off, on, K, D, m, c, R_mc, dp, args.signal))
    P = np.vstack(allP)
    print("%d shots -> %d points" % (len(man["shots"]), len(P)))

    # table = the most populated Z level; heights relative to it
    # Flat levels = histogram peaks holding >= 5% of the points. The table
    # is the LOWEST such level (a large part's top can outnumber the table).
    z = P[:, 2]
    hist, edges = np.histogram(z, bins=np.arange(z.min(), z.max() + 1.0, 1.0))
    big = np.nonzero(hist >= 0.05 * len(z))[0]
    zt = edges[big[0]] + 0.5
    zt = np.median(z[np.abs(z - zt) < 2.0])
    tab_co, tab_rms = plane_z(P[np.abs(z - zt) < 2.0])
    P[:, 2] -= P[:, 0] * tab_co[0] + P[:, 1] * tab_co[1] + tab_co[2]   # level to the table
    np.save(os.path.join(args.capdir, "points.npy"), P)
    write_ply(args.ply or os.path.join(args.capdir, "cloud.ply"), P)
    print("table: plane rms %.3f mm, tilt %.2f deg in X, %.2f deg in Y (levelled out)"
          % (tab_rms, np.degrees(np.arctan(tab_co[0])), np.degrees(np.arctan(tab_co[1]))))

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
        print("top:   %d pts, height %.2f mm (%.4f in), plane rms %.3f mm, "
              "tilt %.2f / %.2f deg"
              % (len(topP), np.median(topP[:, 2]), np.median(topP[:, 2]) / IN_TO_MM,
                 rms, np.degrees(np.arctan(co[0])), np.degrees(np.arctan(co[1]))))
        for lab, k in (("X", 0), ("Y", 1)):
            lo, hi_ = np.percentile(topP[:, k], [0.5, 99.5])
            print("  top extent %s: %.1f .. %.1f mm  -> %.1f mm (%.3f in)"
                  % (lab, lo, hi_, hi_ - lo, (hi_ - lo) / IN_TO_MM))

    # height map, 0.5 mm cells (max Z per cell)
    cell = 0.5
    ij = np.floor((P[:, :2] - P[:, :2].min(0)) / cell).astype(int)
    W, H = ij.max(0) + 1
    hm = np.full((H, W), np.nan)
    order = np.argsort(P[:, 2])
    hm[ij[order, 1], ij[order, 0]] = P[order, 2]
    v = np.nan_to_num((hm - np.nanmin(hm)) / max(np.nanmax(hm) - np.nanmin(hm), 1e-6) * 255)
    img = cv2.applyColorMap(v.astype(np.uint8), cv2.COLORMAP_JET)
    img[np.isnan(hm)] = 0
    img = cv2.flip(img, 0)                           # +Y up
    cv2.imwrite(os.path.join(args.capdir, "heightmap.png"), img)
    print("wrote points.npy, cloud.ply, heightmap.png in %s" % args.capdir)


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
    p.add_argument("--ply")
    p.add_argument("--signal", default="rg", choices=("r", "rg"),
                   help="stripe signal (see stripe.extract); rg copes with clipped red")
    p.set_defaults(fn=process)
    a = ap.parse_args()
    a.fn(a)
