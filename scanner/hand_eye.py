"""Hand-eye calibration + accuracy check from a grid capture of the chessboard.

Run capture_grid.py with the printed chessboard lying flat on the table
and every grid position seeing the whole board. This script then:

  1. solvePnP's the board in every frame -> camera position in board frame
  2. fits the rotation between machine axes and camera axes (Kabsch)
  3. reports residuals: how far each camera position is from where the
     machine says it moved — the end-to-end accuracy number
  4. writes mount.json (machine->camera rotation) for stereo_depth.py

Usage: python3 hand_eye.py captures/<name>
"""

import json
import os
import sys

import cv2
import numpy as np

PATTERN = (9, 6)
IN_TO_MM = 25.4

capdir = sys.argv[1]
with open(os.path.join(capdir, "manifest.json")) as fh:
    manifest = json.load(fh)
with open("camera.json") as fh:
    cal = json.load(fh)
K = np.array(cal["camera_matrix"])
dist = np.array(cal["dist_coeffs"])
square = cal["square_size_mm"]

objp = np.zeros((PATTERN[0] * PATTERN[1], 3), np.float32)
objp[:, :2] = np.mgrid[0:PATTERN[0], 0:PATTERN[1]].T.reshape(-1, 2) * square

cam_pos = []    # camera center in board frame, mm
mach_pos = []   # machine work position, mm
rots = []       # board->camera rotations
criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 0.001)
for shot in manifest["shots"]:
    img = cv2.imread(os.path.join(capdir, shot["file"]))
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    found, corners = cv2.findChessboardCorners(gray, PATTERN, cv2.CALIB_CB_ADAPTIVE_THRESH)
    if not found:
        print("skip (no board): %s" % shot["file"])
        continue
    corners = cv2.cornerSubPix(gray, corners, (11, 11), (-1, -1), criteria)
    ok, rvec, tvec = cv2.solvePnP(objp, corners, K, dist)
    if not ok:
        continue
    R, _ = cv2.Rodrigues(rvec)
    cam_pos.append((-R.T @ tvec).ravel())        # camera center in board frame
    rots.append(R)
    p = shot["pose"]
    mach_pos.append([p["x"] * IN_TO_MM, p["y"] * IN_TO_MM, p["z"] * IN_TO_MM])
    print("ok: %s" % shot["file"])

cam_pos = np.array(cam_pos)
mach_pos = np.array(mach_pos)
if len(cam_pos) < 4:
    sys.exit("only %d usable frames — need at least 4" % len(cam_pos))

# Kabsch: rotation R_mb mapping machine-frame deltas to board-frame deltas
cm, mm_ = cam_pos - cam_pos.mean(0), mach_pos - mach_pos.mean(0)
U, _, Vt = np.linalg.svd(cm.T @ mm_)
S = np.diag([1, 1, np.sign(np.linalg.det(U @ Vt))])
R_mb = U @ S @ Vt

resid = cm - (R_mb @ mm_.T).T
err = np.linalg.norm(resid, axis=1)
print("\nresiduals (machine motion vs camera motion), mm:")
print("  mean %.3f   max %.3f   per-axis rms %s" % (
    err.mean(), err.max(), np.round(np.sqrt((resid**2).mean(0)), 3)))

# machine->camera rotation per frame is R_i @ R_mb; average over frames
R_mc_stack = np.array([R @ R_mb for R in rots])
U, _, Vt = np.linalg.svd(R_mc_stack.mean(0))
R_mc = U @ Vt
spread = max(np.degrees(np.arccos(np.clip((np.trace(Rm.T @ R_mc) - 1) / 2, -1, 1)))
             for Rm in R_mc_stack)
print("mount orientation spread across frames: %.3f deg %s" % (
    spread, "(rigid mount — good)" if spread < 0.5 else "(LOOSE MOUNT?)"))

with open("mount.json", "w") as fh:
    json.dump({"R_machine_to_camera": R_mc.tolist(),
               "residual_mean_mm": float(err.mean()),
               "residual_max_mm": float(err.max()),
               "n_frames": len(cam_pos)}, fh, indent=2)
print("wrote mount.json")
