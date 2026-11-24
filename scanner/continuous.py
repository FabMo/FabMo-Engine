"""Continuous laser-on sweep: the head moves at constant feed with the laser
on while the camera records every frame (option A, 2026-11-08).

Stop-and-go sweeps spend ~1.7 s per line (dwell laser off, dwell on);
here an 8.5 in sweep at 0.3 in/s takes ~30 s with a line every ~0.01 in
(30 fps). There is no laser-off reference: the stripe is found in each
laser-on frame alone (stripe.extract_on_only).

Two-pass option (2026-11-24): the same sweep is made twice in one job,
first with the laser off, then with it on. Every frame of both passes gets
a position from its own pass's fit (same direction and speed, so the
latency constant is the same in both and cancels), and each laser-on frame
is processed against the laser-off frames taken at the same place — the
two nearest, blended by position — with the off/on method of the
stop-and-go sweeps (sweep._stripe_points).

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
        self.frames = []               # (t_frame_monotonic_s, file), laser on
        self.frames_off = []           # same, laser-off pass (two-pass sweeps)
        self.tag = "on"                # which pass is being recorded
        self.n = 0

    def run(self):
        while not self.stop.is_set():
            if not self.cap.grab():
                time.sleep(0.005)
                continue
            tag = self.tag
            if not self.record.is_set():
                continue
            ts = self.cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0
            ok, buf = self.cap.retrieve()
            if not ok or buf is None:
                continue
            off = tag == "off"
            f = ("o_%05d.jpg" % len(self.frames_off)) if off else ("f_%05d.jpg" % self.n)
            with open(os.path.join(self.outdir, f), "wb") as fh:
                fh.write(buf.tobytes())
            if off:
                self.frames_off.append((ts, f))
            else:
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
    camera.apply_exposure(dev, cap)         # only takes effect once streaming
    return cap


def run_continuous(fabmo, cap, outdir, axis, start, end, speed_ips, laser_out,
                   latency_ms=0.0, progress=None, abort=None, log=print, reverse=False,
                   on_live=None, colour=None, two_pass=False):
    """Laser-on constant-feed sweep of `axis` from origin+start to
    origin+end (inches). Returns the manifest. Laser off and the job
    stopped on error/abort; the head returns to the start only on success.
    two_pass: first make the same sweep with the laser off (reference
    frames), then the laser-on one."""
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
    if colour is None:
        import sweep
        colour = sweep.laser_colour()
    A = ax.upper()
    b0, b1 = (a1, a0) if reverse else (a0, a1)       # reverse: sweep end -> start
    feed = "G1 F%.2f %s%.4f" % (speed_ips * 60.0, A, b1)
    prog = "\n".join([
        "G90", "M100 ({%s:0})" % out,
        "G0 %s%.4f" % (A, b0)] + ([
        "G4 P0.8", feed,                           # laser-off pass, same start and feed
        "G0 %s%.4f" % (A, b0)] if two_pass else []) + [
        "M100 ({%s:1})" % out, "G4 P0.8",          # laser on; camera exposure settles
        "G1 F%.2f %s%.4f" % (speed_ips * 60.0, A, b1),
        "M100 ({%s:0})" % out,
        "G0 X%.4f Y%.4f" % (origin["x"], origin["y"]),
    ]) + "\n"
    dur = (a1 - a0) / speed_ips * (2 if two_pass else 1)
    log("continuous: %sorigin %s; %s %+.3f..%+.3f in at %.2f in/s (~%.0f s), laser out%d"
        % ("two-pass, " if two_pass else "", origin, A, start, end, speed_ips, dur, laser_out))
    man = {"kind": "continuous", "units": "inches", "origin": origin, "axis": ax,
           "reverse": bool(reverse), "two_pass": bool(two_pass),
           "start": start, "end": end, "speed_ips": speed_ips, "laser_output": laser_out,
           "laser_color": colour, "latency_ms": latency_ms, "created": time.strftime("%Y-%m-%d %H:%M:%S"),
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
                        est_lines=(end - start) / speed_ips * 6.5, colour=colour)
        live.start()
        on_live(live)
    t0 = time.time()
    started = False
    try:
        time.sleep(0.5)
        fabmo.start_gcode(prog)
        started = True
        # record while the laser is on and the head is in the sweep
        # The laser-off pass is followed by position (reach the start, leave
        # it, reach the end); the laser-on pass by the laser output, as before.
        phase = "off: to start" if two_pass else "to start"
        dirn = 1.0 if b1 > b0 else -1.0
        off_win = [None, None]             # monotonic times of the laser-off pass
        man["off_window"] = off_win
        while True:
            if abort is not None and abort.is_set():
                raise _Abort()
            s = st.last
            if s is not None:
                p = s["pos" + ax]
                on = s.get(out) == 1
                frac = max(0.0, min(1.0, abs(p - b0) / (a1 - a0)))
                if phase == "off: to start":
                    if abs(p - b0) < 0.01:
                        phase = "off: at start"
                elif phase == "off: at start":
                    if (p - b0) * dirn > 0.01:
                        fr.tag = "off"
                        off_win[0] = time.monotonic()
                        fr.record.set()
                        phase = "off: sweeping"
                elif phase == "off: sweeping":
                    if (b1 - p) * dirn < 0.01:
                        fr.record.clear()
                        off_win[1] = time.monotonic()
                        fr.tag = "on"
                        phase = "to start"
                    elif progress:
                        progress(int(frac * 50), 100)
                else:
                    if on and not fr.record.is_set():
                        fr.record.set()
                        phase = "sweeping"
                    if fr.record.is_set() and not on and time.time() - t0 > 2:
                        break                               # laser off: sweep done
                if s["state"] in ("idle", "stopped", "dead") and time.time() - t0 > 2:
                    if phase == "sweeping":
                        break
                    raise RuntimeError("job ended before the sweep (%s)" % s["state"])
                if progress and phase == "sweeping":
                    progress(int(50 + frac * 50) if two_pass else int(frac * 100), 100)
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
                if two_pass:
                    man["frames_off"] = [list(f) for f in fr.frames_off]
                man["duration_s"] = round(time.time() - t0, 1)
                _assign_poses(man, ax, a0, a1, latency_ms, log)
                with open(os.path.join(outdir, "manifest.json"), "w") as fh:
                    json.dump(man, fh)
    log("continuous: %d frames recorded%s, %d in range; %.0f s"
        % (len(man["frames"]),
           " (+ %d laser-off)" % len(man["frames_off"]) if two_pass else "",
           len(man["shots"]), man["duration_s"]))
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
                 workers=2, period=0.15, min_gap_in=0.015, est_lines=None, colour="red"):
        threading.Thread.__init__(self, daemon=True)
        self.colour = colour
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
                self.pool.apply_async(_tri, ((0, os.path.join(self.outdir, f), None, dp, None,
                                              self.colour),),
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


def _fit_rows(rows, k, lo, hi):
    """Straight line through (arrival time, position) of the reports inside
    lo..hi -> (speed, intercept, rms residual, n), or a string saying why not."""
    if len(rows) < 5:
        return "too few position reports (%d)" % len(rows)
    R = np.array([[r[0], r[k]] for r in rows], float)
    # first arrival of each new value only (repeats are stale reports)
    R = R[np.r_[True, np.diff(R[:, 1]) != 0]]
    seg = R[(R[:, 1] > lo) & (R[:, 1] < hi)]
    if len(seg) < 4:
        return "too few position reports in the sweep (%d)" % len(seg)
    A = np.c_[seg[:, 0], np.ones(len(seg))]
    (v, c), *_ = np.linalg.lstsq(A, seg[:, 1], rcond=None)
    res = seg[:, 1] - A @ np.array([v, c])
    return float(v), float(c), float(res.std()), int(len(seg))


def _assign_poses(man, ax, a0, a1, latency_ms, log=print):
    """Fit position(t) over the constant-feed part; give every frame inside
    the scan range a pose. Two-pass sweeps: also place the laser-off frames
    (their own fit) and give every shot its two nearest ones."""
    k = 1 + AXES.index(ax)
    man["fit"] = None
    if not man["frames"]:
        return
    o = man["origin"]
    # stay clear of the acceleration at both ends of the run-in
    lo = o[ax] + man["start"] - RUN_IN * 0.5
    hi = o[ax] + man["end"] + RUN_IN * 0.5
    # Only the constant-feed move: reports taken while the laser was on
    # (the rapids to the start and back home also cross the scan range —
    # fitting them gave 0.27 in/s for a 0.30 in/s move, 2026-11-08).
    fit = _fit_rows([r for r in man["status_log"] if len(r) > 4 and r[4] == 1], k, lo, hi)
    if isinstance(fit, str):
        log("continuous: laser-on pass, " + fit)
        return
    v, c, rms, n = fit
    man["fit"] = {"speed_ips": v, "rms_in": rms, "n": n}
    log("continuous: position fit %.4f in/s (commanded %.2f), residual %.4f in rms over %d reports"
        % (v, man["speed_ips"], rms, n))
    lat = latency_ms / 1000.0
    shots = []
    for ts, f in man["frames"]:
        p = v * (ts + lat) + c
        if o[ax] + man["start"] <= p <= o[ax] + man["end"]:
            pose = dict(o)
            pose[ax] = float(p)
            shots.append({"pose": pose, "img_on": f, "t": ts})
    man["shots"] = shots
    if not man.get("two_pass"):
        return
    # ---- laser-off pass
    man["fit_off"] = None
    w0, w1 = man.get("off_window") or (None, None)
    if w0 is None or w1 is None or not man.get("frames_off"):
        log("continuous: no laser-off pass recorded — processing without it")
        return
    fit = _fit_rows([r for r in man["status_log"] if w0 <= r[0] <= w1], k, lo, hi)
    if isinstance(fit, str):
        log("continuous: laser-off pass, %s — processing without it" % fit)
        return
    v2, c2, rms2, n2 = fit
    man["fit_off"] = {"speed_ips": v2, "rms_in": rms2, "n": n2}
    P = np.array([v2 * (ts + lat) + c2 for ts, _ in man["frames_off"]])
    F = [f for _, f in man["frames_off"]]
    keep = (P > lo) & (P < hi)
    order = np.argsort(P[keep])
    P = P[keep][order]
    F = [F[i] for i in np.flatnonzero(keep)[order]]
    if len(P) < 2 or not shots:
        log("continuous: too few laser-off frames in the sweep (%d)" % len(P))
        man["fit_off"] = None
        return
    gaps = []
    for sh in shots:
        p = sh["pose"][ax]
        j = int(np.searchsorted(P, p))
        ia, ib = max(0, j - 1), min(len(P) - 1, j)
        w = 0.0 if ib == ia else float(np.clip((p - P[ia]) / (P[ib] - P[ia]), 0.0, 1.0))
        sh["off_a"], sh["off_b"], sh["off_w"] = F[ia], F[ib], round(w, 3)
        gaps.append(min(abs(p - P[ia]), abs(p - P[ib])))
    man["off_pair"] = {"n_off": int(len(P)), "frame_step_in": float(np.median(np.diff(P))),
                       "gap_med_in": float(np.median(gaps)), "gap_max_in": float(np.max(gaps))}
    log("continuous: laser-off pass %.4f in/s, residual %.4f in rms over %d reports; %d frames, "
        "nearest one %.4f in from each laser-on frame (median; max %.4f)"
        % (v2, rms2, n2, len(P), np.median(gaps), np.max(gaps)))


# ------------------------------------------------------------- processing
_CAL = {}
BAND = [None]          # row band used by the last triangulate_frames (for logs)


def _off_image(off, r0, r1):
    """Laser-off reference for one frame: the two laser-off frames either
    side of its position, blended by distance (rows r0..r1)."""
    pa, pb, w = off
    a = cv2.imread(pa)
    if a is None:
        return None
    a = a[r0:r1]
    if pb != pa and w > 0.01:
        b = cv2.imread(pb)
        if b is not None:
            a = b[r0:r1] if w > 0.99 else cv2.addWeighted(a, 1.0 - w, b[r0:r1], w, 0)
    return np.ascontiguousarray(a)


def _tri(args):
    """Worker: one frame -> (index, (N, 4) points). A 7th element
    (off_a path, off_b path, weight) selects the off/on method."""
    import sweep
    i, path, R_cm, dp, band, colour = args[:6]
    off = args[6] if len(args) > 6 else None
    if "cal" not in _CAL:
        _CAL["cal"] = sweep.load_cal()
        cv2.setNumThreads(1)          # one process per core instead of oversubscribing
    cal = _CAL["cal"]
    img = cv2.imread(path)
    if img is None:
        return i, np.zeros((0, 4))
    r0, r1 = band if band else (0, img.shape[0])
    ref = _off_image(off, r0, r1) if off else None
    if ref is not None:
        pts = sweep._stripe_points(ref, np.ascontiguousarray(img[r0:r1]),
                                   stripe.default_signal(colour), colour)
    else:
        pts = stripe.extract_on_only(np.ascontiguousarray(img[r0:r1]), colour=colour)
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


def _band_rows(args):
    path, colour, off = args
    img = cv2.imread(path)
    if img is None:
        return None
    ref = _off_image(off, 0, img.shape[0]) if off else None
    if ref is not None:
        import sweep
        p = sweep._stripe_points(ref, img, stripe.default_signal(colour), colour)
    else:
        p = stripe.extract_on_only(img, colour=colour)
    if len(p) < 50:
        return None
    return np.percentile(p[:, 0], [5, 99])     # 5th: ignore sparse stray points


def _stripe_band(jobs, pool, n_sample=24, margin=120, min_rows=240, colour="red"):
    """Image rows the laser line occupies in this scan, from a full search on
    a sample of frames (+ margin; 120 px ~ 50 mm of extra height). Frame
    processing then touches only that band: with 4 workers the Pi is limited
    by memory bandwidth, not CPU. A feature taller than the band, seen only
    between sampled frames, would be lost (not mis-measured)."""
    some = jobs[::max(1, len(jobs) // n_sample)]
    rows = [r for r in pool.map(_band_rows, [(j[1], colour, j[4]) for j in some])
            if r is not None]
    if not rows:
        return None
    rows = np.array(rows)
    r0 = int(max(0, rows[:, 0].min() - margin))
    r1 = int(min(1080, rows[:, 1].max() + margin))
    if r1 - r0 < min_rows:
        mid = (r0 + r1) // 2
        r0, r1 = max(0, mid - min_rows // 2), min(1080, mid + min_rows // 2)
    return (r0, r1)


def triangulate_frames(capdir, shots, every=1, progress=None, workers=4, colour="red"):
    """-> list of (N, 4) per used frame, list of shot indices used."""
    from multiprocessing import Pool
    p0 = np.array([shots[0]["pose"][a] for a in AXES])
    jobs = []
    for i in range(0, len(shots), max(1, every)):
        s = shots[i]
        dp = (np.array([s["pose"][a] for a in AXES]) - p0) * IN_TO_MM
        off = None
        if s.get("off_a"):
            off = (os.path.join(capdir, s["off_a"]), os.path.join(capdir, s["off_b"]),
                   float(s.get("off_w", 0.0)))
        jobs.append((i, os.path.join(capdir, s["img_on"]), None, dp, off))
    out = {}
    with Pool(workers) as pool:
        band = _stripe_band(jobs, pool, colour=colour)
        BAND[0] = band
        jobs = [j[:4] + (band, colour, j[4]) for j in jobs]
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
    ap.add_argument("--two-pass", action="store_true",
                    help="laser-off pass first, then laser-on (off/on subtraction)")
    ap.add_argument("--line-step", type=float)
    a = ap.parse_args()
    st = scan_settings.load()
    here = os.path.dirname(os.path.abspath(__file__))
    outdir = os.path.join(here, "data", "scans", a.name)
    import camera
    camera.EXPOSURE_KIND[0] = "scan"
    cap = open_raw()
    try:
        man = run_continuous(fabmo, cap, outdir, a.axis, a.start, a.end,
                             a.speed or st["continuous_speed_ips"], int(st["laser_output"]),
                             float(st["continuous_latency_ms"]), reverse=a.reverse,
                             two_pass=a.two_pass or bool(st["continuous_two_pass"]))
    finally:
        cap.release()
    man["line_step_in"] = a.line_step or st["continuous_line_step_in"]
    with open(os.path.join(outdir, "manifest.json"), "w") as fh:
        json.dump(man, fh)
    t = time.time()
    sweep.process_dir(outdir)
    print("processed in %.0f s" % (time.time() - t))
