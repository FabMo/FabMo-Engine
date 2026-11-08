"""Pan (B-axis) head model: camera pose at a heading, from pan.json.

pan.json (pan_calib.py; provisional ~1 mm on the first PRS mount):
  axis_machine            unit pivot axis (machine frame)
  pivot_to_camera_mm      v: pivot -> camera centre at the reference heading
  R_machine_to_camera_at_ref   = mount.json's R_mc (reference heading)
  turn_table              commanded B -> actual head turn (deg), +B approach

A shot taken with gantry at `pose` (inches) and head at B turns the
camera by theta = turn(B) about `axis`; a camera-frame point X lands in
machine axes (mm, relative to the camera centre of a reference-heading
shot at pose_0) as

    P = Rot(theta) (R_cm0 X + v) - v + 25.4 (pose - pose_0)

which reduces to the single-heading formula R_cm0 X + 25.4 dpose at
theta = 0. The head angle is NOT the reported B (backlash, gear scale), so
headings must be approached the same way as in calibration (+B, 5 deg
run-up from above) — see approach_moves().
"""

import json
import os

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
RUN_UP_DEG = 5.0


def rot(axis, ang):
    return cv2.Rodrigues((np.asarray(axis, float) * ang).reshape(3, 1))[0]


class Pan:
    def __init__(self, path=None):
        path = path or os.path.join(HERE, "pan.json")
        with open(path) as fh:
            p = json.load(fh)
        self.raw = p
        self.axis = np.array(p["axis_machine"], float)
        self.v = np.array(p["pivot_to_camera_mm"], float)
        self.R_mc0 = np.array(p["R_machine_to_camera_at_ref"], float)
        self.R_cm0 = self.R_mc0.T
        t = p.get("turn_table")
        if t:
            self.tb = np.array(t["b_cmd_deg"], float)
            self.tt = np.array(t["turn_deg"], float)
        else:                                   # older pan.json: theta = B - b_ref
            self.tb = np.array([-95.0, 95.0])
            self.tt = self.tb - p.get("b_ref_deg", 0.0)

    @staticmethod
    def available(path=None):
        return os.path.isfile(path or os.path.join(HERE, "pan.json"))

    def turn(self, b):
        """Actual head turn (radians) for reported/commanded B (deg).
        Linear interpolation in the calibration table (extrapolated at the
        ends with the end slope)."""
        b = float(b)
        tb, tt = self.tb, self.tt
        if b <= tb[0]:
            s = (tt[1] - tt[0]) / (tb[1] - tb[0])
            d = tt[0] + s * (b - tb[0])
        elif b >= tb[-1]:
            s = (tt[-1] - tt[-2]) / (tb[-1] - tb[-2])
            d = tt[-1] + s * (b - tb[-1])
        else:
            d = np.interp(b, tb, tt)
        return np.radians(d)

    def R_cm(self, b):
        """camera -> machine rotation at heading B."""
        return rot(self.axis, self.turn(b)) @ self.R_cm0

    def shot_transform(self, pose, pose0):
        """(R, o): machine P = X_cam @ R.T + o (mm) for a shot at `pose`
        (dict, inches/deg), relative to the reference pose0."""
        th = self.turn(pose.get("b") or 0.0)
        Ra = rot(self.axis, th)
        R = Ra @ self.R_cm0
        dp = np.array([pose[k] - pose0[k] for k in "xyz"]) * 25.4
        o = Ra @ self.v - self.v + dp
        return R, o

    def sweep_dir(self, b, laser_normal_cam):
        """Unit XY direction the head must move to walk the laser line
        across the table at heading B (the line's normal, horizontal part)."""
        n = self.R_cm(b) @ np.asarray(laser_normal_cam, float)
        d = np.array([n[0], n[1]])
        return d / np.linalg.norm(d)

    def line_centre(self, b, laser_normal_cam, laser_offset_mm, table_below_cam_mm):
        """Where the laser line crosses the camera's view on the table, in
        machine XY mm relative to the gantry (+ the same constant for every
        heading). table_below_cam_mm: table height below the camera centre
        at the reference heading."""
        th = self.turn(b)
        Ra = rot(self.axis, th)
        C = Ra @ self.v - self.v                       # camera centre (ref heading = 0)
        R = Ra @ self.R_cm0
        o = R @ np.array([0, 0, 1.0])                  # optical axis
        zt = -table_below_cam_mm
        G = C + o * (zt - C[2]) / o[2]                 # optical axis hits the table
        m = np.asarray(laser_normal_cam, float)
        n = R @ m                                      # laser plane normal (machine)
        P0 = C + R @ (laser_offset_mm * m)             # a point on the laser plane
        # closest point to G on the line {laser plane} ∩ {z = zt}
        nh = np.array([n[0], n[1], 0.0])
        Gp = G - nh * ((G - P0) @ n) / (nh @ n)
        return Gp[:2]


def approach_moves(cur_b, target_b, limit=95.0):
    """B targets to reach target_b with the final move in +B (backlash taken
    up the same way as in calibration)."""
    if target_b < cur_b - 0.05:
        return [max(-limit, target_b - RUN_UP_DEG), target_b]
    return [target_b]
