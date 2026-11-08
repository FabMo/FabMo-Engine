"""Continuous laser-on sweep: the head moves at constant feed with the laser
on while the camera records every frame (option A, 2026-11-08).

Stop-and-go sweeps spend ~1.7 s per line (dwell laser off, dwell on);
here an 8.5 in sweep at 0.3 in/s takes ~30 s with a line every ~0.01 in
(30 fps). There is no laser-off reference: the stripe is found in each
laser-on frame alone (stripe.extract_on_only).

Timing. Frames carry the camera's buffer timestamp (CLOCK_MONOTONIC, ~16 ms
before the frame reaches us). Machine position comes from /status, polled
on a thread; reports arrive every ~100 ms with some delay. Over the
constant-feed part of the move position is linear in time, so a straight
line fitted to (arrival time, position) gives the position at any frame
time; one constant, latency_ms (settings: continuous_latency_ms), absorbs
what's left (status delay vs frame exposure). Calibrate it by scanning a
sharp edge in both directions (latency error shows up as a shift of
2 * speed * error between the two).

Capture writes the raw JPEG of every frame (no decoding during the scan);
processing (process_continuous) decodes and triangulates them afterwards
on all cores.
"""

import json
import os
import threading
import time

import cv2
import numpy as np

import stripe

IN_TO_MM = 25.4
AXES = ("x", "y", "z")
RUN_IN = 0.3          # inches before/after the scan range (reach constant feed)


class _StatusLog(threading.Thread):
    def __init__(self, fabmo, period=0.02):
        threading.Thread.__init__(self, daemon=True)
        self.fabmo, self.period = fabmo, period
        self.stop = threading.Event()
        self.rows = []                 # (t_arrival_monotonic, x, y, z, out9?, state)
        self.last = None
        self.out_key = None

    def run(self):
        while not self.stop.is_set():
            try:
                s = self.fabmo.status()
                t = time.monotonic()
                self.last = s
                self.rows.append((t, s["posx"], s["posy"], s["posz"],
                                  s.get(self.out_key) if self.out_key else None, s["state"]))
            except Exception:
                pass
            time.sleep(self.period)


class _FrameLog(threading.Thread):
    """Grabs every frame as raw JPEG to disk with its buffer timestamp."""

    def __init__(self, cap, outdir):
        threading.Thread.__init__(self, daemon=True)
        self.cap, self.outdir = cap, outdir
        self.stop = threading.Event()
        self.record = threading.Event()
        self.frames = []               # (t_frame_monotonic_s, file)
        self.n = 0

    def run(self):
        while not self.stop.is_set():
            if not self.cap.grab():
                time.sleep(0.005)
                continue
            if not self.record.is_set():
                continue
            ts = self.cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0
            ok, buf = self.cap.retrieve()
            if not ok or buf is None:
                continue
            f = "f_%05d.jpg" % self.n
            with open(os.path.join(self.outdir, f), "wb") as fh:
                fh.write(buf.tobytes())
            self.frames.append((ts, f))
            self.n += 1


def open_raw(dev=None, fps=60):
    """Camera in raw-MJPEG mode (retrieve() returns the JPEG bytes)."""
    import camera
    dev = dev or camera.find_device()
    camera.lock_controls(dev)
    for _ in range(4):
        cap = cv2.VideoCapture(dev, cv2.CAP_V4L2)
        if cap.isOpened():
            break
        cap.release()
        time.sleep(1.0)
    if not cap.isOpened():
        raise RuntimeError("could not open %s (camera busy?)" % dev)
    cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, camera.WIDTH)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, camera.HEIGHT)
    cap.set(cv2.CAP_PROP_FPS, fps)
    cap.set(cv2.CAP_PROP_CONVERT_RGB, 0)
    return cap


def run_continuous(fabmo, cap, outdir, axis, start, end, speed_ips, laser_out,
                   latency_ms=0.0, progress=None, abort=None, log=print, reverse=False,
                   on_live=None):
    """Laser-on constant-feed sweep of `axis` from origin+start to
    origin+end (inches). Returns the manifest. Laser off and the job
    stopped on error/abort; the head returns to the start only on success."""
    ax = axis.lower()
    if ax not in ("x", "y"):
        raise ValueError("axis must be x or y")
    if end <= start or speed_ips <= 0 or speed_ips > 2.0:
        raise ValueError("need end > start and 0 < speed <= 2 in/s")
    s0 = fabmo.status()
    if s0["state"] != "idle":
        raise RuntimeError("machine is %s (must be idle)" % s0["state"])
    origin = fabmo.pose()
    a0 = origin[ax] + start - RUN_IN
    a1 = origin[ax] + end + RUN_IN
    pts = [(origin["x"], origin["y"])]
    pts += [(a0, origin["y"]) if ax == "x" else (origin["x"], a0),
            (a1, origin["y"]) if ax == "x" else (origin["x"], a1)]
    fabmo.check_envelope(pts)
    os.makedirs(outdir, exist_ok=True)
    out = "out%d" % laser_out
    A = ax.upper()
    b0, b1 = (a1, a0) if reverse else (a0, a1)       # reverse: sweep end -> start
    prog = "\n".join([
        "G90", "M100 ({%s:0})" % out,
        "G0 %s%.4f" % (A, b0),
        "M100 ({%s:1})" % out, "G4 P0.8",          # laser on; camera exposure settles
        "G1 F%.2f %s%.4f" % (speed_ips * 60.0, A, b1),
        "M100 ({%s:0})" % out,
        "G0 X%.4f Y%.4f" % (origin["x"], origin["y"]),
    ]) + "\n"
    dur = (a1 - a0) / speed_ips
    log("continuous: origin %s; %s %+.3f..%+.3f in at %.2f in/s (~%.0f s), laser out%d"
        % (origin, A, start, end, speed_ips, dur, laser_out))
    man = {"kind": "continuous", "units": "inches", "origin": origin, "axis": ax,
           "reverse": bool(reverse),
           "start": start, "end": end, "speed_ips": speed_ips, "laser_output": laser_out,
           "latency_ms": latency_ms, "created": time.strftime("%Y-%m-%d %H:%M:%S"),
           "complete": False, "shots": []}
    st = _StatusLog(fabmo)
    st.out_key = out
    fr = _FrameLog(cap, outdir)
    st.start()
    fr.start()
    live = None
    if on_live is not None:
        live = LiveCont(outdir, fr.frames, st.rows, ax, origin[ax] + start,
                        origin[ax] + start, origin[ax] + end, latency_ms,
                        est_lines=(end - start) / speed_ips * 6.5)
        live.start()
        on_live(live)
    t0 = time.time()
    started = False
    try:
        time.sleep(0.5)
        fabmo.start_gcode(prog)
        started = True
        # record while the laser is on and the head is in the sweep
        phase = "to start"
        while True:
            if abort is not None and abort.is_set():
                raise _Abort()
            s = st.last
            if s is not None:
                p = s["pos" + ax]
                on = s.get(out) == 1
                if on and not fr.record.is_set():
                    fr.record.set()
                    phase = "sweeping"
                if fr.record.is_set() and not on and time.time() - t0 > 2:
                    break                                   # laser off: sweep done
                if s["state"] in ("idle", "stopped", "dead") and time.time() - t0 > 2:
                    if fr.record.is_set():
                        break
                    raise RuntimeError("job ended before the sweep (%s)" % s["state"])
                if progress and phase == "sweeping":
                    progress(int(max(0, min(1, abs(p - b0) / (a1 - a0))) * 100), 100)
            if time.time() - t0 > dur + 60:
                raise RuntimeError("sweep took too long")
            time.sleep(0.03)
        fr.record.clear()
        fabmo.wait_idle(timeout=60.0)
        man["complete"] = True
    except _Abort:
        log("continuous: aborted")
        raise
    finally:
        if live is not None:
            live.finish()
        fr.record.clear()
        fr.stop.set()
        st.stop.set()
        fr.join(timeout=2)
        st.join(timeout=2)
        try:
            if started and not man["complete"]:
                for _ in range(3):
                    if fabmo.status()["state"] == "idle":
                        break
                    fabmo.quit()
                    try:
                        fabmo.wait_idle(timeout=5.0)
                        break
                    except RuntimeError:
                        pass
        finally:
            try:
                fabmo.set_output(laser_out, 0)
            finally:
                man["status_log"] = [list(r[:5]) for r in st.rows]
                man["frames"] = [list(f) for f in fr.frames]
                man["duration_s"] = round(time.time() - t0, 1)
                _assign_poses(man, ax, a0, a1, latency_ms, log)
                with open(os.path.join(outdir, "manifest.json"), "w") as fh:
                    json.dump(man, fh)
    log("continuous: %d frames recorded, %d in range; %.0f s"
        % (len(man["frames"]), len(man["shots"]), man["duration_s"]))
    return man


class _Abort(Exception):
    pass


class LiveCont(threading.Thread):
    """Live preview during a continuous sweep: every `period` s take the
    NEWEST recorded frame, place it with a running fit of the laser-on
    position reports, and find its line in a small worker pool (separate
    processes, so the frame and status loggers aren't starved). Offers the
    same snapshot()/info() as sweep.Live, so scand's /live/points and the
    app's live view work unchanged. Heights are provisional (relative to
    the first lines' median, normally table); the final processing
    replaces the preview."""

    def __init__(self, outdir, frames, status_rows, ax, ref_pos, lo, hi, latency_ms,
                 workers=2, period=0.15, min_gap_in=0.015, est_lines=None):
        threading.Thread.__init__(self, daemon=True)
        from multiprocessing import Pool
        self.outdir, self.frames, self.rows = outdir, frames, status_rows
        self.ax, self.ref, self.lo, self.hi = ax, ref_pos, lo, hi
        self.lat = latency_ms / 1000.0
        self.period, self.min_gap = period, min_gap_in
        self.pool = Pool(workers)
        self.workers = workers
        self.stop_ev = threading.Event()
        self.lock = threading.Lock()
        self.shots = []              # float32 (N, 3), provisional heights
        self.z_ref = None
        self._early = []
        self.pending = 0
        # ~6.5 preview lines/s with 2 workers on the Pi
        self.total = max(1, int(est_lines or (hi - lo) / 0.03))
        self.last_pos = None
        self.k = 1 + AXES.index(ax)

    def _fit(self):
        R = [(r[0], r[self.k]) for r in list(self.rows) if len(r) > 4 and r[4] == 1]
        if len(R) < 4:
            return None
        R = np.array(R, float)
        R = R[np.r_[True, np.diff(R[:, 1]) != 0]]
        R = R[(R[:, 1] > self.lo - 0.1) & (R[:, 1] < self.hi + 0.1)]
        if len(R) < 3 or np.ptp(R[:, 0]) < 0.2:
            return None
        A = np.c_[R[:, 0], np.ones(len(R))]
        (v, c), *_ = np.linalg.lstsq(A, R[:, 1], rcond=None)
        return v, c

    def run(self):
        while not self.stop_ev.is_set():
            time.sleep(self.period)
            if self.pending >= self.workers * 2 or not self.frames:
                continue
            fit = self._fit()
            if fit is None:
                continue
            ts, f = self.frames[-1]
            p = fit[0] * (ts + self.lat) + fit[1]
            if not (self.lo <= p <= self.hi):
                continue
            if self.last_pos is not None and abs(p - self.last_pos) < self.min_gap:
                continue
            self.last_pos = p
            dp = np.zeros(3)
            dp[AXES.index(self.ax)] = (p - self.ref) * IN_TO_MM
            self.pending += 1
            try:
                self.pool.apply_async(_tri, ((0, os.path.join(self.outdir, f), None, dp, None),),
                                      callback=self._done, error_callback=self._err)
            except ValueError:            # pool closed
                return

    def _err(self, e):
        self.pending -= 1

    def _done(self, res):
        self.pending -= 1
        P = res[1][:, :3].astype(np.float32)
        with self.lock:
            if self.z_ref is None:
                if len(P):
                    self._early.append(P[:, 2])
                if len(self._early) >= 3:
                    self.z_ref = float(np.median(np.concatenate(self._early)))
                    for s in self.shots:
                        s[:, 2] -= self.z_ref
            if self.z_ref is not None:
                P = P.copy()
                P[:, 2] -= self.z_ref
            self.shots.append(P)

    def finish(self):
        self.stop_ev.set()
        self.join(timeout=2)
        self.pool.terminate()

    def snapshot(self, from_shot=0):
        with self.lock:
            done = len(self.shots)
            if self.z_ref is None:
                return np.zeros((0, 3), np.float32), 0
            parts = self.shots[from_shot:done]
        P = np.vstack(parts) if parts else np.zeros((0, 3), np.float32)
        return P, done

    def info(self):
        with self.lock:
            done = len(self.shots) if self.z_ref is not None else 0
            n = sum(len(s) for s in self.shots[:done])
        return {"shots_done": done, "total": self.total, "n_points": n}


def _assign_poses(man, ax, a0, a1, latency_ms, log=print):
    """Fit position(t) over the constant-feed part; give every frame inside
    the scan range a pose."""
    k = 1 + AXES.index(ax)
    rows = [r for r in man["status_log"]]
    if len(rows) < 5 or not man["frames"]:
        man["fit"] = None
        return
    # Only the constant-feed move: reports taken while the laser was on
    # (the rapids to the start and back home also cross the scan range —
    # fitting them gave 0.27 in/s for a 0.30 in/s move, 2026-11-08).
    rows = [r for r in rows if len(r) > 4 and r[4] == 1]
    if len(rows) < 5:
        man["fit"] = None
        log("continuous: too few position reports with the laser on (%d)" % len(rows))
        return
    R = np.array([[r[0], r[k]] for r in rows], float)
    # first arrival of each new value only (repeats are stale reports)
    keep = np.r_[True, np.diff(R[:, 1]) != 0]
    R = R[keep]
    o = man["origin"]
    # stay clear of the acceleration at both ends of the run-in
    lo = o[ax] + man["start"] - RUN_IN * 0.5
    hi = o[ax] + man["end"] + RUN_IN * 0.5
    seg = R[(R[:, 1] > lo) & (R[:, 1] < hi)]
    if len(seg) < 4:
        man["fit"] = None
        log("continuous: too few position reports in the sweep (%d)" % len(seg))
        return
    A = np.c_[seg[:, 0], np.ones(len(seg))]
    (v, c), *_ = np.linalg.lstsq(A, seg[:, 1], rcond=None)
    res = seg[:, 1] - A @ np.array([v, c])
    man["fit"] = {"speed_ips": float(v), "rms_in": float(res.std()), "n": int(len(seg))}
    log("continuous: position fit %.4f in/s (commanded %.2f), residual %.4f in rms over %d reports"
        % (v, man["speed_ips"], res.std(), len(seg)))
    lat = latency_ms / 1000.0
    shots = []
    for ts, f in man["frames"]:
        p = v * (ts + lat) + c
        if o[ax] + man["start"] <= p <= o[ax] + man["end"]:
            pose = dict(o)
            pose[ax] = float(p)
            shots.append({"pose": pose, "img_on": f, "t": ts})
    man["shots"] = shots


# ------------------------------------------------------------- processing
_CAL = {}
BAND = [None]          # row band used by the last triangulate_frames (for logs)


def _tri(args):
    """Worker: one frame -> (index, (N, 4) points)."""
    import sweep
    i, path, R_cm, dp, band = args
    if "cal" not in _CAL:
        _CAL["cal"] = sweep.load_cal()
        cv2.setNumThreads(1)          # one process per core instead of oversubscribing
    cal = _CAL["cal"]
    img = cv2.imread(path)
    if img is None:
        return i, np.zeros((0, 4))
    r0, r1 = band if band else (0, img.shape[0])
    pts = stripe.extract_on_only(np.ascontiguousarray(img[r0:r1]))
    if len(pts):
        pts[:, 0] += r0                       # back to full-image rows
    if len(pts) == 0:
        return i, np.zeros((0, 4))
    u = cv2.undistortPoints(pts[:, [1, 0]].reshape(-1, 1, 2).astype(np.float64),
                            cal["K"], cal["D"]).reshape(-1, 2)
    r = np.c_[u, np.ones(len(u))]
    X = r * (cal["c"] / (r @ cal["m"]))[:, None]
    P = (X @ cal["R_mc"] + dp) if R_cm is None else (X @ R_cm.T + dp)
    return i, np.c_[P, pts[:, 2]]


def _band_rows(path):
    img = cv2.imread(path)
    if img is None:
        return None
    p = stripe.extract_on_only(img)
    if len(p) < 50:
        return None
    return np.percentile(p[:, 0], [5, 99])     # 5th: ignore sparse stray points


def _stripe_band(jobs, pool, n_sample=24, margin=120, min_rows=240):
    """Image rows the laser line occupies in this scan, from a full search on
    a sample of frames (+ margin; 120 px ~ 50 mm of extra height). Frame
    processing then touches only that band: with 4 workers the Pi is limited
    by memory bandwidth, not CPU. A feature taller than the band, seen only
    between sampled frames, would be lost (not mis-measured)."""
    paths = [j[1] for j in jobs[::max(1, len(jobs) // n_sample)]]
    rows = [r for r in pool.map(_band_rows, paths) if r is not None]
    if not rows:
        return None
    rows = np.array(rows)
    r0 = int(max(0, rows[:, 0].min() - margin))
    r1 = int(min(1080, rows[:, 1].max() + margin))
    if r1 - r0 < min_rows:
        mid = (r0 + r1) // 2
        r0, r1 = max(0, mid - min_rows // 2), min(1080, mid + min_rows // 2)
    return (r0, r1)


def triangulate_frames(capdir, shots, every=1, progress=None, workers=4):
    """-> list of (N, 4) per used frame, list of shot indices used."""
    from multiprocessing import Pool
    p0 = np.array([shots[0]["pose"][a] for a in AXES])
    jobs = []
    for i in range(0, len(shots), max(1, every)):
        s = shots[i]
        dp = (np.array([s["pose"][a] for a in AXES]) - p0) * IN_TO_MM
        jobs.append((i, os.path.join(capdir, s["img_on"]), None, dp))
    out = {}
    with Pool(workers) as pool:
        band = _stripe_band(jobs, pool)
        BAND[0] = band
        jobs = [j + (band,) for j in jobs]
        for n, (i, P) in enumerate(pool.imap_unordered(_tri, jobs, chunksize=4)):
            out[i] = P
            if progress:
                progress(n + 1, len(jobs))
    idx = sorted(out)
    return [out[i] for i in idx], idx


if __name__ == "__main__":
    import argparse
    import fabmo_client as fabmo
    import scan_settings
    import sweep
    ap = argparse.ArgumentParser()
    ap.add_argument("name")
    ap.add_argument("--axis", default="y")
    ap.add_argument("--start", type=float, default=-0.5)
    ap.add_argument("--end", type=float, default=5.5)
    ap.add_argument("--speed", type=float)
    ap.add_argument("--reverse", action="store_true")
    ap.add_argument("--line-step", type=float)
    a = ap.parse_args()
    st = scan_settings.load()
    here = os.path.dirname(os.path.abspath(__file__))
    outdir = os.path.join(here, "data", "scans", a.name)
    cap = open_raw()
    try:
        man = run_continuous(fabmo, cap, outdir, a.axis, a.start, a.end,
                             a.speed or st["continuous_speed_ips"], int(st["laser_output"]),
                             float(st["continuous_latency_ms"]), reverse=a.reverse)
    finally:
        cap.release()
    man["line_step_in"] = a.line_step or st["continuous_line_step_in"]
    with open(os.path.join(outdir, "manifest.json"), "w") as fh:
        json.dump(man, fh)
    t = time.time()
    sweep.process_dir(outdir)
    print("processed in %.0f s" % (time.time() - t))
