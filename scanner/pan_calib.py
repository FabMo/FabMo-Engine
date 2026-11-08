"""B-axis (pan) calibration: where the camera sits relative to the pan pivot.

The camera + line laser are one rigid head on the B axis (1 unit = 1 deg).
For a head turned by theta = B - b_ref about the unit axis a (machine frame):

    R_mc(theta) = R_mc0 . Rot(a, theta)^T            machine -> camera
    camera centre = gantry + Rot(a, theta) v          (v: pivot -> camera, mm)

so a point seen at heading theta lands in machine axes as

    P = R_mc(theta)^T X_cam + Rot(a, theta) v + 25.4 * (pose - pose_0) [+ const]

laser.json stays valid at every heading (the laser turns with the camera).

Capture (moves B and X/Y; Z unchanged; asks nothing — run only with the
operator's OK):
  python3 pan_calib.py capture <name> [--step 10] [--max 90]
    Chessboard (12 mm, 9x6 inner corners) flat on the table, fully in view
    at the start pose. B steps 0 -> +max and 0 -> -max; after each step the
    head re-centres the board with an X/Y move (the view swings around the
    pivot as B turns). Ends back at the start X/Y and B.
    -> captures/<name>/ b_NN.jpg + manifest.json

Fit:
  python3 pan_calib.py fit captures/<name>  -> pan.json
    Joint least squares over every corner of every shot (reprojection, px):
    axis a, pivot->camera v (perpendicular to a), board pose, R_mc0.
    Intrinsics are fixed (camera.json).
"""

import argparse
import json
import os
import time

import cv2
import numpy as np

IN_TO_MM = 25.4
PATTERN = (9, 6)
HERE = os.path.dirname(os.path.abspath(__file__))


def load_json(name):
    with open(os.path.join(HERE, name)) as fh:
        return json.load(fh)


def board_points(cam):
    L, S = cam.get("square_size_mm_long_short", [cam["square_size_mm"]] * 2)
    objp = np.zeros((PATTERN[0] * PATTERN[1], 3))
    objp[:, :2] = np.mgrid[0:PATTERN[0], 0:PATTERN[1]].T.reshape(-1, 2) * [L, S]
    return objp


def detect(img):
    """Full 9x6 inner-corner grid (sub-pixel) or None. Full grid only: the
    joint fit needs every corner to keep its identity across shots."""
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    # The sector-based detector copes with the board rotated in the image
    # (B turns it ~1 deg per deg); the classic one at half scale failed from
    # ~35 deg on (2026-11-08). Classic kept as a fallback.
    ok, cc = cv2.findChessboardCornersSB(g, PATTERN,
                                         cv2.CALIB_CB_EXHAUSTIVE | cv2.CALIB_CB_ACCURACY)
    if ok:
        return cc.reshape(-1, 2).astype(np.float64)
    ok, cc = cv2.findChessboardCorners(cv2.resize(g, None, fx=.5, fy=.5), PATTERN,
                                       cv2.CALIB_CB_ADAPTIVE_THRESH)
    if not ok:
        return None
    crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 0.001)
    cc = cv2.cornerSubPix(g, (cc / .5).astype(np.float32), (11, 11), (-1, -1), crit)
    return cc.reshape(-1, 2).astype(np.float64)


def orient_like(c, ref):
    """OpenCV may number a 9x6 grid from either end (a 180 deg flip of the
    board frame). Keep the ordering whose first->last row direction agrees
    with the previous shot's (consecutive shots differ by ~one B step)."""
    if ref is None:
        return c
    d = c[PATTERN[0] - 1] - c[0]
    dr = ref[PATTERN[0] - 1] - ref[0]
    return c[::-1].copy() if d @ dr < 0 else c


def pnp(c, objp, K, D):
    _, rv, tv = cv2.solvePnP(objp, c, K, D)
    return cv2.Rodrigues(rv)[0], tv.ravel()


# ---------------------------------------------------------------- capture
def capture(args):
    import camera
    import fabmo_client as fabmo

    cam = load_json("camera.json")
    K, D = np.array(cam["camera_matrix"]), np.array(cam["dist_coeffs"])
    R_mc0 = np.array(load_json("mount.json")["R_machine_to_camera"])
    objp = board_points(cam)
    outdir = os.path.join(HERE, "captures", args.name)
    os.makedirs(outdir, exist_ok=True)

    if fabmo.status()["state"] != "idle":
        raise SystemExit("machine must be idle")
    origin = fabmo.pose()
    b0 = origin["b"]
    if b0 is None or abs(b0) > 1.0:
        raise SystemExit("start with B near 0 (B = %s)" % b0)
    angles = list(range(args.step, args.max + 1, args.step))
    plan = [0] + angles + ["home"] + [-a for a in angles] + ["home"]
    skip_side = None      # +1 / -1 once the board is lost on that side

    cap = camera.open_camera()
    time.sleep(1.0)
    shots, ref_c, R_bm, X_target = [], None, None, None
    pos = {"x": origin["x"], "y": origin["y"]}
    track = []        # (x, y) of the re-centred shots on the current side, for prediction
    try:
        for k, step in enumerate(plan):
            if step == "home":                       # back to the start view
                skip_side = None
                fabmo.goto(x=origin["x"], y=origin["y"], b=0.0)
                pos = {"x": origin["x"], "y": origin["y"]}
                ref_c = np.array(shots[0]["corners_ref"])
                track = [(origin["x"], origin["y"])]
                continue
            if skip_side is not None and np.sign(step) == skip_side:
                continue
            # Feed-forward: the re-centring X/Y follows a smooth curve in B,
            # so move X/Y by the last step's correction together with B
            # (without it the view swings the board out of frame by ~40 deg).
            if len(track) >= 2:
                nx = round(track[-1][0] + (track[-1][0] - track[-2][0]), 4)
                ny = round(track[-1][1] + (track[-1][1] - track[-2][1]), 4)
                fabmo.check_envelope([(nx, ny)])
                fabmo.goto(x=nx, y=ny, b=float(step))
                pos = {"x": nx, "y": ny}
            else:
                fabmo.goto(b=float(step))
            for attempt in range(4):                 # detect, re-centre, repeat
                time.sleep(0.4)
                img = camera.grab(cap, flush=8)
                c = detect(img)
                if c is None:
                    time.sleep(0.5)                  # one retry (AE settling)
                    img = camera.grab(cap, flush=8)
                    c = detect(img)
                if c is None:
                    break
                c = orient_like(c, ref_c)
                R, t = pnp(c, objp, K, D)
                ctr = objp.mean(0)
                Xc = R @ ctr + t                      # board centre, camera frame
                if R_bm is None:                      # first shot: reference
                    R_bm = R_mc0.T @ R               # board -> machine (B ~ 0)
                    X_target = Xc
                    break
                R_mc = R @ R_bm.T                    # machine -> camera now
                d = (R_mc.T @ Xc - R_mc.T @ X_target)[:2] / IN_TO_MM   # inches
                if np.hypot(*d) < 0.04:
                    break
                nx, ny = round(pos["x"] + d[0], 4), round(pos["y"] + d[1], 4)
                fabmo.check_envelope([(nx, ny)])
                fabmo.goto(x=nx, y=ny)
                pos = {"x": nx, "y": ny}
            if c is None:
                # Board lost (a rotated 12 mm board no longer fits the frame
                # past ~45 deg): end this side, keep what we have.
                cv2.imwrite(os.path.join(outdir, "fail_B%+d.jpg" % step), img)
                print("  B %+4d  board not found — ending this side" % step, flush=True)
                if step == 0:
                    raise RuntimeError("board not found at the start pose")
                skip_side = np.sign(step)
                continue
            p = fabmo.pose()
            f = "b_%02d.jpg" % len(shots)
            cv2.imwrite(os.path.join(outdir, f), img)
            shots.append({"file": f, "pose": p, "b_cmd": step, "corners_ref": c.tolist()})
            ref_c = c
            track.append((p["x"], p["y"]))
            print("  B %+4d  X%.3f Y%.3f  (%d re-centring moves)"
                  % (step, p["x"], p["y"], attempt), flush=True)
    finally:
        try:
            fabmo.goto(x=origin["x"], y=origin["y"], b=0.0 if abs(b0) < 1 else b0)
        finally:
            with open(os.path.join(outdir, "manifest.json"), "w") as fh:
                json.dump({"origin": origin, "shots": shots,
                           "created": time.strftime("%Y-%m-%d %H:%M:%S")}, fh, indent=1)
    print("wrote %s (%d shots); head back at X%.3f Y%.3f B0"
          % (outdir, len(shots), origin["x"], origin["y"]))


# -------------------------------------------------------------------- fit
def rot(axis, ang):
    return cv2.Rodrigues((np.asarray(axis, float) * ang).reshape(3, 1))[0]


def perp_basis(a):
    t = np.array([1.0, 0, 0]) if abs(a[0]) < 0.9 else np.array([0, 1.0, 0])
    e1 = np.cross(a, t)
    e1 /= np.linalg.norm(e1)
    return e1, np.cross(a, e1)


AXIS0 = [np.array([0, 0, 1.0])]      # nominal axis direction (set per sign in fit)
# Camera orientation at B ~ 0, held FIXED in the fit (from mount.json, which
# was calibrated against real machine moves). Free, it trades off against
# the board pose and axis tilt — the re-centring moves track the rotation
# so closely that the machine frame's orientation is barely observable
# (2026-11-08: a free fit wandered 15 deg off with a 5.5 deg axis tilt).
R_MC0_FIXED = [None]


def unpack(x):
    # axis = nominal (+Z or -Z) tilted by a small rotation (x[0], x[1], 0):
    # well-conditioned near vertical, unlike spherical angles at the pole
    a = rot([1.0, 0, 0], 0) @ cv2.Rodrigues(np.array([x[0], x[1], 0.0]).reshape(3, 1))[0] @ AXIS0[0]
    e1, e2 = perp_basis(a)
    v = x[2] * e1 + x[3] * e2
    R_bm = cv2.Rodrigues(x[4:7].reshape(3, 1))[0]
    T = x[7:10]
    R_mc0 = (R_MC0_FIXED[0] if R_MC0_FIXED[0] is not None
             else cv2.Rodrigues(x[10:13].reshape(3, 1))[0])
    return a, v, R_bm, T, R_mc0


def fit(args):
    cam = load_json("camera.json")
    K, D = np.array(cam["camera_matrix"]), np.array(cam["dist_coeffs"])
    objp = board_points(cam)
    with open(os.path.join(args.capdir, "manifest.json")) as fh:
        man = json.load(fh)
    obs, theta, gm = [], [], []
    ref = None
    sh = sorted(man["shots"], key=lambda s: s["pose"]["b"])     # monotonic B for orient_like
    for s in sh:
        c = detect(cv2.imread(os.path.join(args.capdir, s["file"])))
        if c is None:
            print("skip %s (no board)" % s["file"])
            continue
        c = orient_like(c, np.array(s["corners_ref"]))   # same numbering as at capture
        obs.append(c)
        theta.append(s["pose"]["b"])
        gm.append([s["pose"][k] for k in "xyz"])
    b_ref = man["origin"]["b"]
    theta = np.radians(np.array(theta) - b_ref)
    gm = (np.array(gm) - np.array([man["origin"][k] for k in "xyz"])) * IN_TO_MM
    obs = np.array(obs)
    n = len(obs)
    print("%d shots, B %.1f .. %.1f deg" % (n, np.degrees(theta.min()), np.degrees(theta.max())))

    # The head's real angle is NOT the reported B (2026-11-08: ~3.4 deg
    # backlash and a few % scale error), so every shot's angle is a free
    # parameter, measured from the board; the B ~ 0 shot is the reference.
    i0 = int(np.argmin(np.abs(theta)))
    free = np.array([i for i in range(n) if i != i0], int)

    def thetas(x):
        t = theta.copy()
        t[free] += x[13:]
        return t

    def residuals(x):
        a, v, R_bm, T, R_mc0 = unpack(x)
        th = thetas(x)
        Xm = objp @ R_bm.T + T                           # board corners, machine frame
        out = []
        for i in range(n):
            Ra = rot(a, th[i])
            R = R_mc0 @ Ra.T
            cpos = gm[i] + Ra @ v
            Xc = (Xm - cpos) @ R.T
            p, _ = cv2.projectPoints(Xc, np.zeros(3), np.zeros(3), K, D)
            out.append((p.reshape(-1, 2) - obs[i]).ravel())
        return np.concatenate(out)

    # initial guess from the B ~ 0 shot (PnP): R_mc0 from mount.json
    # Initial guess straight from per-shot PnP (starting from the reported B
    # angles lands in a wrong minimum — they're off by the backlash and in
    # the opposite rotation sense):
    #   rotation of each shot vs the reference -> pivot axis + actual angles
    #   camera centre minus gantry position traces a circle -> pivot -> camera v
    R_mc0 = np.array(load_json("mount.json")["R_machine_to_camera"])
    poses = [pnp(o, objp, K, D) for o in obs]
    R0, t0 = poses[i0]
    R_bm0 = R_mc0.T @ R0                                  # board -> machine
    rv = []
    for R, _ in poses:
        Rm = (R @ R_bm0.T).T @ R_mc0                      # machine-frame turn from shot i0
        rv.append(cv2.Rodrigues(Rm)[0].ravel())
    rv = np.array(rv)
    big = np.linalg.norm(rv, axis=1) > np.radians(5)
    dirs = rv[big] / np.linalg.norm(rv[big], axis=1, keepdims=True)
    dirs *= np.sign(dirs[:, 2:3])                        # align to +Z
    a0 = dirs.mean(0)
    a0 /= np.linalg.norm(a0)
    th0 = rv @ a0                                         # signed actual angles about a0
    Q = np.array([R_bm0 @ (-R.T @ t) for R, t in poses]) - gm   # camera - gantry
    A_ = np.c_[2 * Q[:, 0], 2 * Q[:, 1], np.ones(n)]
    sol = np.linalg.lstsq(A_, (Q[:, :2] ** 2).sum(1), rcond=None)[0]
    centre = np.array([sol[0], sol[1], Q[:, 2].mean()])
    rad = np.sqrt(sol[2] + sol[0] ** 2 + sol[1] ** 2)
    print("  direct: axis %s (%.2f deg from vertical), camera circle radius %.2f mm"
          % (np.round(a0, 4).tolist(), np.degrees(np.arccos(a0[2])), rad))
    AXIS0[0] = np.array([0, 0, 1.0])
    x = np.zeros(13 + len(free))
    w = np.cross([0, 0, 1.0], a0)
    if np.linalg.norm(w) > 1e-12:
        w = w / np.linalg.norm(w) * np.arccos(np.clip(a0[2], -1, 1))
    x[0:2] = w[:2]
    e1, e2 = perp_basis(unpack(x)[0])
    v0 = Q[i0] - centre
    x[2], x[3] = v0 @ e1, v0 @ e2
    x[4:7] = cv2.Rodrigues(R_bm0)[0].ravel()
    x[7:10] = -centre                                     # board origin, pivot frame
    x[10:13] = cv2.Rodrigues(R_mc0)[0].ravel()
    x[13:] = th0[free] - theta[free]
    R_MC0_FIXED[0] = None if args.free_mount else R_mc0
    keep = np.ones(len(x), bool)
    if not args.free_mount:
        keep[10:13] = False                               # fixed R_mc0: not a parameter
    x_full = x.copy()

    def res_sub(xs):
        xx = x_full.copy()
        xx[keep] = xs
        return residuals(xx)
    print("  start: rms %.3f px" % np.sqrt((residuals(x) ** 2).sum() / (n * objp.shape[0])))
    xs, cost = lm(res_sub, x[keep])
    x = x_full.copy()
    x[keep] = xs
    sign = 1.0
    r = residuals(x).reshape(-1, 2)
    rms = float(np.sqrt((r ** 2).sum(1).mean()))
    per_shot = np.sqrt((r.reshape(n, -1, 2) ** 2).sum(2).mean(1))
    a, v, R_bm, T, R_mc0f = unpack(x)
    th_fit = thetas(x)
    b_rep = np.degrees(theta)                            # reported B - b_ref
    order = np.argsort(b_rep)
    print("   B reported   actual turn   difference")
    for i in order:
        print("   %+8.2f     %+8.2f     %+6.2f" % (b_rep[i], np.degrees(th_fit[i]),
                                                 np.degrees(th_fit[i]) - b_rep[i]))
    # a is stored exactly as fitted: flipping it would reverse the rotation
    # sense of Rot(a, theta). Only the description depends on its sign.
    sign_note = ("positive B turns the head COUNTER-CLOCKWISE seen from above" if a[2] > 0
                 else "positive B turns the head CLOCKWISE seen from above")
    R_mount = np.array(load_json("mount.json")["R_machine_to_camera"])
    d_mount = np.degrees(np.linalg.norm(cv2.Rodrigues(R_mc0f @ R_mount.T)[0]))
    tilt = np.degrees(np.arccos(min(1.0, abs(a[2]))))
    print("reprojection rms %.3f px (worst shot %.3f px at B %+.0f)"
          % (rms, per_shot.max(), np.degrees(theta[per_shot.argmax()])))
    print("pivot axis (machine) %s, %.3f deg from vertical; %s"
          % (np.round(a, 5).tolist(), tilt, sign_note))
    print("pivot -> camera centre v = %s mm (|v| = %.1f mm)"
          % (np.round(v, 2).tolist(), np.linalg.norm(v)))
    print("R_mc at B=%.3f vs mount.json: %.3f deg apart" % (b_ref, d_mount))
    out = {"axis_machine": a.tolist(), "pivot_to_camera_mm": v.tolist(), "b_ref_deg": b_ref,
           "R_machine_to_camera_at_ref": R_mc0f.tolist(),
           "model": "theta = radians(B - b_ref); R_mc = R_mc_ref . Rot(axis_machine, theta)^T; "
                    "camera centre = gantry + Rot(axis_machine, theta) . pivot_to_camera_mm",
           "rotation_sense": sign_note,
           "rms_px": rms, "per_shot_rms_px": per_shot.round(3).tolist(),
           "angle_map": {"b_reported_minus_ref_deg": b_rep.round(3).tolist(),
                         "actual_turn_deg": np.degrees(th_fit).round(3).tolist(),
                         "note": "actual head turn from the board; differs from B by "
                                 "backlash (approach direction) and gear scale"},
           "tilt_from_vertical_deg": tilt, "mount_json_diff_deg": d_mount,
           "n_shots": n, "captured_from": os.path.relpath(args.capdir, HERE)}
    if not args.no_write:
        with open(os.path.join(HERE, "pan.json"), "w") as fh:
            json.dump(out, fh, indent=2)
        print("wrote pan.json")


def lm(fun, x, iters=200):
    """Levenberg-Marquardt with a numeric Jacobian (no SciPy on the Pi)."""
    r = fun(x)
    cost = r @ r
    lam = 1e-3
    for _ in range(iters):
        J = np.empty((len(r), len(x)))
        for j in range(len(x)):
            h = 1e-6 * max(1.0, abs(x[j]))
            xp = x.copy()
            xp[j] += h
            J[:, j] = (fun(xp) - r) / h
        A, g = J.T @ J, J.T @ r
        improved = False
        for _ in range(10):
            dx = -np.linalg.solve(A + lam * np.diag(np.diag(A) + 1e-9), g)
            rn = fun(x + dx)
            cn = rn @ rn
            if cn < cost:
                x, r, cost, lam = x + dx, rn, cn, lam * 0.3
                improved = True
                break
            lam *= 10
        if not improved or np.abs(dx).max() < 1e-9:
            break
    return x, cost


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("capture")
    c.add_argument("name")
    c.add_argument("--step", type=int, default=10)
    c.add_argument("--max", type=int, default=90)
    c.set_defaults(fn=capture)
    f = sub.add_parser("fit")
    f.add_argument("capdir")
    f.add_argument("--no-write", action="store_true")
    f.add_argument("--free-mount", action="store_true",
                   help="also fit the B~0 camera orientation (poorly conditioned)")
    f.set_defaults(fn=fit)
    a = ap.parse_args()
    if a.cmd == "capture" and (a.max > 95 or a.step < 1):
        raise SystemExit("--max must be <= 95 and --step >= 1")
    a.fn(a)
