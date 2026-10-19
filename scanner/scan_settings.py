"""Scanner settings: one JSON file, defaults filled in on load.

All *_in values are machine units (inches on this machine); all *_mm
values are metric vision-side units. Machine coords stay in inches and
are converted at the vision boundary (MM_PER_UNIT).
"""

import json
import os

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
SETTINGS_PATH = os.path.join(DATA_DIR, "scanner.json")

MM_PER_UNIT = 25.4  # machine runs in inches

DEFAULTS = {
    # --- survey / locate ---
    "survey_region_in": [0.0, 0.0, 24.0, 18.0],   # x0, y0, x1, y1 (work coords)
    "survey_z_in": 4.0,          # head Z for table survey shots
    "survey_overlap": 0.25,      # fraction of frame footprint
    "mosaic_mm_per_px": 0.5,
    "diff_threshold": 30,        # 0-255 on blurred grayscale absdiff
    "min_blob_mm2": 400.0,       # ignore diff blobs smaller than this
    "bbox_margin_mm": 10.0,

    # --- camera mounting (nominal until hand-eye/head calibration) ---
    "cam_offset_in": [0.0, 0.0],   # camera center minus machine X/Y position
    "cam_z_at_zero_in": 4.0,       # lens height above table when machine Z=0

    # --- orbit scan ---
    "headings_deg": [0, 90, 180, 270],  # B-axis indexed stops
    "laser_offset_in": 0.0,     # laser plane ahead of head position (along facing)
    "scan_step_mm": 2.0,        # sweep increment between frame pairs
    "lane_width_mm": 120.0,     # usable stripe width on the table per lane
    "part_zmax_in": 2.0,        # assumed part height until laser height probe exists
    "clearance_in": 1.0,        # head stays this far above part_zmax
    "safe_z_in": 5.0,           # traverse height between passes
    "settle_s": 0.4,

    # --- hardware ---
    "laser_output": 5,          # M100 ({out<N>:...}); 1=spindle, 4=arm motion here
    "use_laser": True,          # False: capture laser-off frames only
    "use_pan": False,           # False until the B axis is wired: skip B moves
    "pan_prompt": False,        # True: pause for manual head rotation per heading
}


def load():
    s = dict(DEFAULTS)
    try:
        with open(SETTINGS_PATH) as fh:
            s.update(json.load(fh))
    except (IOError, ValueError):
        pass
    return s


def save(s):
    os.makedirs(DATA_DIR, exist_ok=True)
    known = {k: s[k] for k in s if k in DEFAULTS}
    with open(SETTINGS_PATH, "w") as fh:
        json.dump(known, fh, indent=2)
    return known


def update(changes):
    s = load()
    for k, v in changes.items():
        if k in DEFAULTS:
            s[k] = v
    return save(s)
