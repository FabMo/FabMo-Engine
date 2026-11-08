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


def _extract_vertical(d, min_signal, snr, half_window, sub=1):
    """d: difference image, stripe running top-to-bottom. -> [row, col, sig]
    sub: estimate each line's median / noise from every sub-th sample."""
    d = cv2.GaussianBlur(d, (5, 1), 0)              # smooth along the search line only
    d = d - np.median(d[:, ::sub], axis=1, keepdims=True)   # cancel AE brightness drift
    noise = 1.4826 * np.median(np.abs(d[:, ::sub]), axis=1) + 1e-3
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


def _runs(pts, al, ac, max_gap, max_jump):
    brk = np.r_[True, (np.diff(pts[:, al]) > max_gap) |
                (np.abs(np.diff(pts[:, ac])) > max_jump)]
    return np.cumsum(brk) - 1


def drop_off_colour_runs(pts, img_off, img_on, orientation="vertical", max_gap=2,
                         max_jump=3.0, max_blue=0.15):
    """Keep only stripe pieces whose colour change looks like the red laser:
    red goes UP and blue barely moves (|dB| <= max_blue * dR, medians over
    the run, 5x5-averaged). The camera's auto-exposure shifting a patch of
    clutter between the off/on frames changes all channels together (blue
    with red, or red going down), so this rejects it without the shot-
    relative brightness cut that also threw away dim real line on black
    plastic (2026-11-08)."""
    if len(pts) < 3:
        return pts
    al, ac = (0, 1) if orientation == "vertical" else (1, 0)
    pts = pts[np.argsort(pts[:, al])]
    d = cv2.blur(img_on.astype(np.float32) - img_off.astype(np.float32), (5, 5))
    r = np.clip(np.round(pts[:, 0]).astype(int), 0, d.shape[0] - 1)
    c = np.clip(np.round(pts[:, 1]).astype(int), 0, d.shape[1] - 1)
    dR, dB = d[r, c, 2], d[r, c, 0]
    lab = _runs(pts, al, ac, max_gap, max_jump)
    n = np.bincount(lab)
    order = np.argsort(lab, kind="stable")
    starts = np.r_[0, np.cumsum(n)[:-1]]
    ok = np.zeros(len(n), bool)
    for k, (s0, m) in enumerate(zip(starts, n)):
        idx = order[s0:s0 + m]
        mr, mb = np.median(dR[idx]), np.median(dB[idx])
        ok[k] = mr > 0 and abs(mb) <= max_blue * mr
    return pts[ok[lab]]


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


# ------------------------------------------------------- laser-on frame only
def extract_on_only(img_on, min_signal=6.0, snr=3.5, half_window=12, win=31,
                    max_blue=0.15, fast_bg=True):
    """Horizontal stripe from a single laser-ON frame (continuous scans:
    no laser-off reference). Redness (R - G) minus its smooth background
    (2-D median) leaves thin red features; each found piece must then look
    like laser in colour too — red up, blue flat in the same high-pass
    (scene edges and print show in every channel). Returns [row, col,
    signal] like extract(). On the black-block scan this matched the off/on
    method to ~0.003 mm on 85-99% of the points; weaker against clutter
    (elbow-scan test: ~50 spike points left vs 0).

    fast_bg: background medians on a 4x downscale (9 x 9 there ~ 36 px),
    the colour test sampled only at the found points, noise from every 4th
    sample — ~5x cheaper than full-res 31 x 31 medians, same points
    (2026-11-08: 720 -> ~150 ms per frame, single thread)."""
    h0, w0 = img_on.shape[:2]
    if not fast_bg:
        return _extract_on_only_full(img_on, min_signal, snr, half_window, win, max_blue)
    sw, sh = w0 // 4, h0 // 4
    small = cv2.resize(img_on, (sw, sh), interpolation=cv2.INTER_AREA)
    bgs = [cv2.medianBlur(np.ascontiguousarray(small[..., k]), 9) for k in range(3)]
    bg_rg = bgs[2].astype(np.float32) - bgs[1].astype(np.float32)
    rg = cv2.subtract(img_on[..., 2], img_on[..., 1], dtype=cv2.CV_32F)
    d = rg - cv2.resize(bg_rg, (w0, h0), interpolation=cv2.INTER_LINEAR)
    t = _extract_vertical(np.ascontiguousarray(d.T), min_signal, snr, half_window, sub=4)
    pts = clean(t[:, [1, 0, 2]], orientation="horizontal")
    if len(pts) < 3:
        return pts
    pts = pts[np.argsort(pts[:, 1])]
    # colour test at the points only: high-pass red / blue = 5x5 mean around
    # the point minus the small-image background there
    r = np.clip(np.round(pts[:, 0]).astype(int), 2, h0 - 3)
    c = np.clip(np.round(pts[:, 1]).astype(int), 2, w0 - 3)
    o = np.arange(-2, 3)
    rr = r[:, None, None] + o[None, :, None]
    cc = c[:, None, None] + o[None, None, :]
    rs = np.clip(r // 4, 0, sh - 1)
    cs = np.clip(c // 4, 0, sw - 1)
    R = img_on[rr, cc, 2].reshape(len(r), -1).mean(1) - bgs[2][rs, cs]
    B = img_on[rr, cc, 0].reshape(len(r), -1).mean(1) - bgs[0][rs, cs]
    lab = _runs(pts, 1, 0, 2, 3.0)
    n = np.bincount(lab)
    starts = np.r_[0, np.cumsum(n)[:-1]]
    ok = np.zeros(len(n), bool)
    for k, (s0, m) in enumerate(zip(starts, n)):
        mr, mb = np.median(R[s0:s0 + m]), np.median(B[s0:s0 + m])
        ok[k] = mr > 0 and abs(mb) <= max_blue * mr
    pts = pts[ok[lab]]
    return drop_weak_runs(pts, orientation="horizontal", rel_signal=0.1)


def _extract_on_only_full(img_on, min_signal=6.0, snr=3.5, half_window=12, win=31,
                          max_blue=0.15, fast_bg=False):
    """Horizontal stripe from a single laser-ON frame (continuous scans:
    no laser-off reference). Redness (R - G) high-passed across the line
    (minus a win x win median background) leaves thin red features; each
    found piece must then look like laser in colour too — red up, blue flat
    in the same high-pass (scene edges and print show in every channel).
    Returns [row, col, signal] like extract(). On the black-block scan this
    matched the off/on method to ~0.003 mm on 85-99% of the points; it is
    weaker against clutter (one elbow-scan test: 51 spike points left vs 0).
    """
    f = img_on.astype(np.float32)
    hp = []
    h0, w0 = img_on.shape[:2]
    for k in range(3):
        c = img_on[..., k]
        if fast_bg:
            # the background is smooth: median on a 4x downscale (9 x 9 there
            # ~ 36 px here) and scale back — ~10x cheaper than a full-res
            # 31 x 31 median, which was 55% of continuous-scan processing
            small = cv2.resize(c, (w0 // 4, h0 // 4), interpolation=cv2.INTER_AREA)
            bg = cv2.resize(cv2.medianBlur(small, 9), (w0, h0),
                            interpolation=cv2.INTER_LINEAR).astype(np.float32)
        else:
            bg = cv2.medianBlur(c, win).astype(np.float32)
        hp.append(f[..., k] - bg)
    hB, hG, hR = hp
    d = hR - hG
    t = _extract_vertical(np.ascontiguousarray(d.T), min_signal, snr, half_window)
    pts = t[:, [1, 0, 2]]
    pts = clean(pts, orientation="horizontal")
    if len(pts) < 3:
        return pts
    al, ac = 1, 0
    pts = pts[np.argsort(pts[:, al])]
    r = np.clip(np.round(pts[:, 0]).astype(int), 0, img_on.shape[0] - 1)
    c = np.clip(np.round(pts[:, 1]).astype(int), 0, img_on.shape[1] - 1)
    R = cv2.blur(hR, (5, 5))[r, c]
    B = cv2.blur(hB, (5, 5))[r, c]
    lab = _runs(pts, al, ac, 2, 3.0)
    n = np.bincount(lab)
    order = np.argsort(lab, kind="stable")
    starts = np.r_[0, np.cumsum(n)[:-1]]
    ok = np.zeros(len(n), bool)
    for k, (s0, m) in enumerate(zip(starts, n)):
        idx = order[s0:s0 + m]
        mr, mb = np.median(R[idx]), np.median(B[idx])
        ok[k] = mr > 0 and abs(mb) <= max_blue * mr
    pts = pts[ok[lab]]
    return drop_weak_runs(pts, orientation="horizontal", rel_signal=0.1)

