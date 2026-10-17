"""Headless calibration-frame collector.

Hold (or prop) the chessboard in front of the camera and run this. It
grabs a frame every couple of seconds, keeps it only if the full board
is detected, and stops after N good frames. Move the board around
between grabs: vary distance, tilt, and position in the frame,
including the corners — edge coverage is what pins down distortion.
"""

import glob
import sys
import time

import cv2
import numpy as np

import camera

PATTERN = (9, 6)      # inner corners
N_FRAMES = int(sys.argv[1]) if len(sys.argv) > 1 else 20

def mean_disp(a, b):
    return np.linalg.norm((a - b).reshape(-1, 2), axis=1).mean()


cap = camera.open_camera()
time.sleep(1.0)
good = len(glob.glob("calib/calib_*.jpg"))   # append to an earlier run
if good:
    print("resuming — %d frames already collected" % good, flush=True)

# Move-then-HOLD protocol: a frame is accepted only when the board is
# STATIONARY (nearly identical corners in two consecutive polls — no
# motion blur / rolling shutter) AND in a new pose vs the last accepted
# frame. So: move the board, hold it still ~1s, move again.
prev = None        # corners seen on the previous poll
accepted = None    # corners of the last accepted frame
print("collecting %d views: move the board, HOLD STILL ~1s, repeat" % N_FRAMES, flush=True)
while good < N_FRAMES:
    frame = camera.grab(cap)
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    found, corners = cv2.findChessboardCorners(
        gray, PATTERN, cv2.CALIB_CB_ADAPTIVE_THRESH | cv2.CALIB_CB_FAST_CHECK)
    if not found:
        print("  (no board in view)", flush=True)
        prev = None
        time.sleep(0.4)
        continue
    # 3px tolerates handheld tremor; real motion blur moves corners much more
    still = prev is not None and prev.shape == corners.shape \
        and mean_disp(corners, prev) < 3.0
    fresh = accepted is None or accepted.shape != corners.shape \
        or mean_disp(corners, accepted) > 20.0
    prev = corners
    if still and fresh:
        good += 1
        name = "calib/calib_%02d.jpg" % good
        cv2.imwrite(name, frame)
        accepted = corners
        print("  [%2d/%d] captured %s — now MOVE to a new pose" % (
            good, N_FRAMES, name), flush=True)
    elif still:
        print("  (holding same pose — move to a new one)", flush=True)
    time.sleep(0.4)
print("done — run: python3 calibrate_intrinsics.py <square_size_mm>")
