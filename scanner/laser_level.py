"""Laser brightness tuning: sweep the camera exposure with the laser off and
on, and report for each exposure how the stripe looks — peak level, clipping,
line width, points found and row noise.

    python3 laser_level.py sweep <name> [--exposures 300,200,...]
    python3 laser_level.py report captures/<name>

No motion. The laser is switched on once (all "off" frames first, then all
"on" frames), and the camera's exposure is put back afterwards.
"""

import argparse
import json
import os
import subprocess
import sys
import time

import cv2
import numpy as np

import camera
import fabmo_client as fabmo
import scan_settings
import stripe

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_EXPOSURES = [300, 200, 150, 100, 75, 50, 35, 25, 15, 10]


def set_ctrl(dev, name, val):
    subprocess.run(["v4l2-ctl", "-d", dev, "--set-ctrl", "%s=%s" % (name, val)],
                   capture_output=True)


def get_ctrl(dev, name):
    out = subprocess.run(["v4l2-ctl", "-d", dev, "--get-ctrl", name],
                         capture_output=True, text=True).stdout
    return int(out.split(":")[1])


def sweep(args):
    s = scan_settings.load()
    out_n = int(s["laser_output"])
    outdir = os.path.join(HERE, "captures", args.name)
    os.makedirs(outdir, exist_ok=True)
    exposures = [int(e) for e in args.exposures.split(",")]
    dev = camera.find_device()
    cap = camera.open_camera(dev)
    if not str(dev).startswith("/dev/"):
        sys.exit("camera is only reachable through the video stream; stop the camera servers")
    before = get_ctrl(dev, "exposure_time_absolute")
    try:
        for state in ("off", "on"):
            if state == "on":
                fabmo.set_output(out_n, 1)
                time.sleep(0.8)
            for e in exposures:
                set_ctrl(dev, "exposure_time_absolute", e)
                time.sleep(1.2)
                frame = camera.grab(cap, flush=8)
                cv2.imwrite(os.path.join(outdir, "e%04d_%s.png" % (e, state)), frame)
                print("%s exposure %d" % (state, e), flush=True)
    finally:
        fabmo.set_output(out_n, 0)
        set_ctrl(dev, "exposure_time_absolute", before)
        cap.release()
    with open(os.path.join(outdir, "manifest.json"), "w") as fh:
        json.dump({"exposures": exposures, "laser_color": s["laser_color"],
                   "brightness": get_ctrl(dev, "brightness"), "pose": fabmo.pose()}, fh)
    report(argparse.Namespace(dir=outdir))


def _fwhm(col):
    """Full width at half maximum of a 1-D profile around its peak (px)."""
    i = int(np.argmax(col))
    half = col[i] / 2.0
    a = i
    while a > 0 and col[a] > half:
        a -= 1
    b = i
    while b < len(col) - 1 and col[b] > half:
        b += 1
    return b - a - 1


def measure(off, on, colour):
    cm, _ = stripe.channels(colour)
    pts = stripe.extract(off, on, min_signal=6.0, snr=3.5, orientation="horizontal",
                         signal=stripe.default_signal(colour), colour=colour)
    res = {"n": len(pts)}
    if len(pts) < 50:
        return res
    pts = pts[np.argsort(pts[:, 1])]
    cols = pts[:, 1].astype(int)
    rows = pts[:, 0]
    chan = on[..., cm]
    d = chan.astype(np.float32) - off[..., cm].astype(np.float32)
    peak, clipw, width = [], [], []
    for c, r in zip(cols[::4], rows[::4]):
        r0 = int(round(r))
        lo, hi = max(0, r0 - 25), min(chan.shape[0], r0 + 26)
        seg = chan[lo:hi, c]
        peak.append(int(seg.max()))
        clipw.append(int((seg >= 250).sum()))
        width.append(_fwhm(d[lo:hi, c]))
    peak, clipw, width = np.array(peak), np.array(clipw), np.array(width)
    # row noise: what's left after removing the line's smooth shape (51-col median)
    k = 51
    if len(rows) > 3 * k:
        pad = np.pad(rows, k // 2, mode="edge")
        smooth = np.median(np.lib.stride_tricks.sliding_window_view(pad, k), axis=1)
        resid = rows - smooth
        keep = np.abs(resid) < 3.0             # surface steps are not noise
        res["noise_px"] = float(np.std(resid[keep]))
    res.update(peak_med=float(np.median(peak)), peak_p95=float(np.percentile(peak, 95)),
               clipped_pct=float(100.0 * (clipw > 0).mean()),
               clip_width_px=float(clipw[clipw > 0].mean()) if (clipw > 0).any() else 0.0,
               fwhm_px=float(np.median(width)), sig_med=float(np.median(pts[:, 2])),
               sig_p05=float(np.percentile(pts[:, 2], 5)),
               col_span=[int(cols.min()), int(cols.max())])
    return res


def report(args):
    with open(os.path.join(args.dir, "manifest.json")) as fh:
        man = json.load(fh)
    colour = man.get("laser_color") or "red"
    try:
        with open(os.path.join(HERE, "laser.json")) as fh:
            mm_px = float(json.load(fh).get("depth_mm_per_px") or 0)
    except Exception:
        mm_px = 0
    print("exposure  points  peak med/p95  clipped%  clip px  fwhm px  signal med/p05  noise px"
          + ("  (mm)" if mm_px else ""))
    rows = []
    for e in man["exposures"]:
        off = cv2.imread(os.path.join(args.dir, "e%04d_off.png" % e))
        on = cv2.imread(os.path.join(args.dir, "e%04d_on.png" % e))
        m = measure(off, on, colour)
        m["exposure"] = e
        m["bg_mean"] = [round(float(v), 1) for v in off.mean((0, 1))]
        rows.append(m)
        if "peak_med" not in m:
            print("%8d  %6d  (too few points)" % (e, m["n"]))
            continue
        noise = m.get("noise_px", float("nan"))
        print("%8d  %6d  %5.0f / %3.0f   %7.1f  %7.1f  %7.1f  %7.1f / %5.1f  %8.3f%s" % (
            e, m["n"], m["peak_med"], m["peak_p95"], m["clipped_pct"], m["clip_width_px"],
            m["fwhm_px"], m["sig_med"], m["sig_p05"], noise,
            "  %.3f" % (noise * mm_px) if mm_px else ""))
    with open(os.path.join(args.dir, "levels.json"), "w") as fh:
        json.dump(rows, fh, indent=1)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("sweep")
    p.add_argument("name")
    p.add_argument("--exposures", default=",".join(str(e) for e in DEFAULT_EXPOSURES))
    p.set_defaults(fn=sweep)
    p = sub.add_parser("report")
    p.add_argument("dir")
    p.set_defaults(fn=report)
    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
