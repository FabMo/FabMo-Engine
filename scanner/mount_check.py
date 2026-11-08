"""Quick check of the camera's orientation vs the machine axes (mount.json).

The board lies still; the head (at B 0, reached moving +B like the pan
calibration) moves by known amounts. For a fixed camera orientation R_mc
(machine -> camera) the board's origin in the camera frame moves by
    t_i - t_0 = -R_mc . dm_i
so the measured shifts for several non-parallel moves give R_mc directly
(Kabsch; scale-free, so the board's square size doesn't matter for it).

    python3 mount_check.py [--square 7.80x7.80] [--write]

Moves: +-0.4 in X, +-0.4 in Y, -0.3 in Z from the current position, then
back. --write replaces mount.json's R_machine_to_camera (old copy kept as
calib/mount.<time>.json). Camera must not be held by scand.
"""

import argparse
import json
import os
import shutil
import time

import cv2
import numpy as np

import pan_calib as pc

HERE = os.path.dirname(os.path.abspath(__file__))
IN_TO_MM = 25.4
MOVES = [(0, 0, 0), (0.4, 0, 0), (-0.4, 0, 0), (0, 0.4, 0), (0, -0.4, 0), (0, 0, -0.3)]


def kabsch(A, B):
    """R minimising |R A_i - B_i| (rows are vectors)."""
    U, _, Vt = np.linalg.svd(B.T @ A)
    d = np.sign(np.linalg.det(U @ Vt))
    return U @ np.diag([1, 1, d]) @ Vt


def main():
    import camera
    import fabmo_client as fabmo
    import pan

    ap = argparse.ArgumentParser()
    ap.add_argument("--square", default="7.80x7.80")
    ap.add_argument("--write", action="store_true")
    a = ap.parse_args()
    cam = pc.load_json("camera.json")
    K, D = np.array(cam["camera_matrix"]), np.array(cam["dist_coeffs"])
    objp = pc.board_points(cam, pc.parse_square(a.square))
    mount = pc.load_json("mount.json")
    R_old = np.array(mount["R_machine_to_camera"])

    if fabmo.status()["state"] != "idle":
        raise SystemExit("machine must be idle")
    o = fabmo.pose()
    if abs(o["b"] or 0) > 1:
        raise SystemExit("start at B ~ 0 (B = %s)" % o["b"])
    fabmo.check_envelope([(o["x"] + dx, o["y"] + dy) for dx, dy, _ in MOVES])
    for bb in pan.approach_moves(o["b"] or 0.0, 0.0, fabmo.B_LIMIT):   # +B approach
        fabmo.goto(b=bb)
    cap = camera.open_camera()
    time.sleep(1.0)
    ts, dms, ref = [], [], None
    try:
        for dx, dy, dz in MOVES:
            fabmo.goto(x=o["x"] + dx, y=o["y"] + dy, z=o["z"] + dz)
            time.sleep(0.5)
            c = pc.detect(camera.grab(cap, flush=10))
            if c is None:
                raise RuntimeError("board not found at move %s" % ((dx, dy, dz),))
            c = pc.orient_like(c, ref)
            ref = c if ref is None else ref
            R, t = pc.pnp(c, objp, K, D)
            p = fabmo.pose()
            ts.append(t)
            dms.append([(p[k] - o[k]) * IN_TO_MM for k in "xyz"])
            print("  move X%+.1f Y%+.1f Z%+.1f: board at %s mm (camera frame)"
                  % (dx, dy, dz, np.round(t, 2)), flush=True)
    finally:
        fabmo.goto(x=o["x"], y=o["y"], z=o["z"])
    ts, dms = np.array(ts), np.array(dms)
    A = dms[1:] - dms[0]                         # machine moves
    B = -(ts[1:] - ts[0])                        # = R_mc . move
    R_new = kabsch(A, B)
    res = B - A @ R_new.T
    scale = np.linalg.norm(B, axis=1) / np.linalg.norm(A, axis=1)
    dR = R_new @ R_old.T
    rv = cv2.Rodrigues(dR)[0].ravel()
    ang = np.degrees(np.linalg.norm(rv))
    # express the change in the machine frame: yaw (about Z) vs tilt
    rv_m = R_old.T @ rv
    print("fit residual %.3f mm rms (moves of %.0f mm); board/machine scale %.4f"
          % (np.sqrt((res ** 2).sum(1).mean()), np.abs(A).max(), scale.mean()))
    print("camera orientation vs mount.json: %.3f deg — about machine Z %+.3f, X %+.3f, Y %+.3f deg"
          % (ang, np.degrees(rv_m[2]), np.degrees(rv_m[0]), np.degrees(rv_m[1])))
    axis_new = R_new.T @ np.array([0, 0, 1.0])
    print("camera axis %.2f deg from vertical (mount.json %.2f)"
          % (np.degrees(np.arccos(-axis_new[2])),
             np.degrees(np.arccos(-(R_old.T @ np.array([0, 0, 1.0]))[2]))))
    if a.write:
        os.makedirs(os.path.join(HERE, "calib"), exist_ok=True)
        bak = os.path.join(HERE, "calib", "mount.%s.json" % time.strftime("%Y%m%d_%H%M%S"))
        shutil.copy(os.path.join(HERE, "mount.json"), bak)
        mount.update(R_machine_to_camera=R_new.tolist(), refined_with="mount_check.py",
                     mount_check={"time": time.strftime("%Y-%m-%d %H:%M:%S"),
                                  "change_deg": ang, "residual_mm": float(np.sqrt((res ** 2).sum(1).mean()))})
        with open(os.path.join(HERE, "mount.json"), "w") as fh:
            json.dump(mount, fh, indent=2)
        print("wrote mount.json (previous copy %s)" % os.path.relpath(bak, HERE))


if __name__ == "__main__":
    main()
