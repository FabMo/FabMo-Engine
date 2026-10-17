"""Stop-and-shoot grid capture: move, settle, grab frame, stamp pose.

Moves are RELATIVE to wherever the machine is when you start — jog the
camera over the target first, then run this. The machine returns to the
start point when done. Writes images + manifest.json into a new
captures/<name>/ directory.

Usage:
  python3 capture_grid.py <name> [--nx 3] [--ny 3] [--step 1.0]

--step is in machine units (inches). Z never moves.
"""

import argparse
import json
import os
import time

import cv2

import camera
import fabmo_client as fabmo

ap = argparse.ArgumentParser()
ap.add_argument("name")
ap.add_argument("--nx", type=int, default=3)
ap.add_argument("--ny", type=int, default=3)
ap.add_argument("--step", type=float, default=1.0, help="grid pitch, inches")
args = ap.parse_args()

outdir = os.path.join("captures", args.name)
os.makedirs(outdir, exist_ok=True)

cap = camera.open_camera()
time.sleep(1.0)

origin = fabmo.pose()
print("origin (work coords): %s" % origin)

shots = []
n = 0
for iy in range(args.ny):
    # serpentine path so the machine doesn't recross the whole grid
    xs = range(args.nx) if iy % 2 == 0 else range(args.nx - 1, -1, -1)
    for ix in xs:
        x = origin["x"] + ix * args.step
        y = origin["y"] + iy * args.step
        fabmo.goto(x=x, y=y)
        time.sleep(0.4)                       # vibration settle
        p = fabmo.pose()                      # stamp the pose we actually reached
        frame = camera.grab(cap)
        fname = "img_%03d.jpg" % n
        cv2.imwrite(os.path.join(outdir, fname), frame)
        shots.append({"file": fname, "pose": p})
        print("  [%d/%d] %s  @ x=%.4f y=%.4f" % (
            n + 1, args.nx * args.ny, fname, p["x"], p["y"]))
        n += 1

fabmo.goto(x=origin["x"], y=origin["y"])
with open(os.path.join(outdir, "manifest.json"), "w") as fh:
    json.dump({"units": "inches", "origin": origin, "shots": shots}, fh, indent=2)
print("wrote %s/manifest.json (%d shots)" % (outdir, n))
