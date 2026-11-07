"""Laser-plane calibration from the stripe on the bare (flat) table.

The laser and camera are rigid on the head, so the laser sheet is a fixed
plane in the camera frame:  m . X = c   (m unit normal, c in mm).

Capture (machine moves Z only, DOWN from the start height; laser on the
configured output, always switched off at the end):
  python3 laser_plane.py capture <name> [--zs 0,-0.15,-0.3,-0.45,-0.6]
    -> captures/<name>/: img_off/img_on per Z + manifest.json (same shot
       format as orbit.py scan manifests)

Fit (use this one):
  python3 laser_plane.py fitboard captures/<name>   -> laser.json
    Chessboard lying flat with the stripe crossing it, captured at several
    Z offsets. Each laser-OFF frame locates the board (PnP, camera.json),
    so every stripe pixel on the board is an exact 3D point on the laser
    sheet; the plane is a direct mm least-squares fit.

Table-only fit (diagnostic; NOT sufficient on its own):
  python3 laser_plane.py fit captures/<name> [--board captures/handeye/img_000.jpg]
    With only a flat table, the stripe position vs the known Z steps is
    nearly linear over a usable Z range, which pins the plane's direction
    and the offset/height RATIO but not the camera-to-table distance — the
    fit is ill-conditioned (found 2026-11-07). Kept for inspection.

Fit model: table normal in the camera frame n = R_mc @ machine_Z (from
mount.json; assumes the table/spoilboard is square to the Z axis, true for
a surfaced spoilboard). At shot i the table is the plane n.X = d0 - dz_i,
dz_i the Z offset from the first shot (mm). Every stripe pixel ray r gives
X = r * d / (n.r). For a given d0 the laser plane is a linear (SVD) fit,
so d0 is found by a 1-D search minimising the plane-fit residual — the
known Z steps fix the scale. --board (a chessboard image taken at the
SAME machine pose as the first shot, board flat on the table) gives an
independent check: the board top should sit a few mm above the table.
"""

import argparse
import json
import os
import subprocess
import time

import cv2
import numpy as np

import stripe

IN_TO_MM = 25.4
PATTERN = (9, 6)


# ---------------------------------------------------------------- capture
def capture(args):
    import camera
    import fabmo_client as fabmo
    import scan_settings

    s = scan_settings.load()
    out_n = int(s["laser_output"])
    zs = [float(v) for v in args.zs.split(",")]
    if any(z > 0 for z in zs):
        raise SystemExit("--zs offsets must be <= 0 (down from the start height)")
    outdir = os.path.join("captures", args.name)
    os.makedirs(outdir, exist_ok=True)

    def laser(on):
        fabmo.set_output(out_n, 1 if on else 0)       # verified

    cap = camera.open_camera()
    subprocess.run(["v4l2-ctl", "-d", "/dev/video0", "--set-ctrl",
                    "brightness=%d" % args.brightness], capture_output=True)
    time.sleep(1.0)
    origin = fabmo.pose()
    print("origin: %s   laser on out%d" % (origin, out_n))
    shots = []
    try:
        laser(False)
        for i, zo in enumerate(zs):
            fabmo.goto(z=origin["z"] + zo)
            time.sleep(0.5)
            pose = fabmo.pose()
            off = camera.grab(cap, flush=10)
            laser(True)
            time.sleep(0.3)
            on = camera.grab(cap, flush=10)
            laser(False)
            rec = {"pose": pose, "img_off": "off_%02d.jpg" % i, "img_on": "on_%02d.jpg" % i}
            cv2.imwrite(os.path.join(outdir, rec["img_off"]), off)
            cv2.imwrite(os.path.join(outdir, rec["img_on"]), on)
            pts, ori = stripe.extract(off, on, return_orientation=True)
            n = len(stripe.clean(pts, orientation=ori))
            print("  [%d/%d] z=%.4f  %s stripe, %d points" % (
                i + 1, len(zs), pose["z"], ori, n), flush=True)
            shots.append(rec)
    finally:
        try:
            laser(False)
            fabmo.goto(z=origin["z"])
        finally:
            with open(os.path.join(outdir, "manifest.json"), "w") as fh:
                json.dump({"units": "inches", "origin": origin,
                           "laser_output": out_n, "shots": shots}, fh, indent=2)
    print("wrote %s/manifest.json (%d shots); laser off, Z back to %.4f" % (
        outdir, len(shots), origin["z"]))


# -------------------------------------------------------------- fit-board
def board_pose(img, K, D, cam, patterns=((9, 6), (9, 5), (9, 4), (8, 4))):
    """PnP of the chessboard in a laser-off frame -> (R, t, corners, err,
    (L, S), pattern) or None.

    Falls back to smaller inner-corner grids when the whole board isn't in
    view: any complete sub-grid gives the same board PLANE, which is all
    the laser-plane fit needs (board x/y coordinates may then be offset by
    whole squares — harmless here)."""
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    small = cv2.resize(g, None, fx=.5, fy=.5)
    for pat in patterns:
        ok, cc = cv2.findChessboardCorners(small, pat, cv2.CALIB_CB_ADAPTIVE_THRESH)
        if ok:
            break
    if not ok:
        return None
    crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 0.001)
    cc = cv2.cornerSubPix(g, (cc / .5).astype(np.float32), (11, 11), (-1, -1), crit)
    L, S = cam.get("square_size_mm_long_short", [cam["square_size_mm"]] * 2)
    objp = np.zeros((pat[0] * pat[1], 3))
    objp[:, :2] = np.mgrid[0:pat[0], 0:pat[1]].T.reshape(-1, 2) * [L, S]
    _, rv, tv = cv2.solvePnP(objp, cc, K, D)
    p, _ = cv2.projectPoints(objp, rv, tv, K, D)
    err = float(np.sqrt(((p.reshape(-1, 2) - cc.reshape(-1, 2)) ** 2).sum(1).mean()))
    return cv2.Rodrigues(rv)[0], tv.ravel(), cc.reshape(-1, 2), err, (L, S), pat


def fit_board(args):
    K, D, Rmc, cam = load_cal()
    with open(os.path.join(args.capdir, "manifest.json")) as fh:
        man = json.load(fh)
    allX, per = [], []
    for i, sh in enumerate(man["shots"]):
        off = cv2.imread(os.path.join(args.capdir, sh["img_off"]))
        on = cv2.imread(os.path.join(args.capdir, sh["img_on"]))
        bp = board_pose(off, K, D, cam)
        if bp is None:
            print("  shot %d: board not found — skipped" % i)
            continue
        Rb, tb, cc, perr, (L, S), pat = bp
        pts, ori = stripe.extract(off, on, return_orientation=True)
        pts = stripe.clean(pts, orientation=ori)
        # keep stripe points on the printed board: within 1.5 squares of the
        # detected inner-corner grid (covers the outer squares, and rows
        # beyond a partial-grid detection), in board coordinates
        r = rays(pts[:, [1, 0]], K, D)
        nb, db = Rb[:, 2], Rb[:, 2] @ tb               # board plane nb.X = db
        X = r * (db / (r @ nb))[:, None]
        B = (X - tb) @ Rb                              # board coordinates
        gx, gy = (pat[0] - 1) * L, (pat[1] - 1) * S
        inside = ((B[:, 0] > -1.5 * L) & (B[:, 0] < gx + 1.5 * L) &
                  (B[:, 1] > -1.5 * S) & (B[:, 1] < gy + 1.5 * S))
        X = X[inside]
        print("  shot %d z=%.4f: board %dx%d PnP %.2f px, %s stripe %d px on board (of %d)" % (
            i, sh["pose"]["z"], pat[0], pat[1], perr, ori, len(X), len(pts)))
        if len(X) >= 50:
            allX.append(X)
            per.append(i)
    if len(allX) < 2:
        raise SystemExit("need the stripe on the board in at least 2 shots")
    X = np.vstack(allX)
    m, c, res = plane_fit(X)
    if c < 0:
        m, c, res = -m, -c, -res
    rms = float(np.sqrt((res ** 2).mean()))
    # robust second pass: drop >4 sigma points (stripe on board edge/ink speck)
    keep = np.abs(res) < max(4 * rms, 0.05)
    m, c, res = plane_fit(X[keep])
    if c < 0:
        m, c, res = -m, -c, -res
    rms = float(np.sqrt((res ** 2).mean()))
    # per-shot consistency: each shot's points vs the common plane
    for i, Xi in zip(per, allX):
        print("    shot %d: mean offset %+.3f mm, rms %.3f mm" % (
            i, float((Xi @ m - c).mean()), float(np.sqrt(((Xi @ m - c) ** 2).mean()))))
    n = Rmc @ np.array([0.0, 0.0, 1.0])
    m_mach = Rmc.T @ m
    tilt = 90 - np.degrees(np.arccos(abs(m_mach[2])))
    # triangulation sensitivity: height change per px of stripe shift at
    # the stripe point nearest the image centre (from the first shot)
    # stripe point seen closest to the optical axis
    Xc = allX[0][np.argmin(np.linalg.norm(allX[0][:, :2] / allX[0][:, 2:], axis=1))]
    pix = cv2.projectPoints(Xc[None], np.zeros(3), np.zeros(3), K, D)[0].ravel()

    def height(px):
        r = rays(np.array([px]), K, D)[0]
        return n @ (r * (c / (m @ r)))
    step = np.array([0, 1.0]) if ori == "horizontal" else np.array([1.0, 0])
    dh = height(pix + step) - height(pix)
    span = np.ptp(X[keep] @ np.cross(m, np.cross(n, m)) / np.linalg.norm(np.cross(n, m)))
    print("\nlaser plane (camera frame): normal %s  offset %.2f mm" % (np.round(m, 4), c))
    print("  fit: RMS %.3f mm  max %.3f mm  over %d points from %d shots (%.1f mm height span)" % (
        rms, np.abs(res).max(), keep.sum(), len(allX), span))
    print("  laser plane vs machine: %.2f deg from vertical; normal in machine frame %s" % (
        abs(tilt), np.round(m_mach, 4)))
    print("  triangulation: %.3f mm height per px of stripe shift (at image col %.0f row %.0f)" % (
        abs(dh), pix[0], pix[1]))
    out = {"plane_normal_cam": m.tolist(), "plane_offset_mm": c,
           "plane_rms_mm": rms, "plane_max_mm": float(np.abs(res).max()),
           "n_points": int(keep.sum()), "n_shots": len(allX), "height_span_mm": float(span),
           "tilt_from_vertical_deg": float(abs(tilt)), "normal_machine": m_mach.tolist(),
           "depth_mm_per_px": float(abs(dh)), "stripe_orientation": ori,
           "captured_from": args.capdir, "method": "board"}
    if not args.no_write:
        with open("laser.json", "w") as fh:
            json.dump(out, fh, indent=2)
        print("wrote laser.json")


# -------------------------------------------------------------------- fit
def load_cal():
    with open("camera.json") as fh:
        cam = json.load(fh)
    with open("mount.json") as fh:
        mount = json.load(fh)
    return (np.array(cam["camera_matrix"]), np.array(cam["dist_coeffs"]),
            np.array(mount["R_machine_to_camera"]), cam)


def rays(px, K, D):
    """Pixel (col,row) -> normalised camera rays (x, y, 1)."""
    u = cv2.undistortPoints(px.reshape(-1, 1, 2).astype(np.float64), K, D).reshape(-1, 2)
    return np.c_[u, np.ones(len(u))]


def plane_fit(X):
    c0 = X.mean(0)
    _, _, Vt = np.linalg.svd(X - c0, full_matrices=False)
    m = Vt[2]
    return m, float(m @ c0), (X - c0) @ m


def fit(args):
    K, D, Rmc, cam = load_cal()
    n = Rmc @ np.array([0.0, 0.0, 1.0])          # machine +Z (up) in camera frame
    with open(os.path.join(args.capdir, "manifest.json")) as fh:
        man = json.load(fh)
    z_ref = man["shots"][0]["pose"]["z"]
    R, DZ, ROWS = [], [], []
    for sh in man["shots"]:
        off = cv2.imread(os.path.join(args.capdir, sh["img_off"]))
        on = cv2.imread(os.path.join(args.capdir, sh["img_on"]))
        pts, ori = stripe.extract(off, on, return_orientation=True)
        pts = stripe.clean(pts, max_line_dev=2.0, orientation=ori)
        dz = (sh["pose"]["z"] - z_ref) * IN_TO_MM
        print("  z %+.3f in: %s stripe, %d points, median signal %.0f, "
              "rows %.1f-%.1f, cols %.1f-%.1f" % (
                  dz / IN_TO_MM, ori, len(pts), np.median(pts[:, 2]),
                  pts[:, 0].min(), pts[:, 0].max(), pts[:, 1].min(), pts[:, 1].max()))
        R.append(rays(pts[:, [1, 0]], K, D))
        DZ.append(np.full(len(pts), dz))
        ROWS.append(pts)
    SHOT = np.concatenate([np.full(len(r), i) for i, r in enumerate(R)])
    R, DZ = np.vstack(R), np.concatenate(DZ)
    nr = R @ n
    k_shots = len(man["shots"])

    # At shot i the stripe is the intersection of the laser plane m.X = c
    # with the table n.X = d_i (d_i = d0 - dz_i). A stripe ray r satisfies
    #     m.r - q_i n.r = 0,    q_i = c / d_i
    # i.e. every shot's stripe is an image line m - q_i n. Solve m and all
    # q_i jointly (homogeneous linear least squares) — no search, no scale
    # trick available — then 1/q_i = d0/c - dz_i/c is a straight line in
    # the KNOWN dz_i: its slope gives c, its intercept d0.
    def solve_lines(mask):
        A = np.zeros((mask.sum(), 3 + k_shots))
        A[:, :3] = R[mask]
        A[np.arange(mask.sum()), 3 + SHOT[mask]] = -nr[mask]
        A /= np.linalg.norm(A, axis=1, keepdims=True)
        u = np.linalg.svd(A, full_matrices=False)[2][-1]
        sc = np.linalg.norm(u[:3])
        return u[:3] / sc, u[3:] / sc

    def solve_all(mask):
        m, q = solve_lines(mask)
        shots = np.unique(SHOT[mask])
        dzs = np.array([DZ[SHOT == i][0] for i in shots])
        B, A0 = np.polyfit(dzs, 1.0 / q[shots], 1)    # 1/q = A0 + B*dz
        c = -1.0 / B
        d0 = A0 * c
        if c < 0:                                       # orient m so c > 0
            m, q, c, d0 = -m, -q, -c, d0
        return m, q, c, d0, dzs, 1.0 / q[shots] - (A0 + B * dzs)

    m, q, c, d0, dzs, lin_res = solve_all(np.ones(len(SHOT), bool))
    # leave-one-shot-out spread -> uncertainty of d0 and c
    jk = [solve_all(SHOT != i) for i in range(k_shots)] if k_shots >= 4 else []
    d0_sigma = float(np.std([j[3] for j in jk]) * np.sqrt(max(1, k_shots - 1))) if jk else float("nan")
    c_sigma = float(np.std([j[2] for j in jk]) * np.sqrt(max(1, k_shots - 1))) if jk else float("nan")

    # residuals: image-space distance to each shot's predicted stripe line
    ell = m[None, :] - q[SHOT][:, None] * n[None, :]
    px_err = (ell * R).sum(1) / np.linalg.norm(ell[:, :2], axis=1) * K[0, 0]
    X = R * ((d0 - DZ) / nr)[:, None]                  # stripe points on the table
    res = X @ m - c                                     # mm off the laser plane
    rms = float(np.sqrt((res ** 2).mean()))
    print("  image-line fit: RMS %.3f px  (per-shot linearity of 1/q: %s)" % (
        np.sqrt((px_err ** 2).mean()), np.round(lin_res / np.abs(1 / q).mean(), 5)))
    if not (d0 < 0) or not np.isfinite(d0_sigma) or d0_sigma > 0.2 * abs(d0):
        print("WARNING: table distance poorly determined (laser sheet near the "
              "camera centre, or too little Z range) — check before using")

    m_mach = Rmc.T @ m
    tilt_from_vertical = 90 - np.degrees(np.arccos(abs(m_mach[2])))
    # triangulation geometry at the image centre of the stripe
    p0 = ROWS[0][np.argmin(np.hypot(ROWS[0][:, 0] - K[1, 2], ROWS[0][:, 1] - K[0, 2]))]

    def height_at(row, col):
        r = rays(np.array([[col, row]]), K, D)[0]
        Xp = r * (c / (m @ r))                      # on the laser plane
        return n @ Xp
    step = (0, 1) if ori == "vertical" else (1, 0)  # move across the stripe
    dh_dpx = height_at(p0[0] + step[0], p0[1] + step[1]) - height_at(p0[0], p0[1])
    print("\nlaser plane (camera frame): normal %s  offset %.2f mm" % (np.round(m, 4), c))
    print("  plane fit residual: RMS %.3f mm  max %.3f mm  over %d points" % (
        rms, np.abs(res).max(), len(res)))
    print("  table height below camera (along machine Z) at start pose: %.2f ± %.2f mm" % (-d0, d0_sigma))
    print("  laser plane offset from camera centre: %.2f ± %.2f mm" % (c, c_sigma))
    print("  laser plane vs machine: %.2f deg from vertical; normal in machine frame %s" % (
        abs(tilt_from_vertical), np.round(m_mach, 4)))
    print("  depth sensitivity at stripe centre: %.3f mm height per pixel of stripe shift" % abs(dh_dpx))

    board = None
    if args.board:
        g_img = cv2.cvtColor(cv2.imread(args.board), cv2.COLOR_BGR2GRAY)
        ok, cc = cv2.findChessboardCorners(cv2.resize(g_img, None, fx=.5, fy=.5), PATTERN,
                                           cv2.CALIB_CB_ADAPTIVE_THRESH)
        if ok:
            crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 0.001)
            cc = cv2.cornerSubPix(g_img, (cc / .5).astype(np.float32), (11, 11), (-1, -1), crit)
            L, S = cam.get("square_size_mm_long_short", [cam["square_size_mm"]] * 2)
            objp = np.zeros((54, 3))
            objp[:, :2] = np.mgrid[0:9, 0:6].T.reshape(-1, 2) * [L, S]
            _, rv, tv = cv2.solvePnP(objp, cc, K, D)
            Rb = cv2.Rodrigues(rv)[0]
            nb = Rb[:, 2] * np.sign(Rb[:, 2] @ n)
            d_board = float(n @ tv.ravel())
            ang = np.degrees(np.arccos(np.clip(nb @ n, -1, 1)))
            board = {"board_top_minus_table_mm": d_board - d0, "board_vs_table_normal_deg": ang}
            print("  CHECK vs board image: board surface %.2f mm above fitted table "
                  "(expect board+mount thickness); board normal %.2f deg off table normal" % (
                      d_board - d0, ang))

    out = {"plane_normal_cam": m.tolist(), "plane_offset_mm": c,
           "plane_rms_mm": rms, "plane_offset_sigma_mm": c_sigma, "table_height_sigma_mm": d0_sigma, "plane_max_mm": float(np.abs(res).max()),
           "n_points": int(len(res)), "table_height_mm_at_ref": -d0,
           "ref_pose": man["shots"][0]["pose"], "tilt_from_vertical_deg": float(abs(tilt_from_vertical)),
           "depth_mm_per_px": float(abs(dh_dpx)), "captured_from": args.capdir,
           "board_check": board}
    if not args.no_write:
        with open("laser.json", "w") as fh:
            json.dump(out, fh, indent=2)
        print("wrote laser.json")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("capture")
    c.add_argument("name")
    c.add_argument("--zs", default="0,-0.15,-0.3,-0.45,-0.6")
    c.add_argument("--brightness", type=int, default=90)
    f = sub.add_parser("fit")
    f.add_argument("capdir")
    f.add_argument("--board", default=None)
    f.add_argument("--no-write", action="store_true")
    fb = sub.add_parser("fitboard")
    fb.add_argument("capdir")
    fb.add_argument("--no-write", action="store_true")
    a = ap.parse_args()
    {"capture": capture, "fit": fit, "fitboard": fit_board}[a.cmd](a)
