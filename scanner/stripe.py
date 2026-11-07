"""Laser-stripe extraction from a laser-off / laser-on frame pair.

The stripe is searched as one peak per image line ACROSS it: per row for a
roughly vertical stripe, per column for a roughly horizontal one
(orientation="auto" tries both and keeps the one that finds more points).
Works on the red-channel difference (on - off): the laser adds red, and
differencing removes the scene.

The EMEET camera's auto-exposure can't be locked, so the two frames may
differ slightly in overall brightness; each line's median difference is
subtracted to cancel that. Peak position is the intensity centroid over
the part of the peak above half its height, which stays centred on a
clipped (flat-topped) stripe where a simple argmax or parabola fit would
not.

Points are always returned in image coordinates as [row, col, signal].
"""

import cv2
import numpy as np


def _extract_vertical(d, min_signal, snr, half_window):
    """d: difference image, stripe running top-to-bottom. -> [row, col, sig]"""
    d = cv2.GaussianBlur(d, (5, 1), 0)              # smooth along the search line only
    d = d - np.median(d, axis=1, keepdims=True)     # cancel AE brightness drift
    noise = 1.4826 * np.median(np.abs(d), axis=1) + 1e-3
    h, w = d.shape
    cols = np.argmax(d, axis=1)
    peak = d[np.arange(h), cols]
    out = []
    for r in np.nonzero((peak > min_signal) & (peak > snr * noise))[0]:
        c = cols[r]
        a, b = max(0, c - half_window), min(w, c + half_window + 1)
        seg = d[r, a:b]
        m = seg > 0.5 * peak[r]
        # keep only the contiguous run around the peak (ignore side blobs)
        lab = np.cumsum(np.r_[0, np.diff(m.astype(int)) != 0])
        m &= lab == lab[c - a]
        wts = seg[m]
        xs = np.arange(a, b)[m]
        out.append((r, float((wts * xs).sum() / wts.sum()), float(peak[r])))
    return np.array(out, dtype=np.float64).reshape(-1, 3)


def extract(img_off, img_on, min_signal=12.0, snr=5.0, half_window=12,
            orientation="auto", return_orientation=False):
    """Stripe points as an (N, 3) array of [row, col_subpixel_or_row_subpixel,
    signal] in image coordinates — for a vertical stripe the column is
    sub-pixel, for a horizontal one the row is.

    orientation : "vertical", "horizontal" or "auto"
    min_signal  : minimum peak height (red levels, 0-255 scale)
    snr         : minimum peak height in units of the line's robust noise
    """
    d = img_on[..., 2].astype(np.float32) - img_off[..., 2].astype(np.float32)
    res = {}
    if orientation in ("vertical", "auto"):
        res["vertical"] = _extract_vertical(d, min_signal, snr, half_window)
    if orientation in ("horizontal", "auto"):
        t = _extract_vertical(np.ascontiguousarray(d.T), min_signal, snr, half_window)
        res["horizontal"] = t[:, [1, 0, 2]]          # back to [row, col, sig]
    ori = max(res, key=lambda k: len(res[k]))
    return (res[ori], ori) if return_orientation else res[ori]


def clean(pts, max_jump=3.0, max_line_dev=None, orientation="vertical"):
    """Drop points whose across-stripe position jumps away from their
    neighbours (specks, reflections). pts as returned by extract().

    max_line_dev: if set, additionally keep only points within that many
    pixels of a robust straight-line fit (use for a stripe on a flat
    surface, e.g. calibration)."""
    if len(pts) < 3:
        return pts
    # along = index running along the stripe, across = the sub-pixel coordinate
    al, ac = (0, 1) if orientation == "vertical" else (1, 0)
    pts = pts[np.argsort(pts[:, al])]
    c = pts[:, ac]
    med = np.array([np.median(c[max(0, i - 3):i + 4]) for i in range(len(c))])
    pts = pts[np.abs(c - med) <= max_jump]
    if max_line_dev is not None and len(pts) > 10:
        keep = np.ones(len(pts), bool)
        for _ in range(5):
            A = np.c_[pts[keep, al], np.ones(keep.sum())]
            coef = np.linalg.lstsq(A, pts[keep, ac], rcond=None)[0]
            dev = np.abs(pts[:, ac] - np.c_[pts[:, al], np.ones(len(pts))] @ coef)
            keep = dev <= max(max_line_dev, 3 * 1.4826 * np.median(dev[keep]))
            keep &= dev <= 5 * max_line_dev
        pts = pts[keep]
    return pts
