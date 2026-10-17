"""Machine-baseline stereo depth from two shots of a grid capture.

Picks two frames from a capture, uses the machine-reported baseline
(exact, in real units) plus camera.json + mount.json to rectify, runs
SGBM, and writes a depth preview (depth.png) and a metric point cloud
(cloud.ply, mm, in the first camera's frame).

Usage: python3 stereo_depth.py captures/<name> [idxA idxB]
Defaults to the first two shots. Pick a pair ~0.5-2" apart whose views
overlap on the object.
"""

import json
import os
import sys

import cv2
import numpy as np

IN_TO_MM = 25.4

capdir = sys.argv[1]
ia, ib = (int(sys.argv[2]), int(sys.argv[3])) if len(sys.argv) > 3 else (0, 1)

with open(os.path.join(capdir, "manifest.json")) as fh:
    shots = json.load(fh)["shots"]
with open("camera.json") as fh:
    cal = json.load(fh)
with open("mount.json") as fh:
    R_mc = np.array(json.load(fh)["R_machine_to_camera"])

K = np.array(cal["camera_matrix"])
dist = np.array(cal["dist_coeffs"])
size = tuple(cal["image_size"])

sa, sb = shots[ia], shots[ib]
imgA = cv2.imread(os.path.join(capdir, sa["file"]), cv2.IMREAD_GRAYSCALE)
imgB = cv2.imread(os.path.join(capdir, sb["file"]), cv2.IMREAD_GRAYSCALE)

# Machine delta (mm) -> camera-frame baseline. Camera orientation is the
# same at both stations (pure translation), so R_rel = I; moving the
# camera by d moves scene points by -d in camera coordinates.
pa, pb = sa["pose"], sb["pose"]
d_mach = np.array([pb["x"] - pa["x"], pb["y"] - pa["y"], pb["z"] - pa["z"]]) * IN_TO_MM
T = -(R_mc @ d_mach).reshape(3, 1)
baseline = float(np.linalg.norm(T))
print("baseline: %.3f mm (machine delta %s in)" % (baseline, np.round(d_mach / IN_TO_MM, 4)))

R1, R2, P1, P2, Q, _, _ = cv2.stereoRectify(
    K, dist, K, dist, size, np.eye(3), T, alpha=0)
mapA = cv2.initUndistortRectifyMap(K, dist, R1, P1, size, cv2.CV_32FC1)
mapB = cv2.initUndistortRectifyMap(K, dist, R2, P2, size, cv2.CV_32FC1)
rectA = cv2.remap(imgA, *mapA, cv2.INTER_LINEAR)
rectB = cv2.remap(imgB, *mapB, cv2.INTER_LINEAR)
cv2.imwrite("rect_pair.png", np.hstack([rectA, rectB]))

sgbm = cv2.StereoSGBM_create(
    minDisparity=0, numDisparities=16 * 16, blockSize=7,
    P1=8 * 7 * 7, P2=32 * 7 * 7, uniquenessRatio=8,
    speckleWindowSize=120, speckleRange=2, disp12MaxDiff=1,
    mode=cv2.STEREO_SGBM_MODE_SGBM_3WAY)
disp = sgbm.compute(rectA, rectB).astype(np.float32) / 16.0

valid = disp > 0
print("valid disparity: %.1f%% of pixels" % (100.0 * valid.mean()))
pts = cv2.reprojectImageTo3D(disp, Q)
z = pts[:, :, 2]
zv = z[valid & np.isfinite(z) & (z > 0) & (z < 2000)]
if zv.size:
    print("depth range (mm): %.1f .. %.1f  median %.1f" % (
        np.percentile(zv, 2), np.percentile(zv, 98), np.median(zv)))

# depth preview
dn = disp.copy()
dn[~valid] = np.nan
lo, hi = np.nanpercentile(dn, [2, 98])
vis = np.clip((dn - lo) / max(hi - lo, 1e-6), 0, 1)
vis = (np.nan_to_num(vis) * 255).astype(np.uint8)
cv2.imwrite("depth.png", cv2.applyColorMap(vis, cv2.COLORMAP_TURBO))

# metric point cloud (subsampled)
mask = valid & np.isfinite(pts).all(axis=2) & (pts[:, :, 2] > 0) & (pts[:, :, 2] < 2000)
xyz = pts[mask][::4]
shade = cv2.remap(imgA, *mapA, cv2.INTER_LINEAR)[mask][::4]
with open("cloud.ply", "w") as fh:
    fh.write("ply\nformat ascii 1.0\nelement vertex %d\n" % len(xyz))
    fh.write("property float x\nproperty float y\nproperty float z\n")
    fh.write("property uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n")
    for p, g in zip(xyz, shade):
        fh.write("%.2f %.2f %.2f %d %d %d\n" % (p[0], p[1], p[2], g, g, g))
print("wrote rect_pair.png, depth.png, cloud.ply (%d points, mm)" % len(xyz))
