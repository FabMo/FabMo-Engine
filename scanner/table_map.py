"""Table orthophoto + part location.

Builds a top-down metric mosaic of the table by stop-and-shoot survey:
every frame is warped onto the table plane (z=0) using the camera
intrinsics and the machine-stamped pose. Part location is then a simple
image diff against a stored empty-table reference mosaic.

Camera pose model: mount.json (hand-eye) when present, else a nominal
nadir camera at a configured offset. The warp math is pose-general, so
the same code works once the head is mounted with the 30-degree cant —
only the calibration files change.
"""

import json
import os

import cv2
import numpy as np

from scan_settings import DATA_DIR, MM_PER_UNIT

HERE = os.path.dirname(os.path.abspath(__file__))

# Nominal nadir mount: camera x = machine +X, camera y = machine -Y,
# camera z = machine -Z (looking straight down).
R_NADIR = np.array([[1.0, 0, 0], [0, -1.0, 0], [0, 0, -1.0]])


class CameraModel:
    def __init__(self, settings):
        with open(os.path.join(HERE, "camera.json")) as fh:
            cal = json.load(fh)
        self.K = np.array(cal["camera_matrix"], dtype=np.float64)
        self.dist = np.array(cal["dist_coeffs"], dtype=np.float64)
        self.size = tuple(cal.get("image_size", (640, 480)))
        self.nominal_mount = True
        self.R = R_NADIR
        mount_path = os.path.join(HERE, "mount.json")
        if os.path.exists(mount_path):
            with open(mount_path) as fh:
                self.R = np.array(json.load(fh)["R_machine_to_camera"])
            self.nominal_mount = False
        off = settings["cam_offset_in"]
        self.off_mm = np.array([off[0], off[1]], dtype=np.float64) * MM_PER_UNIT
        self.cam_z_at_zero_mm = settings["cam_z_at_zero_in"] * MM_PER_UNIT

    def center_mm(self, pose):
        """Camera optical center in machine frame (mm) for a work pose."""
        return np.array([
            pose["x"] * MM_PER_UNIT + self.off_mm[0],
            pose["y"] * MM_PER_UNIT + self.off_mm[1],
            pose["z"] * MM_PER_UNIT + self.cam_z_at_zero_mm,
        ])

    def undistort(self, frame):
        return cv2.undistort(frame, self.K, self.dist)

    def footprint_mm(self, pose):
        """Table-plane quad (4x2 mm) seen by the image corners, or None."""
        w, h = self.size
        C = self.center_mm(pose)
        Kinv = np.linalg.inv(self.K)
        pts = []
        for u, v in ((0, 0), (w, 0), (w, h), (0, h)):
            d = self.R.T @ (Kinv @ np.array([u, v, 1.0]))
            if d[2] >= -1e-6:  # ray doesn't descend to the table
                return None
            s = -C[2] / d[2]
            p = C + s * d
            pts.append(p[:2])
        return np.array(pts)

    def warp_to_table(self, frame, pose, mmpp):
        """Warp one undistorted frame onto the z=0 plane.

        Returns (patch, mask, origin_mm) with patch gridded at mmpp,
        origin_mm the machine-frame position of patch pixel (0,0).
        """
        quad = self.footprint_mm(pose)
        if quad is None:
            return None
        x0, y0 = quad.min(axis=0)
        x1, y1 = quad.max(axis=0)
        nx = int(np.ceil((x1 - x0) / mmpp))
        ny = int(np.ceil((y1 - y0) / mmpp))
        if nx < 2 or ny < 2 or nx * ny > 40e6:
            return None
        xs = x0 + np.arange(nx) * mmpp
        ys = y0 + np.arange(ny) * mmpp
        gx, gy = np.meshgrid(xs, ys)
        C = self.center_mm(pose)
        pts = np.stack([gx - C[0], gy - C[1], np.full_like(gx, -C[2])], axis=-1)
        p_cam = pts @ self.R.T
        z = p_cam[..., 2]
        with np.errstate(divide="ignore", invalid="ignore"):
            u = (self.K[0, 0] * p_cam[..., 0] / z + self.K[0, 2]).astype(np.float32)
            v = (self.K[1, 1] * p_cam[..., 1] / z + self.K[1, 2]).astype(np.float32)
        valid = (z > 1.0) & (u >= 0) & (u < self.size[0]) & (v >= 0) & (v < self.size[1])
        patch = cv2.remap(frame, u, v, cv2.INTER_LINEAR)
        return patch, valid.astype(np.uint8), np.array([x0, y0])


class Mosaic:
    """Table-sized canvas (y up in machine coords => row 0 is y_max)."""

    def __init__(self, region_in, mmpp):
        self.mmpp = mmpp
        self.x0 = region_in[0] * MM_PER_UNIT
        self.y0 = region_in[1] * MM_PER_UNIT
        self.x1 = region_in[2] * MM_PER_UNIT
        self.y1 = region_in[3] * MM_PER_UNIT
        self.w = int(np.ceil((self.x1 - self.x0) / mmpp))
        self.h = int(np.ceil((self.y1 - self.y0) / mmpp))
        self.img = np.zeros((self.h, self.w, 3), np.uint8)
        self.filled = np.zeros((self.h, self.w), np.uint8)

    def paste(self, patch, mask, origin_mm):
        # patch row 0 is at origin_mm.y (low y); flip to canvas orientation
        patch = patch[::-1]
        mask = mask[::-1]
        ph, pw = mask.shape
        cx = int(round((origin_mm[0] - self.x0) / self.mmpp))
        # patch top row = highest y of patch
        patch_ytop = origin_mm[1] + ph * self.mmpp
        cy = int(round((self.y1 - patch_ytop) / self.mmpp))
        x_lo, y_lo = max(cx, 0), max(cy, 0)
        x_hi, y_hi = min(cx + pw, self.w), min(cy + ph, self.h)
        if x_lo >= x_hi or y_lo >= y_hi:
            return
        sub = patch[y_lo - cy:y_hi - cy, x_lo - cx:x_hi - cx]
        m = mask[y_lo - cy:y_hi - cy, x_lo - cx:x_hi - cx].astype(bool)
        self.img[y_lo:y_hi, x_lo:x_hi][m] = sub[m]
        self.filled[y_lo:y_hi, x_lo:x_hi][m] = 1

    def px_to_mm(self, px, py):
        return (self.x0 + px * self.mmpp, self.y1 - py * self.mmpp)

    def meta(self):
        return {"mm_per_px": self.mmpp, "x0_mm": self.x0, "y0_mm": self.y0,
                "x1_mm": self.x1, "y1_mm": self.y1, "w": self.w, "h": self.h}


def plan_survey(cam, settings):
    """Serpentine shot list [(x_in, y_in), ...] covering the survey region."""
    region = settings["survey_region_in"]
    z = settings["survey_z_in"]
    probe_pose = {"x": 0, "y": 0, "z": z}
    quad = cam.footprint_mm(probe_pose)
    if quad is None:
        raise RuntimeError("camera does not see the table at survey Z "
                           "(check mount orientation / cam_z_at_zero_in)")
    span = quad.max(axis=0) - quad.min(axis=0)
    step = span * (1.0 - settings["survey_overlap"]) / MM_PER_UNIT  # inches
    step = np.maximum(step, 0.5)
    x0, y0, x1, y1 = region
    nx = max(1, int(np.ceil((x1 - x0) / step[0])) + 1)
    ny = max(1, int(np.ceil((y1 - y0) / step[1])) + 1)
    xs = np.linspace(x0, x1, nx)
    ys = np.linspace(y0, y1, ny)
    shots = []
    for iy, y in enumerate(ys):
        row = xs if iy % 2 == 0 else xs[::-1]
        shots.extend((float(x), float(y)) for x in row)
    return shots, z


def capture_mosaic(fabmo, camgrab, settings, progress=None, abort=None):
    """Run the survey and return (Mosaic, shots_meta).

    fabmo: fabmo_client module/object with goto()/pose().
    camgrab: callable returning a fresh BGR frame.
    """
    import time
    cam = CameraModel(settings)
    shots, z = plan_survey(cam, settings)
    mosaic = Mosaic(settings["survey_region_in"], settings["mosaic_mm_per_px"])
    meta = []
    fabmo.goto(z=settings["safe_z_in"])
    for i, (x, y) in enumerate(shots):
        if abort is not None and abort.is_set():
            raise Aborted()
        fabmo.goto(x=x, y=y)
        if i == 0:
            fabmo.goto(z=z)
        time.sleep(settings["settle_s"])
        pose = fabmo.pose()
        frame = cam.undistort(camgrab())
        res = cam.warp_to_table(frame, pose, mosaic.mmpp)
        if res is not None:
            mosaic.paste(*res)
        meta.append({"x": pose["x"], "y": pose["y"], "z": pose["z"]})
        if progress:
            progress(i + 1, len(shots))
    fabmo.goto(z=settings["safe_z_in"])
    return mosaic, meta


class Aborted(Exception):
    pass


REF_DIR = os.path.join(DATA_DIR, "reference")
LOC_DIR = os.path.join(DATA_DIR, "locate")


def save_reference(mosaic):
    os.makedirs(REF_DIR, exist_ok=True)
    cv2.imwrite(os.path.join(REF_DIR, "mosaic.png"), mosaic.img)
    with open(os.path.join(REF_DIR, "meta.json"), "w") as fh:
        json.dump(mosaic.meta(), fh, indent=2)


def have_reference():
    return os.path.exists(os.path.join(REF_DIR, "mosaic.png"))


def find_part(mosaic, settings):
    """Diff the fresh mosaic against the reference; return result dict."""
    ref = cv2.imread(os.path.join(REF_DIR, "mosaic.png"))
    if ref is None:
        raise RuntimeError("no reference mosaic — capture one with the table empty")
    if ref.shape != mosaic.img.shape:
        raise RuntimeError("reference mosaic size mismatch — recapture reference "
                           "(survey region or resolution changed)")
    g_ref = cv2.GaussianBlur(cv2.cvtColor(ref, cv2.COLOR_BGR2GRAY), (9, 9), 0)
    g_new = cv2.GaussianBlur(cv2.cvtColor(mosaic.img, cv2.COLOR_BGR2GRAY), (9, 9), 0)
    diff = cv2.absdiff(g_ref, g_new)
    diff[mosaic.filled == 0] = 0
    _, th = cv2.threshold(diff, settings["diff_threshold"], 255, cv2.THRESH_BINARY)
    k5 = np.ones((5, 5), np.uint8)
    k15 = np.ones((15, 15), np.uint8)
    th = cv2.morphologyEx(th, cv2.MORPH_OPEN, k5)
    th = cv2.morphologyEx(th, cv2.MORPH_CLOSE, k15)
    contours, _ = cv2.findContours(th, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    min_px = settings["min_blob_mm2"] / (mosaic.mmpp ** 2)
    kept = [c for c in contours if cv2.contourArea(c) >= min_px]

    os.makedirs(LOC_DIR, exist_ok=True)
    overlay = mosaic.img.copy()
    cv2.drawContours(overlay, kept, -1, (0, 200, 255), 2)
    result = {"found": False, "n_blobs": len(kept)}
    if kept:
        allpts = np.vstack([c.reshape(-1, 2) for c in kept])
        px0, py0 = allpts.min(axis=0)
        px1, py1 = allpts.max(axis=0)
        m = settings["bbox_margin_mm"] / mosaic.mmpp
        px0, py0 = max(px0 - m, 0), max(py0 - m, 0)
        px1, py1 = min(px1 + m, mosaic.w - 1), min(py1 + m, mosaic.h - 1)
        # pixel y is flipped vs machine y
        x0_mm, y1_mm = mosaic.px_to_mm(px0, py0)
        x1_mm, y0_mm = mosaic.px_to_mm(px1, py1)
        result.update({
            "found": True,
            "bbox_mm": [x0_mm, y0_mm, x1_mm, y1_mm],
            "bbox_in": [v / MM_PER_UNIT for v in (x0_mm, y0_mm, x1_mm, y1_mm)],
        })
        cv2.rectangle(overlay, (int(px0), int(py0)), (int(px1), int(py1)),
                      (0, 80, 255), 3)
    cv2.imwrite(os.path.join(LOC_DIR, "mosaic.png"), mosaic.img)
    cv2.imwrite(os.path.join(LOC_DIR, "diff.png"), th)
    cv2.imwrite(os.path.join(LOC_DIR, "overlay.png"), overlay)
    with open(os.path.join(LOC_DIR, "result.json"), "w") as fh:
        json.dump(result, fh, indent=2)
    return result
