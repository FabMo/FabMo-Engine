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
    rows = np.nonzero((peak > min_signal) & (peak > snr * noise))[0]
    if len(rows) == 0:
        return np.zeros((0, 3))
    # Vectorised over rows (was a per-row Python loop: ~90% of processing
    # time, and it held the GIL against the capture threads). For each row:
    # the window +-half_window around the peak, the samples above half the
    # peak height, restricted to the contiguous run containing the peak;
    # position = intensity centroid of that run.
    k = 2 * half_window + 1
    off = np.arange(-half_window, half_window + 1)
    xs = cols[rows, None] + off[None, :]                       # (R, k) column indices
    inside = (xs >= 0) & (xs < w)
    seg = d[rows[:, None], np.clip(xs, 0, w - 1)]
    pk = peak[rows, None]
    m = inside & (seg > 0.5 * pk)
    c = half_window                                            # the peak sits at the centre
    right = np.cumprod(m[:, c:], axis=1).astype(bool)          # run from centre rightwards
    left = np.cumprod(m[:, c::-1], axis=1).astype(bool)[:, ::-1]
    run = np.concatenate([left[:, :-1], right], axis=1)        # (R, k), centre counted once
    wts = np.where(run, seg, 0.0)
    pos = (wts * xs).sum(1) / wts.sum(1)
    return np.c_[rows, pos, peak[rows]].astype(np.float64)


def extract(img_off, img_on, min_signal=12.0, snr=5.0, half_window=12,
            orientation="auto", return_orientation=False, signal="r"):
    """Stripe points as an (N, 3) array of [row, col_subpixel_or_row_subpixel,
    signal] in image coordinates — for a vertical stripe the column is
    sub-pixel, for a horizontal one the row is.

    orientation : "vertical", "horizontal" or "auto"
    min_signal  : minimum peak height (red levels, 0-255 scale)
    snr         : minimum peak height in units of the line's robust noise
    signal      : "r"  — red difference (on - off)
                  "rg" — red difference minus green difference. Use on bright
                  surfaces (pale wood): there the red channel clips at 255
                  over a band ~40 px wide around the stripe, leaving a flat
                  plateau, while the camera's colour processing still shows
                  the line as a sharp dip in green (seen on pine, Nov 2026).
    """
    on = img_on.astype(np.float32)
    off = img_off.astype(np.float32)
    d = on[..., 2] - off[..., 2]
    if signal == "rg":
        d = d - (on[..., 1] - off[..., 1])
    elif signal != "r":
        raise ValueError("signal must be 'r' or 'rg'")
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
    # running median over +-3 neighbours (window truncated at the ends)
    win = np.lib.stride_tricks.sliding_window_view(
        np.pad(c, 3, constant_values=np.nan), 7)
    with np.errstate(all="ignore"):
        med = np.nanmedian(win, axis=1)
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


def drop_weak_runs(pts, orientation="vertical", min_run=15, max_gap=2, max_jump=3.0,
                   rel_signal=0.2):
    """Keep only stripe pieces that look like laser line: continuous runs of
    at least min_run lines (gaps <= max_gap lines, steps <= max_jump px)
    whose median signal is at least rel_signal x the shot's strong-line
    level (90th percentile of signal).

    Removes false stripe points from clutter outside the table: things whose
    colour shifts a little between the laser-off and laser-on frames (camera
    auto-exposure) show up as short, faint fragments, and because they sit
    in the same image region in every shot, neighbouring shots 'confirm'
    them (seen as 100 mm spikes on a PVC-fitting scan, Nov 2026). Real line
    on glossy parts breaks into pieces too, but long, bright ones.
    """
    if len(pts) < 3:
        return pts
    al, ac = (0, 1) if orientation == "vertical" else (1, 0)
    pts = pts[np.argsort(pts[:, al])]
    brk = np.r_[True, (np.diff(pts[:, al]) > max_gap) |
                (np.abs(np.diff(pts[:, ac])) > max_jump)]
    lab = np.cumsum(brk) - 1
    n = np.bincount(lab)
    ref = np.percentile(pts[:, 2], 90)
    order = np.argsort(lab, kind="stable")
    starts = np.r_[0, np.cumsum(n)[:-1]]
    med = np.array([np.median(pts[order[s:s + k], 2]) for s, k in zip(starts, n)])
    return pts[(n[lab] >= min_run) & (med[lab] >= rel_signal * ref)]
