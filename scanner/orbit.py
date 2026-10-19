"""Orbit scan: plan and execute laser-line sweeps around a located part.

The head carries camera + line laser on an indexed pan (B axis). For
each heading the laser plane is vertical and perpendicular to the sweep
direction, so sweeping the head across the part walks the stripe over
every surface facing that heading. Four (or more) headings cover the
part all the way around; wide parts get multiple parallel lanes.

Heading convention: B angle in degrees = the direction the camera FACES
in the XY plane, measured CCW from +X. At heading 0 the sweep runs
along X; at 90, along Y.

This milestone captures frame pairs (laser off/on) with full pose
stamping into a session directory — triangulation/stripe extraction is
the next milestone and runs offline from the manifest.
"""

import json
import math
import os
import time

import cv2

from scan_settings import DATA_DIR, MM_PER_UNIT

SCANS_DIR = os.path.join(DATA_DIR, "scans")


class Aborted(Exception):
    pass


def _heading_vectors(deg):
    """(facing unit vector, lane unit vector) in XY for a heading."""
    r = math.radians(deg)
    f = (math.cos(r), math.sin(r))
    lane = (-f[1], f[0])
    return f, lane


def plan(bbox_in, settings):
    """Build the pass list for a part bounding box [x0,y0,x1,y1] (inches).

    Every pass is a straight stop-and-shoot sweep at one heading, one
    lane offset, one Z. Single Z level for now: multi-band Z descent
    waits until the mounted head geometry (forward reach) is measured,
    so the head never has to fly below part top.
    """
    x0, y0, x1, y1 = bbox_in
    cx, cy = (x0 + x1) / 2.0, (y0 + y1) / 2.0
    step_in = settings["scan_step_mm"] / MM_PER_UNIT
    lane_w_in = settings["lane_width_mm"] / MM_PER_UNIT
    d_laser = settings["laser_offset_in"]
    margin = settings["bbox_margin_mm"] / MM_PER_UNIT
    z_pass = settings["part_zmax_in"] + settings["clearance_in"]

    passes = []
    for hdg in settings["headings_deg"]:
        f, lane = _heading_vectors(hdg)
        # sweep extent: project bbox onto the facing axis
        ext_f = [x0 * f[0] + y0 * f[1], x1 * f[0] + y0 * f[1],
                 x0 * f[0] + y1 * f[1], x1 * f[0] + y1 * f[1]]
        ext_l = [x0 * lane[0] + y0 * lane[1], x1 * lane[0] + y0 * lane[1],
                 x0 * lane[0] + y1 * lane[1], x1 * lane[0] + y1 * lane[1]]
        f_lo, f_hi = min(ext_f) - margin, max(ext_f) + margin
        l_lo, l_hi = min(ext_l), max(ext_l)
        part_w = l_hi - l_lo
        n_lanes = max(1, int(math.ceil(part_w / lane_w_in)))
        center_l = (l_lo + l_hi) / 2.0
        n_steps = max(2, int(math.ceil((f_hi - f_lo) / step_in)) + 1)
        for k in range(n_lanes):
            lane_off = (k - (n_lanes - 1) / 2.0) * lane_w_in
            lane_pos = center_l + lane_off
            points = []
            for i in range(n_steps):
                s = f_lo + i * (f_hi - f_lo) / (n_steps - 1)
                # head trails the laser plane by d_laser along facing
                hx = (s - d_laser) * f[0] + lane_pos * lane[0]
                hy = (s - d_laser) * f[1] + lane_pos * lane[1]
                points.append({"x": round(hx, 4), "y": round(hy, 4),
                               "plane": round(s, 4)})
            passes.append({
                "heading_deg": hdg,
                "lane": k,
                "z_in": round(z_pass, 4),
                "points": points,
            })
    return {
        "bbox_in": list(bbox_in),
        "center_in": [cx, cy],
        "safe_z_in": settings["safe_z_in"],
        "z_pass_in": z_pass,
        "n_passes": len(passes),
        "n_frames": sum(len(p["points"]) for p in passes) * 2,
        "passes": passes,
    }


class OrbitRunner:
    def __init__(self, fabmo, camgrab, settings, progress=None, abort=None,
                 wait_confirm=None):
        self.fabmo = fabmo
        self.camgrab = camgrab
        self.s = settings
        self.progress = progress or (lambda *a: None)
        self.abort = abort
        # pan_prompt mode: block on this callable before each heading
        self.wait_confirm = wait_confirm

    def _check_abort(self):
        if self.abort is not None and self.abort.is_set():
            raise Aborted()

    def _laser(self, on):
        if not self.s["use_laser"]:
            return
        self.fabmo.run_gcode("M100 ({out%d:%d})" % (
            self.s["laser_output"], 1 if on else 0))

    def _pan(self, deg):
        if self.s["use_pan"]:
            self.fabmo.run_gcode("G90 G0 B%.3f" % deg)
        elif self.s["pan_prompt"] and self.wait_confirm:
            self.wait_confirm("Rotate the head to %g deg and confirm" % deg)

    def run(self, scan_plan, session):
        outdir = os.path.join(SCANS_DIR, session)
        os.makedirs(outdir, exist_ok=True)
        shots = []
        total = sum(len(p["points"]) for p in scan_plan["passes"])
        done = 0
        n_img = 0
        try:
            self._laser(False)
            for p in scan_plan["passes"]:
                self._check_abort()
                self.fabmo.goto(z=scan_plan["safe_z_in"])
                self._pan(p["heading_deg"])
                first = p["points"][0]
                self.fabmo.goto(x=first["x"], y=first["y"])
                self.fabmo.goto(z=p["z_in"])
                for pt in p["points"]:
                    self._check_abort()
                    self.fabmo.goto(x=pt["x"], y=pt["y"])
                    time.sleep(self.s["settle_s"])
                    pose = self.fabmo.pose()
                    rec = {"heading_deg": p["heading_deg"], "lane": p["lane"],
                           "plane_in": pt["plane"], "pose": pose}
                    frame = self.camgrab()
                    rec["img_off"] = "img_%05d.jpg" % n_img
                    cv2.imwrite(os.path.join(outdir, rec["img_off"]), frame)
                    n_img += 1
                    if self.s["use_laser"]:
                        self._laser(True)
                        frame = self.camgrab()
                        self._laser(False)
                        rec["img_on"] = "img_%05d.jpg" % n_img
                        cv2.imwrite(os.path.join(outdir, rec["img_on"]), frame)
                        n_img += 1
                    shots.append(rec)
                    done += 1
                    self.progress(done, total)
                self.fabmo.goto(z=scan_plan["safe_z_in"])
        finally:
            try:
                self._laser(False)
                self.fabmo.goto(z=scan_plan["safe_z_in"])
                if self.s["use_pan"]:
                    self.fabmo.run_gcode("G90 G0 B0")
            except Exception:
                pass  # cleanup is best-effort; original error wins
            manifest = {
                "units": "inches",
                "plan": scan_plan,
                "settings": self.s,
                "shots": shots,
                "complete": done == total,
            }
            with open(os.path.join(outdir, "manifest.json"), "w") as fh:
                json.dump(manifest, fh, indent=2)
        return {"session": session, "frames": n_img, "complete": done == total}
