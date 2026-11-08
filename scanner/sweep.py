"""Straight-line laser sweep + triangulation into machine coordinates.

Capture (moves ONE axis in steps from the start pose, laser off/on pair at
every stop; laser always switched off and the head returned to the start
position at the end):
  python3 sweep.py capture <name> --axis y --start -0.5 --end 5.5 --step 0.1
    offsets are relative to the current position, inches
    -> captures/<name>/ off_NNN.jpg, on_NNN.jpg, manifest.json
       (same shot format as orbit.py / laser_plane.py manifests)

Triangulate:
  python3 sweep.py process captures/<name>
    -> points.npy (N x 4: x y z signal), points.bin (float32 x y z, for the
       viewer), cloud.ply, surface.bin (float32 height grid), heightmap.png,
       scan.json (stats + grid geometry). All mm, machine axes, Z levelled
       to the table.

scand.py drives the same code through run_capture() / process_dir().

Geometry. The laser sheet is a fixed plane in the camera frame (laser.json:
m . X = c). A stripe pixel's ray r gives X_cam = r * c / (m . r). The
camera moves rigidly with the gantry (pan/B fixed), so with R_mc the
machine->camera rotation (mount.json) a point in machine axes is

    P = R_mc^T X_cam + 25.4 * (pose - pose_0)          [mm]

i.e. relative to the camera centre at the first shot. Absolute machine
coordinates would need the camera-to-tool offset, which isn't calibrated;
heights are reported relative to the table (lowest large flat level).
"""

import argparse
import json
import os
import time

import cv2
import numpy as np

import stripe

HERE = os.path.dirname(os.path.abspath(__file__))
IN_TO_MM = 25.4
AXES = ("x", "y", "z")
SURFACE_CELL_MM = 1.0


class Aborted(Exception):
    pass


# ---------------------------------------------------------------- capture
def run_capture(fabmo, grab, outdir, axis, start, end, step, laser_out,
                progress=None, abort=None, log=print):
    """Step `axis` from origin+start to origin+end (inches, relative to the
    current position), grabbing a laser off/on pair at each stop.

    grab()      -> BGR frame (must return a fresh frame)
    progress(done, total), abort: threading.Event-like (checked per stop)
    Always switches the laser off and returns the axis to its start
    position, also on abort/error; the manifest is written either way.
    Returns the manifest dict.
    """
    ax = axis.lower()
    if ax not in ("x", "y"):
        raise ValueError("axis must be x or y")
    if step <= 0 or end <= start:
        raise ValueError("need step > 0 and end > start")
    n = int(round((end - start) / step)) + 1
    if n > 2000:
        raise ValueError("%d stops is too many" % n)
    offs = start + step * np.arange(n)
    os.makedirs(outdir, exist_ok=True)

    origin = fabmo.pose()
    log("origin %s; %d stops along %s from %+.3f to %+.3f in; laser out%d"
        % (origin, n, ax, offs[0], offs[-1], laser_out))
    man = {"kind": "sweep", "units": "inches", "origin": origin, "axis": ax,
           "start": start, "end": end, "step": step, "laser_output": laser_out,
           "created": time.strftime("%Y-%m-%d %H:%M:%S"), "complete": False,
           "shots": []}
    t0 = time.time()
    try:
        fabmo.set_output(laser_out, 0)
        for i, o in enumerate(offs):
            if abort is not None and abort.is_set():
                raise Aborted()
            fabmo.goto(**{ax: origin[ax] + float(o)})
            time.sleep(0.3)
            pose = fabmo.pose()
            off = grab()
            fabmo.set_output(laser_out, 1)
            time.sleep(0.2)
            on = grab()
            fabmo.set_output(laser_out, 0)
            rec = {"pose": pose, "img_off": "off_%03d.jpg" % i, "img_on": "on_%03d.jpg" % i}
            cv2.imwrite(os.path.join(outdir, rec["img_off"]), off)
            cv2.imwrite(os.path.join(outdir, rec["img_on"]), on)
            man["shots"].append(rec)
            if progress:
                progress(i + 1, n)
            if i % 10 == 0 or i == n - 1:
                log("  [%d/%d] %s=%.4f  %.0fs" % (i + 1, n, ax, pose[ax], time.time() - t0))
        man["complete"] = True
    finally:
        try:
            fabmo.set_output(laser_out, 0)
        finally:
            try:
                fabmo.goto(**{ax: origin[ax]})
            finally:
                man["duration_s"] = round(time.time() - t0, 1)
                with open(os.path.join(outdir, "manifest.json"), "w") as fh:
                    json.dump(man, fh, indent=2)
    log("wrote %s/manifest.json (%d shots); laser off, %s back to %.4f"
        % (outdir, len(man["shots"]), ax, origin[ax]))
    return man


class Live:
    """Triangulates shots on a worker thread as they arrive (and writes
    their images), so a viewer can show the scan building up.

    Heights are provisional: relative to z_ref, the median height of the
    first shots' points (normally the bare table in front of the part).
    The final process_dir() re-levels to a fitted table plane.
    """

    def __init__(self, outdir, total, signal="rg"):
        import queue
        import threading
        self.outdir = outdir
        self.total = total
        self.signal = signal
        self.cal = load_cal()
        self.q = queue.Queue()
        self.lock = threading.Lock()
        self.shots = []          # per-shot float32 (N, 3), provisional heights
        self.z_ref = None
        self._raw = []           # raw z of early shots, for z_ref
        self.p0 = None
        self.errors = 0
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()

    def add(self, idx, pose, off, on, rec):
        self.q.put((idx, pose, off, on, rec))

    def _run(self):
        while True:
            item = self.q.get()
            if item is None:
                return
            idx, pose, off, on, rec = item
            try:
                cv2.imwrite(os.path.join(self.outdir, rec["img_off"]), off)
                cv2.imwrite(os.path.join(self.outdir, rec["img_on"]), on)
                if self.p0 is None:
                    self.p0 = np.array([pose[a] for a in AXES])
                dp = (np.array([pose[a] for a in AXES]) - self.p0) * IN_TO_MM
                P = triangulate_shot(off, on, self.cal, dp, self.signal)[:, :3]
                if self.z_ref is None:
                    if len(P):
                        self._raw.append(P[:, 2])
                    if len(self._raw) >= 3 or idx >= 5:
                        allz = np.concatenate(self._raw) if self._raw else np.zeros(1)
                        self.z_ref = float(np.median(allz))
                        with self.lock:        # re-reference what's already in
                            for s in self.shots:
                                s[:, 2] -= self.z_ref
                if self.z_ref is not None:
                    P = P.copy()
                    P[:, 2] -= self.z_ref
                with self.lock:
                    self.shots.append(P.astype(np.float32))
            except Exception:
                self.errors += 1
                with self.lock:
                    self.shots.append(np.zeros((0, 3), np.float32))

    def finish(self, timeout=60.0):
        self.q.put(None)
        self.thread.join(timeout=timeout)

    def snapshot(self, from_shot=0):
        """(points float32 (N,3) for shots >= from_shot, shots_done)."""
        with self.lock:
            done = len(self.shots)
            if self.z_ref is None:          # don't hand out unreferenced heights yet
                return np.zeros((0, 3), np.float32), 0
            parts = self.shots[from_shot:done]
        P = np.vstack(parts) if parts else np.zeros((0, 3), np.float32)
        return P, done

    def info(self):
        with self.lock:
            done = len(self.shots) if self.z_ref is not None else 0
            n = sum(len(s) for s in self.shots[:done])
        return {"shots_done": done, "total": self.total, "n_points": n}


def run_capture_job(fabmo, cap, outdir, axis, start, end, step, laser_out,
                    progress=None, abort=None, log=print, live=None,
                    dwell_off=0.8, dwell_on=0.6, on_live=None):
    """Like run_capture(), but the whole sweep runs as ONE gcode program
    (moves, dwells, laser on/off), so the machine stays 'running' for the
    whole scan — the dashboard's job bar stays up and its Stop/Pause work
    on the scan. Frames are taken inside the dwells: the daemon follows
    the program through the status report (position + laser output, 100 ms
    report interval) and checks after each grab that the machine was still
    in the same window.

    cap: an open cv2.VideoCapture (drained by camera.LatestFrame here).
    On error/abort/Stop the job is stopped and the laser switched off; the
    head is NOT moved back (it stays where it stopped).
    on_live(live): called once with the Live object (for the daemon).
    """
    import camera

    ax = axis.lower()
    if ax not in ("x", "y"):
        raise ValueError("axis must be x or y")
    if step <= 0 or end <= start:
        raise ValueError("need step > 0 and end > start")
    n = int(round((end - start) / step)) + 1
    if n > 2000:
        raise ValueError("%d stops is too many" % n)
    os.makedirs(outdir, exist_ok=True)

    s0 = fabmo.status()
    if s0["state"] != "idle":
        raise RuntimeError("machine is %s (must be idle)" % s0["state"])
    origin = fabmo.pose()
    targets = [round(origin[ax] + start + step * i, 4) for i in range(n)]
    A, key = ax.upper(), "pos" + ax
    out = "out%d" % laser_out
    lines = ["G90", "M100 ({%s:0})" % out]
    for t in targets:
        lines += ["G0 %s%.4f" % (A, t), "G4 P%.2f" % dwell_off,
                  "M100 ({%s:1})" % out, "G4 P%.2f" % dwell_on, "M100 ({%s:0})" % out]
    lines += ["G0 %s%.4f" % (A, origin[ax]), "M100 ({%s:0})" % out]
    prog = "\n".join(lines) + "\n"

    log("origin %s; %d stops along %s from %+.3f to %+.3f in; laser out%d; "
        "single job (%d lines)" % (origin, n, ax, start, end, laser_out, len(lines)))
    man = {"kind": "sweep", "mode": "job", "units": "inches", "origin": origin,
           "axis": ax, "start": start, "end": end, "step": step,
           "laser_output": laser_out, "dwell_off": dwell_off, "dwell_on": dwell_on,
           "created": time.strftime("%Y-%m-%d %H:%M:%S"), "complete": False,
           "shots": []}
    if live is None:
        live = Live(outdir, n)
    if on_live:
        on_live(live)

    TOL = 0.003
    t0 = time.time()
    started = False
    stopped_by = None

    def at(s, t):
        return abs(s[key] - t) <= TOL

    def wait_for(cond, what, timeout):
        """Poll status until cond(s); raise if the job ends or abort."""
        deadline = time.time() + timeout
        while True:
            s = fabmo.status()
            if cond(s):
                return s
            if s["state"] in ("idle", "stopped", "dead") and time.time() - t0 > 1.0:
                raise _JobEnded(s["state"])
            if abort is not None and abort.is_set():
                raise Aborted()
            if s["state"] == "paused":               # paused from the dashboard:
                deadline = time.time() + timeout      # don't time out meanwhile
            if time.time() > deadline:
                raise RuntimeError("timed out waiting for %s" % what)
            time.sleep(0.03)

    try:
        with camera.LatestFrame(cap) as lf:
            fabmo.start_gcode(prog)
            started = True
            missed = []
            for i, t in enumerate(targets):
                # --- laser-off window at stop i
                ta = time.time()
                wait_for(lambda s: at(s, t) and s.get(out) == 0,
                         "stop %d (%s=%.4f)" % (i, A, t), 15.0)
                tb = time.time()
                time.sleep(0.2)                     # settle + camera latency
                off = lf.read()
                tc = time.time()
                s = fabmo.status()
                td = time.time()
                if not (at(s, t) and s.get(out) == 0):
                    why = "pos %.4f out %s" % (s[key], s.get(out))
                    log("  stop %d: missed laser-off window (%s; detect %.2fs after "
                        "previous, verify %.2fs after detect)" % (i, why, tb - ta, td - tb))
                    missed.append({"stop": i, "window": "off", "why": why})
                    if len(missed) > max(2, n // 10):
                        raise RuntimeError("missed %d frame windows — timing too tight "
                                           "(see scand log)" % len(missed))
                    continue                        # skip this stop; next target
                pose = {"x": s["posx"], "y": s["posy"], "z": s["posz"],
                        "a": s.get("posa"), "b": s.get("posb")}
                # --- laser-on window
                wait_for(lambda s: at(s, t) and s.get(out) == 1,
                         "laser on at stop %d" % i, 5.0)
                te = time.time()
                time.sleep(0.15)
                on = lf.read()
                s = fabmo.status()
                tf = time.time()
                if not (at(s, t) and s.get(out) == 1):
                    why = "pos %.4f out %s" % (s[key], s.get(out))
                    log("  stop %d: missed laser-on window (%s; verify %.2fs after "
                        "detect)" % (i, why, tf - te))
                    missed.append({"stop": i, "window": "on", "why": why})
                    if len(missed) > max(2, n // 10):
                        raise RuntimeError("missed %d frame windows — timing too tight "
                                           "(see scand log)" % len(missed))
                    continue
                rec = {"pose": pose, "img_off": "off_%03d.jpg" % i, "img_on": "on_%03d.jpg" % i,
                       "timing": {"off_detect_to_verify": round(td - tb, 3),
                                  "off_grab": round(tc - tb, 3),
                                  "on_detect_to_verify": round(tf - te, 3),
                                  "stop_cycle": round(tf - ta, 3)}}
                man["shots"].append(rec)
                live.add(i, pose, off, on, rec)
                if progress:
                    progress(i + 1, n)
                if i % 10 == 0 or i == n - 1:
                    log("  [%d/%d] %s=%.4f  %.0fs" % (i + 1, n, ax, pose[ax], time.time() - t0))
            fabmo.wait_idle(timeout=60.0)             # program returns to origin
            man["complete"] = True
            man["missed"] = missed
    except _JobEnded as e:
        stopped_by = "machine went %s (stopped from the dashboard?)" % e.state
        log("sweep: " + stopped_by)
        raise Aborted()
    finally:
        try:
            if started and not man["complete"]:
                # A /quit during a running gcode job can leave the engine
                # reporting 'running' after motion has ended (seen 2026-11-08,
                # quit sent during a G4 dwell); a second quit clears it —
                # the same as pressing Stop again in the dashboard.
                for attempt in range(3):
                    if fabmo.status()["state"] == "idle":
                        break
                    fabmo.quit()
                    try:
                        fabmo.wait_idle(timeout=5.0)
                        break
                    except RuntimeError:
                        log("sweep: engine still not idle after stop #%d" % (attempt + 1))
                fabmo.wait_idle(timeout=10.0)
        finally:
            try:
                fabmo.set_output(laser_out, 0)
            finally:
                live.finish()
                man["duration_s"] = round(time.time() - t0, 1)
                if stopped_by:
                    man["stopped"] = stopped_by
                with open(os.path.join(outdir, "manifest.json"), "w") as fh:
                    json.dump(man, fh, indent=2)
    log("wrote %s/manifest.json (%d shots, %.0f s)"
        % (outdir, len(man["shots"]), man["duration_s"]))
    return man


class _JobEnded(Exception):
    def __init__(self, state):
        Exception.__init__(self, state)
        self.state = state


def capture(args):
    import camera
    import fabmo_client as fabmo
    import scan_settings

    cap = camera.open_camera()
    time.sleep(1.0)
    outdir = os.path.join("captures", args.name)
    laser = int(scan_settings.load()["laser_output"])
    log = lambda s: print(s, flush=True)
    if args.mode == "job":
        run_capture_job(fabmo, cap, outdir, args.axis, args.start, args.end,
                        args.step, laser, log=log)
    else:
        run_capture(fabmo, lambda: camera.grab(cap, flush=8), outdir, args.axis,
                    args.start, args.end, args.step, laser, log=log)


# ------------------------------------------------------------ triangulate
def load_cal():
    def rd(name):
        with open(os.path.join(HERE, name)) as fh:
            return json.load(fh)
    cam, mount, las = rd("camera.json"), rd("mount.json"), rd("laser.json")
    return {"K": np.array(cam["camera_matrix"]), "D": np.array(cam["dist_coeffs"]),
            "R_mc": np.array(mount["R_machine_to_camera"]),
            "m": np.array(las["plane_normal_cam"]), "c": float(las["plane_offset_mm"])}


def triangulate_shot(off, on, cal, dpose_mm, signal="rg"):
    """-> (N, 4) [x, y, z, signal], mm, machine axes."""
    pts = stripe.extract(off, on, orientation="horizontal", signal=signal)
    pts = stripe.clean(pts, orientation="horizontal")
    pts = stripe.drop_weak_runs(pts, orientation="horizontal")
    if len(pts) == 0:
        return np.zeros((0, 4))
    u = cv2.undistortPoints(pts[:, [1, 0]].reshape(-1, 1, 2).astype(np.float64),
                            cal["K"], cal["D"]).reshape(-1, 2)
    r = np.c_[u, np.ones(len(u))]                       # camera rays
    X = r * (cal["c"] / (r @ cal["m"]))[:, None]        # on the laser sheet, camera frame
    P = X @ cal["R_mc"] + dpose_mm                      # R_mc^T X, machine axes, mm
    return np.c_[P, pts[:, 2]]


def plane_z(Q, iters=4):
    """Robust fit z = a x + b y + c. Returns ((a, b, c), rms of inliers)."""
    A = np.c_[Q[:, 0], Q[:, 1], np.ones(len(Q))]
    keep = np.ones(len(Q), bool)
    for _ in range(iters):
        co = np.linalg.lstsq(A[keep], Q[keep, 2], rcond=None)[0]
        r = Q[:, 2] - A @ co
        keep = np.abs(r) < 3 * max(r[keep].std(), 0.05)
    return co, float(r[keep].std())


def _neighbourhood_counts(key3, dims):
    """For integer voxel coords key3 (N,3, >= 1, < dims-1), number of points
    in each point's 3x3x3 voxel neighbourhood (itself included)."""
    key = (key3[:, 0] * dims[1] + key3[:, 1]) * dims[2] + key3[:, 2]
    uk, cnt = np.unique(key, return_counts=True)
    total = np.zeros(len(key), np.int64)
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for dz in (-1, 0, 1):
                k = key + (dx * dims[1] + dy) * dims[2] + dz
                i = np.searchsorted(uk, k)
                i[i >= len(uk)] = 0
                total += np.where(uk[i] == k, cnt[i], 0)
    return total


def drop_unsupported(P, shot, step_mm, min_support=3, vz=2.0):
    """Keep points that OTHER shots confirm: at least min_support points
    from different shots in the 3x3x3 voxel neighbourhood (XY voxel sized
    to the sweep step, Z voxel vz mm). A real surface is crossed by
    neighbouring stripes; a reflection or speck shows up in one shot only
    (e.g. a glint off a chip on the table triangulated 105 mm up)."""
    vxy = max(2.0, 1.2 * step_mm)
    v = np.floor(P[:, :3] / np.array([vxy, vxy, vz])).astype(np.int64)
    v -= v.min(0) - 1
    dims = v.max(0) + 2
    all_n = _neighbourhood_counts(v, dims)
    # same-shot counts: separate the shots along X by a gap > 1 voxel
    vs = v.copy()
    vs[:, 0] += shot.astype(np.int64) * (dims[0] + 2)
    dims_s = dims.copy()
    dims_s[0] = vs[:, 0].max() + 2
    same_n = _neighbourhood_counts(vs, dims_s)
    return (all_n - same_n) >= min_support


def write_ply(path, P):
    with open(path, "w") as fh:
        fh.write("ply\nformat ascii 1.0\nelement vertex %d\n"
                 "property float x\nproperty float y\nproperty float z\nend_header\n" % len(P))
        np.savetxt(fh, P[:, :3], fmt="%.3f")


def _fill_runs(line, max_gap):
    """Linearly interpolate NaN runs of length <= max_gap that have valid
    values on both sides (in place)."""
    ok = ~np.isnan(line)
    idx = np.nonzero(ok)[0]
    if len(idx) < 2:
        return
    gaps = np.diff(idx)
    for k in np.nonzero((gaps > 1) & (gaps <= max_gap + 1))[0]:
        a, b = idx[k], idx[k + 1]
        line[a + 1:b] = np.interp(np.arange(a + 1, b), [a, b], [line[a], line[b]])


def height_grid(P, cell, sweep_axis="y", max_gap_mm=4.0):
    """Max-height grid: (H, W) float32 (rows = Y, cols = X) with NaN holes,
    and its origin (mm). Gaps between successive stripes are bridged by
    linear interpolation along the sweep direction (up to max_gap_mm);
    larger holes (occlusion shadows) stay NaN."""
    lo = np.floor(P[:, :2].min(0) / cell) * cell
    ij = np.floor((P[:, :2] - lo) / cell).astype(int)
    W, H = ij.max(0) + 1
    grid = np.full((H, W), np.nan, np.float32)
    order = np.argsort(P[:, 2])                       # last write wins -> max
    grid[ij[order, 1], ij[order, 0]] = P[order, 2]
    gap = int(round(max_gap_mm / cell))
    if sweep_axis == "y":
        for col in range(W):
            _fill_runs(grid[:, col], gap)
    else:
        for row in range(H):
            _fill_runs(grid[row, :], gap)
    # isolated single-cell holes across the stripe direction
    for row in range(H):
        _fill_runs(grid[row, :], 1)
    return grid, lo


def process_dir(capdir, signal="rg", log=print, progress=None):
    """Triangulate a sweep capture directory. Returns the stats dict (also
    written to scan.json)."""
    cal = load_cal()
    with open(os.path.join(capdir, "manifest.json")) as fh:
        man = json.load(fh)
    shots = man["shots"]
    if not shots:
        raise RuntimeError("no shots in %s" % capdir)
    p0 = np.array([shots[0]["pose"][a] for a in AXES])
    allP, shot_ids = [], []
    for i, s in enumerate(shots):
        off = cv2.imread(os.path.join(capdir, s["img_off"]))
        on = cv2.imread(os.path.join(capdir, s["img_on"]))
        dp = (np.array([s["pose"][a] for a in AXES]) - p0) * IN_TO_MM
        allP.append(triangulate_shot(off, on, cal, dp, signal))
        shot_ids.append(np.full(len(allP[-1]), i))
        if progress:
            progress(i + 1, len(shots))
    P = np.vstack(allP)
    sid = np.concatenate(shot_ids)
    n_raw = len(P)
    step_mm = abs(float(man.get("step", 0.1))) * IN_TO_MM
    keep = drop_unsupported(P, sid, step_mm)
    P = P[keep]
    log("%d shots -> %d points (%d unsupported by neighbouring shots dropped)"
        % (len(shots), len(P), n_raw - len(P)))
    if len(P) < 100:
        raise RuntimeError("only %d stripe points found" % len(P))

    # Flat levels = histogram peaks holding >= 5% of the points. The table
    # is the LOWEST such level (a large part's top can outnumber the table).
    z = P[:, 2]
    hist, edges = np.histogram(z, bins=np.arange(z.min(), z.max() + 1.0, 1.0))
    big = np.nonzero(hist >= 0.05 * len(z))[0]
    zt = edges[big[0] if len(big) else np.argmax(hist)] + 0.5
    zt = np.median(z[np.abs(z - zt) < 2.0])
    tab_co, tab_rms = plane_z(P[np.abs(z - zt) < 2.0])
    P[:, 2] -= P[:, 0] * tab_co[0] + P[:, 1] * tab_co[1] + tab_co[2]   # level to the table
    stats = {
        "n_shots": len(shots), "n_points": int(len(P)), "signal": signal,
        "table": {"rms_mm": round(tab_rms, 3),
                  "tilt_x_deg": round(float(np.degrees(np.arctan(tab_co[0]))), 3),
                  "tilt_y_deg": round(float(np.degrees(np.arctan(tab_co[1]))), 3)},
        "bounds_mm": {"min": np.round(P[:, :3].min(0), 2).tolist(),
                      "max": np.round(P[:, :3].max(0), 2).tolist()},
        "top": None,
    }
    log("table: plane rms %.3f mm, tilt %.2f deg in X, %.2f deg in Y (levelled out)"
        % (tab_rms, stats["table"]["tilt_x_deg"], stats["table"]["tilt_y_deg"]))

    # top: the most populated level clearly above the table
    hi = P[P[:, 2] > 5.0]
    if len(hi) > 100:
        zh = hi[:, 2]
        hh, he = np.histogram(zh, bins=np.arange(zh.min(), zh.max() + 1.0, 1.0))
        top = he[np.argmax(hh)] + 0.5
        top = np.median(zh[np.abs(zh - top) < 2.0])
        topP = hi[np.abs(zh - top) < 2.0]
        co, rms = plane_z(topP)
        topP = topP[np.abs(topP[:, 2] - (topP[:, :2] @ co[:2] + co[2])) < 3 * rms]
        h = float(np.median(topP[:, 2]))
        ext = {}
        for lab, k in (("x", 0), ("y", 1)):
            lo, hi_ = np.percentile(topP[:, k], [0.5, 99.5])
            ext[lab] = [round(float(lo), 2), round(float(hi_), 2)]
        stats["top"] = {"height_mm": round(h, 3), "n_points": int(len(topP)),
                        "rms_mm": round(rms, 3),
                        "tilt_x_deg": round(float(np.degrees(np.arctan(co[0]))), 3),
                        "tilt_y_deg": round(float(np.degrees(np.arctan(co[1]))), 3),
                        "extent_mm": ext}
        log("top:   %d pts, height %.2f mm (%.4f in), plane rms %.3f mm, tilt %.2f / %.2f deg"
            % (len(topP), h, h / IN_TO_MM, rms, stats["top"]["tilt_x_deg"],
               stats["top"]["tilt_y_deg"]))
        for lab in ("x", "y"):
            lo, hi_ = ext[lab]
            log("  top extent %s: %.1f .. %.1f mm  -> %.1f mm (%.3f in)"
                % (lab.upper(), lo, hi_, hi_ - lo, (hi_ - lo) / IN_TO_MM))

    # outputs
    np.save(os.path.join(capdir, "points.npy"), P)
    P[:, :3].astype("<f4").tofile(os.path.join(capdir, "points.bin"))
    write_ply(os.path.join(capdir, "cloud.ply"), P)
    grid, lo = height_grid(P, SURFACE_CELL_MM, man.get("axis", "y"))
    grid.astype("<f4").tofile(os.path.join(capdir, "surface.bin"))
    stats["surface"] = {"cell_mm": SURFACE_CELL_MM, "origin_mm": lo.tolist(),
                        "width": int(grid.shape[1]), "height": int(grid.shape[0])}
    v = np.nan_to_num((grid - np.nanmin(grid)) /
                      max(float(np.nanmax(grid) - np.nanmin(grid)), 1e-6) * 255)
    img = cv2.applyColorMap(v.astype(np.uint8), cv2.COLORMAP_JET)
    img[np.isnan(grid)] = 0
    cv2.imwrite(os.path.join(capdir, "heightmap.png"), cv2.flip(img, 0))   # +Y up
    stats["processed"] = time.strftime("%Y-%m-%d %H:%M:%S")
    with open(os.path.join(capdir, "scan.json"), "w") as fh:
        json.dump(stats, fh, indent=2)
    log("wrote points.bin, surface.bin, cloud.ply, heightmap.png, scan.json in %s" % capdir)
    return stats


def surface_stl(capdir, crop="part", base_mm=2.0, margin_mm=5.0, part_min_mm=3.0):
    """Binary STL (bytes) of the scan's height surface as a closed solid:
    the surface on top, vertical walls around the edge, and a flat bottom
    base_mm below the table (z = 0 is the table). mm, machine X/Y axes.

    crop="part": only the area where the surface rises more than
    part_min_mm above the table, plus margin_mm; "all": the whole grid.
    Cells with no data (laser shadows, gaps) are filled at table level so
    the solid is watertight.
    """
    with open(os.path.join(capdir, "scan.json")) as fh:
        meta = json.load(fh)["surface"]
    H, W, cell = meta["height"], meta["width"], meta["cell_mm"]
    g = np.fromfile(os.path.join(capdir, "surface.bin"), "<f4").reshape(H, W)
    g = np.where(np.isfinite(g), g, 0.0).astype(np.float64)
    r0, r1, c0, c1 = 0, H, 0, W
    if crop == "part":
        rr, cc = np.nonzero(g > part_min_mm)
        if len(rr):
            m = int(np.ceil(margin_mm / cell))
            r0, r1 = max(0, rr.min() - m), min(H, rr.max() + m + 1)
            c0, c1 = max(0, cc.min() - m), min(W, cc.max() + m + 1)
    g = g[r0:r1, c0:c1]
    H, W = g.shape
    if H < 2 or W < 2:
        raise RuntimeError("surface too small to export")
    ox = meta["origin_mm"][0] + (c0 + 0.5) * cell
    oy = meta["origin_mm"][1] + (r0 + 0.5) * cell
    zb = min(0.0, float(g.min())) - base_mm

    xs = ox + cell * np.arange(W)
    ys = oy + cell * np.arange(H)
    X, Y = np.meshgrid(xs, ys)                         # (H, W), rows = Y
    top = np.stack([X, Y, g], -1).reshape(-1, 3)
    idx = np.arange(H * W).reshape(H, W)
    a, b = idx[:-1, :-1].ravel(), idx[:-1, 1:].ravel()
    d, e = idx[1:, :-1].ravel(), idx[1:, 1:].ravel()
    tris = [np.stack([top[a], top[b], top[e]], 1),      # normals +Z
            np.stack([top[a], top[e], top[d]], 1)]

    # boundary loop, counter-clockwise seen from above
    loop = np.r_[idx[0, :], idx[1:, -1], idx[-1, -2::-1], idx[-2:0:-1, 0]]
    p, q = top[loop], top[np.roll(loop, -1)]
    pb, qb = p.copy(), q.copy()
    pb[:, 2] = zb
    qb[:, 2] = zb
    tris += [np.stack([p, pb, qb], 1), np.stack([p, qb, q], 1)]   # walls, outward
    ctr = np.array([xs.mean(), ys.mean(), zb])
    tris.append(np.stack([np.broadcast_to(ctr, pb.shape), qb, pb], 1))  # bottom, -Z

    T = np.concatenate(tris).astype(np.float32)        # (N, 3 vertices, 3)
    n = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0])
    n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
    rec = np.zeros(len(T), dtype=[("n", "<f4", 3), ("v", "<f4", (3, 3)), ("attr", "<u2")])
    rec["n"], rec["v"] = n, T
    header = ("scanner surface %s crop=%s base=%.1fmm" % (
        os.path.basename(os.path.normpath(capdir)), crop, base_mm)).encode()[:80].ljust(80, b" ")
    return header + np.uint32(len(T)).tobytes() + rec.tobytes()


def process(args):
    process_dir(args.capdir, args.signal)


def stl(args):
    data = surface_stl(args.capdir, "all" if args.all else "part", args.base)
    out = args.out or os.path.join(args.capdir, "surface.stl")
    with open(out, "wb") as fh:
        fh.write(data)
    print("wrote %s (%d triangles)" % (out, (len(data) - 84) // 50))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("capture")
    c.add_argument("name")
    c.add_argument("--axis", default="y")
    c.add_argument("--start", type=float, default=-0.5)
    c.add_argument("--end", type=float, default=5.5)
    c.add_argument("--step", type=float, default=0.1)
    c.add_argument("--mode", default="job", choices=("job", "steps"),
                   help="job: one gcode program for the whole sweep (default); "
                        "steps: one /code call per move/output (older)")
    c.set_defaults(fn=capture)
    p = sub.add_parser("process")
    p.add_argument("capdir")
    p.add_argument("--signal", default="rg", choices=("r", "rg"),
                   help="stripe signal (see stripe.extract); rg copes with clipped red")
    p.set_defaults(fn=process)
    t = sub.add_parser("stl", help="export the surface as a closed STL solid")
    t.add_argument("capdir")
    t.add_argument("--all", action="store_true", help="whole scan, not just the part")
    t.add_argument("--base", type=float, default=2.0, help="base thickness below table, mm")
    t.add_argument("--out")
    t.set_defaults(fn=stl)
    a = ap.parse_args()
    a.fn(a)
