"""Intrinsic calibration from calib/*.jpg chessboard images.

Usage: python3 calibrate_intrinsics.py [square_size_mm]
Writes camera.json (camera matrix, distortion, image size, RMS error).
A good webcam calibration lands under ~0.5 px RMS; over 1 px means bad
frames (motion blur, autofocus unlocked) — recapture.
"""

import glob
import json
import sys

import cv2
import numpy as np

PATTERN = (9, 6)
SQUARE_MM = float(sys.argv[1]) if len(sys.argv) > 1 else 20.0

objp = np.zeros((PATTERN[0] * PATTERN[1], 3), np.float32)
objp[:, :2] = np.mgrid[0:PATTERN[0], 0:PATTERN[1]].T.reshape(-1, 2) * SQUARE_MM

obj_points, img_points = [], []
size = None
files = sorted(glob.glob("calib/*.jpg"))
if not files:
    sys.exit("no images in calib/ — run capture_calib.py first")

criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 0.001)
for f in files:
    img = cv2.imread(f)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    size = gray.shape[::-1]
    found, corners = cv2.findChessboardCorners(gray, PATTERN, cv2.CALIB_CB_ADAPTIVE_THRESH)
    if not found:
        print("skip (no board): %s" % f)
        continue
    corners = cv2.cornerSubPix(gray, corners, (11, 11), (-1, -1), criteria)
    obj_points.append(objp)
    img_points.append(corners)
    print("ok: %s" % f)

if len(obj_points) < 8:
    sys.exit("only %d usable frames — need at least 8, ideally 15+" % len(obj_points))

# two-pass: calibrate, reject outlier views (bowed board, residual blur),
# recalibrate on the clean set
rms, K, dist, _, _, _, _, pve = cv2.calibrateCameraExtended(
    obj_points, img_points, size, None, None)
pve = pve.ravel()
thresh = max(0.6, 2.0 * float(np.median(pve)))
keep = [i for i in range(len(pve)) if pve[i] <= thresh]
if len(keep) >= 8 and len(keep) < len(pve):
    print("rejecting %d outlier view(s) (err > %.2f px)" % (len(pve) - len(keep), thresh))
    obj_points = [obj_points[i] for i in keep]
    img_points = [img_points[i] for i in keep]
rms, K, dist, _, _ = cv2.calibrateCamera(obj_points, img_points, size, None, None)
out = {
    "image_size": list(size),
    "camera_matrix": K.tolist(),
    "dist_coeffs": dist.ravel().tolist(),
    "rms_reproj_error_px": rms,
    "square_size_mm": SQUARE_MM,
    "n_frames": len(obj_points),
}
with open("camera.json", "w") as fh:
    json.dump(out, fh, indent=2)

fx, fy = K[0, 0], K[1, 1]
print("\nRMS reprojection error: %.3f px  (%s)" % (
    rms, "good" if rms < 0.5 else "acceptable" if rms < 1.0 else "POOR — recapture"))
print("focal: fx=%.1f fy=%.1f px   principal point: (%.1f, %.1f)" % (
    fx, fy, K[0, 2], K[1, 2]))
print("wrote camera.json")
