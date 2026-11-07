"""Joint refinement: lens intrinsics + hand-eye rotation, using machine motion.

Handheld chessboard views (calib/*.jpg) alone leave focal length poorly
determined when the board can only lie ~flat under a canted camera (every
view at the same tilt — focal length trades off against distance). A
machine-moved grid over a FIXED flat board (captures/<name>, made by
capture_grid.py, ideally with --zs Z steps) pins it down: the camera is
known to translate by exactly the machine displacement between shots.

Model (all mm):
  handheld view j:  X_cam = R_j P + t_j                      (free pose each)
  machine shot i:   X_cam = R_bc P + t0 - R_mc (m_i - m_ref)
     R_bc, t0 : board pose at the reference shot
     R_mc     : machine->camera rotation (the hand-eye mount rotation)
     m_i      : machine position of shot i (manifest, inches -> mm)
  shared intrinsics: fx fy cx cy k1 k2 p1 p2 k3

Solved by Levenberg-Marquardt (numpy, numeric Jacobian — no scipy needed).
Writes camera.json and mount.json (same keys the other tools read; the
previous files are copied to calib/*.prev.json first).

Usage: python3 refine_calib.py <square_mm> captures/<name> [--no-write]
  <square_mm> may be "LxS" for a print scaled differently along the long
  (10-square, label-parallel) and short (7-square) sides, e.g. 11.743x11.714.
  Measure across the whole board, not one square.
  --scale-from-machine: also solve for one board scale factor (keeping the
  given long/short ratio), using the machine's moves as the length
  reference. Use once the machine's X/Y/Z steps-per-unit are verified —
  more trustworthy than calipers on a paper print.
"""

import glob
import json
import os
import shutil
import sys

import cv2
import numpy as np

PATTERN = (9, 6)
IN_TO_MM = 25.4
DETECT_SCALE = 0.5

if len(sys.argv) < 3:
    sys.exit(__doc__)
_sq = [float(v) for v in sys.argv[1].lower().split("x")]
SQ_L, SQ_S = (_sq[0], _sq[-1])
SQUARE = (SQ_L + SQ_S) / 2
CAPDIR = sys.argv[2]
WRITE = "--no-write" not in sys.argv
FREE_SCALE = "--scale-from-machine" in sys.argv

objp = np.zeros((PATTERN[0] * PATTERN[1], 3), np.float64)
objp[:, :2] = np.mgrid[0:PATTERN[0], 0:PATTERN[1]].T.reshape(-1, 2) * [SQ_L, SQ_S]
crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 0.001)


def corners_of(path):
    g = cv2.cvtColor(cv2.imread(path), cv2.COLOR_BGR2GRAY)
    ok, c = cv2.findChessboardCorners(
        cv2.resize(g, None, fx=DETECT_SCALE, fy=DETECT_SCALE), PATTERN,
        cv2.CALIB_CB_ADAPTIVE_THRESH)
    if not ok:
        return None
    c = (c / DETECT_SCALE).astype(np.float32)
    return cv2.cornerSubPix(g, c, (11, 11), (-1, -1), crit).reshape(-1, 2).astype(np.float64)


# ---- data -------------------------------------------------------------
hand = []
for f in sorted(glob.glob("calib/calib_*.jpg")):
    c = corners_of(f)
    if c is not None:
        hand.append(c)
with open(os.path.join(CAPDIR, "manifest.json")) as fh:
    manifest = json.load(fh)
mach, mpos = [], []
for shot in manifest["shots"]:
    c = corners_of(os.path.join(CAPDIR, shot["file"]))
    if c is None:
        print("skip (no board): %s" % shot["file"])
        continue
    p = shot["pose"]
    mach.append(c)
    mpos.append([p["x"] * IN_TO_MM, p["y"] * IN_TO_MM, p["z"] * IN_TO_MM])
mpos = np.array(mpos)
mref = mpos[0].copy()
dm = mpos - mref
print("handheld views: %d   machine shots: %d" % (len(hand), len(mach)))

with open("camera.json") as fh:
    cam0 = json.load(fh)
K0 = np.array(cam0["camera_matrix"])
D0 = np.array(cam0["dist_coeffs"]).ravel()[:5]
size = tuple(cam0["image_size"])

# ---- parameter vector -------------------------------------------------
# [fx fy cx cy k1 k2 p1 p2 k3] [rvec_bc t0] [rvec_mc] [rvec_j tvec_j ...]
def pnp(c, K, D):
    _, r, t = cv2.solvePnP(objp, c, K, D)
    return r.ravel(), t.ravel()

intr0 = np.r_[K0[0, 0], K0[1, 1], K0[0, 2], K0[1, 2], D0]
rbc0, t00 = pnp(mach[0], K0, D0)
if os.path.exists("mount.json"):
    with open("mount.json") as fh:
        rmc0 = cv2.Rodrigues(np.array(json.load(fh)["R_machine_to_camera"]))[0].ravel()
else:
    sys.exit("mount.json missing — run hand_eye.py first for an initial mount rotation")
hand0 = np.concatenate([np.r_[pnp(c, K0, D0)] for c in hand]) if hand else np.zeros(0)
x0 = np.r_[intr0, rbc0, t00, rmc0, 1.0, hand0]   # 1.0 = board scale factor
NI = 9


def unpack(x):
    fx, fy, cx, cy = x[0:4]
    K = np.array([[fx, 0, cx], [0, fy, cy], [0, 0, 1.0]])
    D = x[4:9]
    rbc, t0, rmc = x[9:12], x[12:15], x[15:18]
    return K, D, rbc, t0, rmc, x[19:]


def residuals(x, split=False):
    K, D, rbc, t0, rmc, hp = unpack(x)
    P = objp * x[18]
    Rbc = cv2.Rodrigues(rbc)[0]
    Rmc = cv2.Rodrigues(rmc)[0]
    out_h, out_m = [], []
    for j, c in enumerate(hand):
        r, t = hp[6 * j:6 * j + 3], hp[6 * j + 3:6 * j + 6]
        p, _ = cv2.projectPoints(P, r, t, K, D)
        out_h.append((p.reshape(-1, 2) - c).ravel())
    for i, c in enumerate(mach):
        Xc = (Rbc @ P.T).T + t0 - Rmc @ dm[i]
        p, _ = cv2.projectPoints(Xc, np.zeros(3), np.zeros(3), K, D)
        out_m.append((p.reshape(-1, 2) - c).ravel())
    if split:
        return (np.concatenate(out_h) if out_h else np.zeros(0)), np.concatenate(out_m)
    return np.concatenate(out_h + out_m)


def jacobian(x, r0):
    J = np.zeros((r0.size, x.size))
    for k in range(x.size):
        if k == 18 and not FREE_SCALE:
            continue                      # board scale held at 1.0
        h = 1e-6 * max(1.0, abs(x[k]))
        xp = x.copy()
        xp[k] += h
        J[:, k] = (residuals(xp) - r0) / h
    return J


x = x0.copy()
r = residuals(x)
lam = 1e-3
print("start RMS %.3f px" % np.sqrt((r ** 2).mean()))
for it in range(40):
    J = jacobian(x, r)
    A = J.T @ J
    g = J.T @ r
    improved = False
    for _ in range(10):
        step = np.linalg.solve(A + lam * np.diag(np.diag(A)) + np.eye(x.size) * 1e-12, -g)
        xn = x + step
        rn = residuals(xn)
        if (rn ** 2).sum() < (r ** 2).sum():
            rel = 1 - (rn ** 2).sum() / (r ** 2).sum()
            x, r, lam, improved = xn, rn, lam * 0.3, True
            break
        lam *= 10
    if not improved or rel < 1e-9:
        break
print("final RMS %.3f px after %d iterations" % (np.sqrt((r ** 2).mean()), it + 1))

# ---- report -----------------------------------------------------------
J = jacobian(x, r)
dof = max(1, r.size - x.size)
sigma2 = (r ** 2).sum() / dof
try:
    keep = [k for k in range(x.size) if k != 18 or FREE_SCALE]
    cov = np.zeros((x.size, x.size))
    cov[np.ix_(keep, keep)] = np.linalg.inv(J[:, keep].T @ J[:, keep]) * sigma2
    sd = np.sqrt(np.diag(cov))
except np.linalg.LinAlgError:
    sd = np.full(x.size, np.nan)
K, D, rbc, t0, rmc, _ = unpack(x)
rh, rm = residuals(x, split=True)
SC = x[18]
SQ_L, SQ_S, SQUARE = SQ_L * SC, SQ_S * SC, SQUARE * SC
objp = objp * SC
if FREE_SCALE:
    print("  board scale from machine: x%.4f ± %.4f -> squares %.3f x %.3f mm" % (
        SC, sd[18], SQ_L, SQ_S))
rms = lambda v: float(np.sqrt((v ** 2).mean())) if v.size else float("nan")
print("  handheld RMS %.3f px   machine-grid RMS %.3f px" % (rms(rh), rms(rm)))
names = ["fx", "fy", "cx", "cy"]
for k, n in enumerate(names):
    print("  %s %8.1f ± %.1f   (was %.1f)" % (n, x[k], sd[k], intr0[k]))
print("  dist %s  (was %s)" % (np.round(D, 4), np.round(D0, 4)))
Rmc = cv2.Rodrigues(rmc)[0]
dRot = np.degrees(np.linalg.norm(cv2.Rodrigues(Rmc @ cv2.Rodrigues(rmc0)[0].T)[0]))
view = Rmc[2]
print("  mount: camera axis in machine frame %s (%.1f deg from straight down); "
      "changed %.2f deg vs hand_eye.py" % (
          np.round(view, 3), np.degrees(np.arccos(-view[2])), dRot))

# Diagnostic only, same metric as hand_eye.py: per-shot PnP with the
# refined intrinsics -> camera centre in board frame vs machine motion.
# CAUTION: with a narrow FOV each single-image pose trades ~0.05 deg of
# rotation against lateral position, which reads as a few % of apparent
# X/Y scale error on small grids (seen 2026-11-07: 0.977 while a tape
# check of a 20 in X move was exact). The machine-grid RMS above — the
# constrained model's fit — is the real consistency test: it should be
# close to the handheld RMS.
Rbc = cv2.Rodrigues(rbc)[0]
cc = []
for c in mach:
    rr, tt = pnp(c, K, D)
    R = cv2.Rodrigues(rr)[0]
    cc.append(-R.T @ tt)
cc = np.array(cc)
pred = (Rbc.T @ Rmc @ dm.T).T            # machine delta expressed in board frame
res = (cc - cc[0]) - pred
res -= res.mean(0)                       # reference-shot noise is common to all
err = np.linalg.norm(res, axis=1)
print("  [per-shot PnP diagnostic] machine vs camera motion: mean %.3f mm  max %.3f mm  per-axis rms %s" % (
    err.mean(), err.max(), np.round(np.sqrt((res ** 2).mean(0)), 3)))

# Per-axis scale: camera-measured motion vs machine motion, in machine
# axes (1.000 = agree). A common X/Y deviation usually means the square
# size is off; a single-axis one, that axis's steps-per-unit.
cm = (Rmc.T @ Rbc @ (cc - cc[0]).T).T
cm -= cm.mean(0)
A = np.linalg.lstsq(dm - dm.mean(0), cm, rcond=None)[0].T
print("  [per-shot PnP diagnostic] camera/machine motion scale: X %.4f  Y %.4f  Z %.4f" % tuple(np.diag(A)))

if WRITE:
    for f in ("camera.json", "mount.json"):
        shutil.copy(f, os.path.join("calib", f.replace(".json", ".prev.json")))
    cam = dict(cam0)
    cam.update({"camera_matrix": K.tolist(), "dist_coeffs": D.tolist(),
                "rms_reproj_error_px": rms(r),
                "refined_with": CAPDIR, "n_frames": len(hand) + len(mach),
                "square_size_mm": SQUARE, "square_size_mm_long_short": [SQ_L, SQ_S]})
    with open("camera.json", "w") as fh:
        json.dump(cam, fh, indent=2)
    with open("mount.json", "w") as fh:
        json.dump({"R_machine_to_camera": Rmc.tolist(),
                   "residual_mean_mm": float(err.mean()),
                   "residual_max_mm": float(err.max()),
                   "n_frames": len(mach), "refined_with": CAPDIR}, fh, indent=2)
    print("wrote camera.json + mount.json (previous copies in calib/*.prev.json)")
