"""Dual-laser sheet alignment check / live readout (one output drives both lasers,
so each laser is isolated by covering the other).

  python3 laser_align.py ref <name>      cover the laser you will ADJUST; records the
                                         other laser's line as reference <name> (~5 s)
  python3 laser_align.py live <name>     cover the reference laser; live readout of the
                                         uncovered laser's line vs the reference. Ctrl-C stops.
  python3 laser_align.py compare <a> <b> offline comparison of two recorded lines

All modes toggle the laser output off for one frame (lasers-off picture of the scene)
and leave it on. Machine must be idle. Keep the scene still between 'ref' and 'live';
if something is bumped, redo both. With a block in view the readout also splits the
offset into block-top / table, which tells a translation (both move together) from a
tilt (they move apart).

Readout: ROLL diff = angle between the lines (target +-0.05 deg); OFFSET = parallel gap
in image rows, positive = adjusted line lower in the image, i.e. its sheet nearer the
camera (target 0 +-1 px; ~0.12 mm/px at the table); signal ~20-45 for one laser at the
scanning drive level -- about double means both lasers are uncovered.
Files go to captures/align/<name>{.npy,_off.png,_on.png}.
"""
import sys, os, time, cv2, numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); os.chdir(HERE); sys.path.insert(0, HERE)
import camera, fabmo_client, scan_settings
OUT = os.path.join(HERE, "captures", "align"); os.makedirs(OUT, exist_ok=True)
H, W = 1080, 1920; X = np.arange(W); ROWS = np.arange(H, dtype=np.float32)


def centroid_col(d, c, thr):
    """Sub-pixel stripe row in column c of the on-off red image d: weighted centroid of
    the half-max run around the peak (robust to a saturated plateau). -> (row, width)."""
    col = d[:, c]; r = int(col.argmax()); pk = col[r]
    if pk <= thr:
        return np.nan, 0
    above = col > 0.5 * pk
    a = r
    while a > 0 and above[a - 1]: a -= 1
    b = r
    while b < H - 1 and above[b + 1]: b += 1
    lo, hi = max(0, a - 12), min(H, b + 13)
    seg = col[lo:hi]; wgt = np.clip(seg - 0.3 * pk, 0, None)
    return float((wgt * ROWS[lo:hi]).sum() / wgt.sum()), int(b - a + 1)


def stripe_rows(on, off, step=1, thr=10):
    ch = 0 if scan_settings.load().get("laser_color") == "blue" else 2      # BGR
    d = cv2.GaussianBlur(on[:, :, ch].astype(np.float32) - off[:, :, ch].astype(np.float32), (1, 5), 0)
    pval = d.max(axis=0); cen = np.full(W, np.nan); wid = np.zeros(W)
    for c in range(0, W, step):
        cen[c], wid[c] = centroid_col(d, c, thr)
    return cen, pval, wid


def laser_output():
    return int(scan_settings.load().get("laser_output", 9))


def off_frame(cap):
    st = fabmo_client.status()
    if st.get("state") != "idle":
        raise SystemExit("machine must be idle (state %s)" % st.get("state"))
    n = laser_output()
    fabmo_client.set_output(n, 0); time.sleep(0.7); off = camera.grab(cap)
    fabmo_client.set_output(n, 1); time.sleep(0.7)
    return off


def compare(A, B, once=True):
    """A, B: (rows, signal, width) arrays. Prints roll/offset of A relative to B."""
    ok = ~np.isnan(A[0]) & ~np.isnan(B[0]) & (A[1] > 10) & (B[1] > 10) & (abs(A[0] - B[0]) < 40)
    if ok.sum() < 60:
        return ("no match: %d cols have a stripe, %d overlap the reference (signal %.0f) "
                "- wrong laser covered, or scene moved?" % ((A[1] > 10).sum(), ok.sum(), np.median(A[1])))
    g = A[0][ok] - B[0][ok]; xs = X[ok]
    k, c0 = np.polyfit(xs, g, 1); res = g - (k * xs + c0); keep = abs(res - np.median(res)) < 3
    k, c0 = np.polyfit(xs[keep], g[keep], 1)
    rr = B[0][ok][keep]; split = (rr.min() + rr.max()) / 2
    hi_, lo_ = g[keep][rr < split], g[keep][rr >= split]
    byh = ("   block %+5.1f / table %+5.1f px" % (np.median(hi_), np.median(lo_))
           if min(len(hi_), len(lo_)) > 5 and rr.max() - rr.min() > 40 else "")
    thirds = [np.median(g[keep][m]) if m.sum() > 5 else float("nan")
              for m in (xs[keep] < W // 3, xs[keep] > 2 * W // 3)]
    return ("ROLL diff %+.3f deg (%+5.1f px across)   OFFSET %+5.1f px%s   gap left %+5.1f right %+5.1f px"
            "   signal %.0f   cols %d" % (np.degrees(np.arctan(k)), k * W, np.median(g[keep]), byh,
                                          thirds[0], thirds[1], np.median(A[1][ok]), keep.sum()))


def main():
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    mode, name = sys.argv[1], sys.argv[2]
    if mode == "compare":
        A = np.load(os.path.join(OUT, name + ".npy")); B = np.load(os.path.join(OUT, sys.argv[3] + ".npy"))
        print(compare(A, B)); return
    cap = camera.open_camera()
    try:
        off = off_frame(cap)
        if mode == "ref":
            on = camera.grab(cap)
            cen, pval, wid = stripe_rows(on, off)
            np.save(os.path.join(OUT, name + ".npy"), np.stack([cen, pval, wid]))
            cv2.imwrite(os.path.join(OUT, name + "_off.png"), off); cv2.imwrite(os.path.join(OUT, name + "_on.png"), on)
            ok = ~np.isnan(cen)
            print("reference %s saved: stripe in %.0f%% of columns, signal median %.0f, rows %.0f-%.0f, width %.0f px"
                  % (name, 100 * ok.mean(), np.median(pval[ok]), np.nanpercentile(cen, 5), np.nanpercentile(cen, 95),
                     np.median(wid[ok])))
        elif mode == "live":
            ref = np.load(os.path.join(OUT, name + ".npy"))
            while True:
                on = camera.grab(cap, flush=2)
                print("\r" + compare(stripe_rows(on, off, step=4), ref) + "   ", end="", flush=True)
        else:
            raise SystemExit(__doc__)
    except KeyboardInterrupt:
        print()
    finally:
        cap.release()


if __name__ == "__main__":
    main()
