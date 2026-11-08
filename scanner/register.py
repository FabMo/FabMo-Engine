"""Align point clouds from different pan headings by their shared surfaces.

The pan model (pan.json) puts each heading's points in roughly the right
place (~1-3 mm: B backlash/scale and head wobble on the first PRS mount);
this refines it. The scanner only ever looks down from ~30 deg, so the
data is essentially a height field: the reference heading becomes a height
map H(x, y) and every other heading is moved (small rotation about its
centroid + translation, 6 DOF) to minimise  z - H(x, y)  over the points
both see. The table pins Z and tilt; the part's slopes and walls pin X, Y
and the turn about vertical — a flat part on a flat table can't fix X/Y,
and the result says so (cond / shift).

No SciPy: Gauss-Newton with a robust (trimmed) residual set, numpy only.
"""

import cv2
import numpy as np


def height_map(P, cell=1.0, min_pts=2, max_gap_mm=4.0):
    """Median height per cell -> (H, lo, cell); cells with < min_pts -> NaN."""
    lo = np.floor(P[:, :2].min(0) / cell) * cell - cell
    ij = np.floor((P[:, :2] - lo) / cell).astype(int)
    W, Hh = ij.max(0) + 2
    key = ij[:, 1] * W + ij[:, 0]
    order = np.lexsort((P[:, 2], key))
    k = key[order]
    z = P[order, 2]
    starts = np.r_[0, np.nonzero(np.diff(k))[0] + 1]
    counts = np.diff(np.r_[starts, len(k)])
    med = z[starts + counts // 2]
    H = np.full(Hh * W, np.nan)
    ok = counts >= min_pts
    H[k[starts][ok]] = med[ok]
    H = H.reshape(Hh, W)
    # Bridge the gaps between laser lines (2.5 mm apart at a 0.1 in step,
    # wider than a cell): bilinear sampling needs all four corners, so an
    # unfilled map gives no usable points at all (seen on the first
    # multi-heading scan). Short gaps only; shadows stay empty.
    gap = int(round(max_gap_mm / cell))
    for col in range(W):
        _fill_runs(H[:, col], gap)
    for row in range(Hh):
        _fill_runs(H[row, :], gap)
    return H, lo, cell


def _fill_runs(line, max_gap):
    ok = ~np.isnan(line)
    idx = np.nonzero(ok)[0]
    if len(idx) < 2:
        return
    gaps = np.diff(idx)
    for k in np.nonzero((gaps > 1) & (gaps <= max_gap + 1))[0]:
        a, b = idx[k], idx[k + 1]
        line[a + 1:b] = np.interp(np.arange(a + 1, b), [a, b], [line[a], line[b]])


def _sample(H, lo, cell, xy):
    """Bilinear H and its gradient at xy; NaN where any corner is missing."""
    g = (xy - lo) / cell - 0.5                       # cell-centre coordinates
    i0 = np.floor(g).astype(int)
    f = g - i0
    Hh, W = H.shape
    ok = (i0[:, 0] >= 0) & (i0[:, 1] >= 0) & (i0[:, 0] < W - 1) & (i0[:, 1] < Hh - 1)
    out = np.full(len(xy), np.nan)
    gx = np.full(len(xy), np.nan)
    gy = np.full(len(xy), np.nan)
    if not ok.any():
        return out, gx, gy
    c, r = i0[ok, 0], i0[ok, 1]
    fx, fy = f[ok, 0], f[ok, 1]
    h00, h10, h01, h11 = H[r, c], H[r, c + 1], H[r + 1, c], H[r + 1, c + 1]
    out[ok] = (h00 * (1 - fx) * (1 - fy) + h10 * fx * (1 - fy) +
               h01 * (1 - fx) * fy + h11 * fx * fy)
    gx[ok] = ((h10 - h00) * (1 - fy) + (h11 - h01) * fy) / cell
    gy[ok] = ((h01 - h00) * (1 - fx) + (h11 - h10) * fx) / cell
    return out, gx, gy


def align(ref, mov, iters=40, cell=1.0, max_slope=2.5, sample=40000, log=None):
    """Rigid transform (R, t) taking mov (N,3 mm) onto ref's surface.
    Returns R, t, info. Apply as  mov @ R.T + t."""
    H, lo, cell = height_map(ref, cell)
    rng = np.random.default_rng(0)
    Q = mov if len(mov) <= sample else mov[rng.choice(len(mov), sample, replace=False)]
    c = Q.mean(0)
    R = np.eye(3)
    t = np.zeros(3)
    info = {}
    sigma = None
    for it in range(iters):
        P = (Q - c) @ R.T + c + t
        h, hx, hy = _sample(H, lo, cell, P[:, :2])
        valid = np.isfinite(h) & (np.hypot(hx, hy) < max_slope)
        r = P[:, 2] - h
        if valid.sum() < 200:
            raise RuntimeError("too little overlap with the reference heading (%d points)"
                               % valid.sum())
        mad = 1.4826 * np.median(np.abs(r[valid] - np.median(r[valid])))
        sigma = max(0.3, 3 * mad) if sigma is None else max(0.3, min(sigma, 3 * mad))
        if it == 0:
            sigma = max(sigma, 3.0)                 # first pass: accept the pan-model error
            info["rms_before"] = float(np.sqrt(np.mean(r[valid & (np.abs(r) < 10)] ** 2)))
        use = valid & (np.abs(r - np.median(r[valid])) < 3 * sigma)
        q = P[use] - (c + t)
        gx_, gy_, rr = hx[use], hy[use], r[use]
        # d r / d(omega, t) for P' = P + omega x q + t
        dx = np.c_[np.zeros(len(q)), q[:, 2], -q[:, 1], np.ones(len(q)), np.zeros(len(q)), np.zeros(len(q))]
        dy = np.c_[-q[:, 2], np.zeros(len(q)), q[:, 0], np.zeros(len(q)), np.ones(len(q)), np.zeros(len(q))]
        dz = np.c_[q[:, 1], -q[:, 0], np.zeros(len(q)), np.zeros(len(q)), np.zeros(len(q)), np.ones(len(q))]
        J = dz - gx_[:, None] * dx - gy_[:, None] * dy
        A = J.T @ J
        lam = 1e-6 * np.trace(A) / 6
        delta = -np.linalg.solve(A + lam * np.eye(6), J.T @ rr)
        dR = cv2.Rodrigues(delta[:3].reshape(3, 1))[0]
        R = dR @ R
        t = t + delta[3:]
        if np.abs(delta[:3]).max() < 1e-6 and np.abs(delta[3:]).max() < 1e-4:
            break
    ev = np.linalg.eigvalsh(A)
    P = (Q - c) @ R.T + c + t
    h, hx, hy = _sample(H, lo, cell, P[:, :2])
    valid = np.isfinite(h) & (np.hypot(hx, hy) < max_slope)
    r = P[:, 2] - h
    good = valid & (np.abs(r) < 3 * sigma)
    info.update(rms_after=float(np.sqrt(np.mean(r[good] ** 2))), n_used=int(good.sum()),
                iterations=it + 1, cond=float(ev.max() / max(ev.min(), 1e-12)),
                rot_deg=float(np.degrees(np.linalg.norm(cv2.Rodrigues(R)[0]))),
                yaw_deg=float(np.degrees(cv2.Rodrigues(R)[0][2, 0])))
    # express as a transform of the original coordinates: x -> R (x - c) + c + t
    t_full = c + t - R @ c
    info["shift_mm"] = [round(float(v), 3) for v in t_full]
    return R, t_full, info
