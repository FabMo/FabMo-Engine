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

    def __init__(self, outdir, total, signal=None, pan=None, colour="red"):
        import queue
        import threading
        self.pan = pan           # pan.Pan for multi-heading scans (else reference heading)
        self.pose0 = None
        self.outdir = outdir
        self.total = total
        self.signal = signal or stripe.default_signal(colour)
        self.cal = dict(load_cal(), colour=colour)
        self.q = queue.Queue()
        self.lock = threading.Lock()
        self.shots = []          # per-shot float32 (N, 3), provisional heights
        self.raw = {}            # img_off name -> (N, 4) triangulated, for process_dir
        self.z_ref = None
        self._raw = []           # raw z of early shots, for z_ref
        self.p0 = None
        self.errors = 0
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()

    def add(self, idx, pose, off, on, rec, on2=None):
        self.q.put((idx, pose, off, on, rec, on2))

    def _run(self):
        while True:
            item = self.q.get()
            if item is None:
                return
            idx, pose, off, on, rec, on2 = item
            hd = dict(on2=on2, ratio2=rec.get("exposure_ratio2"))
            try:
                cv2.imwrite(os.path.join(self.outdir, rec["img_off"]), off)
                cv2.imwrite(os.path.join(self.outdir, rec["img_on"]), on)
                if on2 is not None:
                    cv2.imwrite(os.path.join(self.outdir, rec["img_on2"]), on2)
                if self.p0 is None:
                    self.p0 = np.array([pose[a] for a in AXES])
                    self.pose0 = dict(pose)
                if self.pan is not None:
                    R, dp = self.pan.shot_transform(pose, self.pose0)
                    P4 = triangulate_shot(off, on, self.cal, dp, self.signal, R_cm=R, **hd)
                else:
                    dp = (np.array([pose[a] for a in AXES]) - self.p0) * IN_TO_MM
                    P4 = triangulate_shot(off, on, self.cal, dp, self.signal, **hd)
                self.raw[rec["img_off"]] = (tuple(self.p0), P4)
                P = P4[:, :3]
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

    def finish(self, timeout=None):
        """Wait for the queue to drain — the worker also WRITES the shot
        images, so process_dir must not start before this returns."""
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


def plan_stops(origin, axis, start, end, step, rows=1, row_spacing=0.0, row_start=0.0):
    """Stops for a (multi-row) sweep, machine inches, absolute.

    Each row steps `axis` from origin+start to origin+end; rows are offset
    along the OTHER axis (along the laser line) by row_start + k*row_spacing
    from the origin. Every row runs in the same direction (consistent
    approach — no backlash difference between rows).
    -> list of {"x", "y", "row"}
    """
    ax = axis.lower()
    if ax not in ("x", "y"):
        raise ValueError("axis must be x or y")
    if step <= 0 or end <= start:
        raise ValueError("need step > 0 and end > start")
    rows = int(rows)
    if rows < 1 or rows > 20:
        raise ValueError("rows must be 1..20")
    if rows > 1 and row_spacing <= 0:
        raise ValueError("row spacing must be > 0 for more than one row")
    other = "x" if ax == "y" else "y"
    n = int(round((end - start) / step)) + 1
    stops = []
    for r in range(rows):
        o = round(origin[other] + row_start + r * row_spacing, 4)
        for i in range(n):
            stops.append({ax: round(origin[ax] + start + step * i, 4), other: o, "row": r})
    if len(stops) > 3000:
        raise ValueError("%d stops is too many" % len(stops))
    return stops


def plan_headings(origin, headings, length, step, pan_model, table_below_cam_mm,
                  b_limit=95.0, ref_heading=0.0):
    """Stops for a multi-heading scan, machine inches/deg, absolute.

    Every heading's sweep walks the laser line across the SAME target: the
    point where the line meets the table at the start pose, with the head
    at ref_heading (0 on a motorised B axis; on a hand-indexed head, the
    detent it is in when the scan starts). At heading B the head moves
    along the line's normal d(B), from -length/2 to +length/2 (inches)
    about the position that puts the line on the target. Headings run in
    increasing B (each reached moving +B), except that ref_heading, if it
    is one of them, comes first (hand-indexed: no turn before the scan).
    -> list of {"x", "y", "b", "row": heading index}
    """
    with open(os.path.join(HERE, "laser.json")) as fh:
        las = json.load(fh)
    m, c = las["plane_normal_cam"], float(las["plane_offset_mm"])
    hs = sorted(set(float(h) for h in headings))
    hs.sort(key=lambda h: abs(h - ref_heading) > 0.01)      # stable: ref first
    if not hs or any(abs(h) > b_limit for h in hs):
        raise ValueError("headings must be within +-%.0f deg" % b_limit)
    if step <= 0 or length <= 0:
        raise ValueError("need positive length and step")
    n = int(round(length / step)) + 1
    target = pan_model.line_centre(ref_heading, m, c, table_below_cam_mm)   # mm, gantry-relative
    stops = []
    for k, b in enumerate(hs):
        d = pan_model.sweep_dir(b, m)
        base = (target - pan_model.line_centre(b, m, c, table_below_cam_mm)) / IN_TO_MM
        for i in range(n):
            s_ = -length / 2.0 + step * i
            stops.append({"x": round(origin["x"] + base[0] + s_ * d[0], 4),
                          "y": round(origin["y"] + base[1] + s_ * d[1], 4),
                          "b": b, "row": k})
    if len(stops) > 3000:
        raise ValueError("%d stops is too many" % len(stops))
    return stops


def run_capture_job(fabmo, cap, outdir, axis, start, end, step, laser_out,
                    progress=None, abort=None, log=print, live=None,
                    dwell_off=0.8, dwell_on=0.6, on_live=None,
                    rows=1, row_spacing=0.0, row_start=0.0, targets=None,
                    extra_manifest=None, pan_model=None, colour=None,
                    manual_pan=None, head_heading=0.0):
    """Like run_capture(), but the whole sweep runs as ONE gcode program
    (moves, dwells, laser on/off), so the machine stays 'running' for the
    whole scan — the dashboard's job bar stays up and its Stop/Pause work
    on the scan. Frames are taken inside the dwells: the daemon follows
    the program through the status report (position + laser output, 100 ms
    report interval) and checks after each grab that the machine was still
    in the same window.

    rows / row_spacing / row_start: several parallel sweeps offset along the
    other axis (inches) — see plan_stops(); all rows run in the same job and
    land in one manifest (poses carry X and Y, so they merge directly).
    cap: an open cv2.VideoCapture (drained by camera.LatestFrame here).
    On error/abort/Stop the job is stopped and the laser switched off; the
    head is NOT moved back (it stays where it stopped).
    on_live(live): called once with the Live object (for the daemon).

    colour: laser colour for the live preview and the manifest (default:
    the laser_color setting).

    manual_pan: set on a hand-indexed head (no B motor). A callable
    manual_pan(heading_deg) that returns once the operator has turned the
    head to that detent (raise Aborted to give up). The program is then
    split at every change of heading: the machine goes idle with the laser
    off, manual_pan() is awaited, and the next piece starts. B is neither
    commanded nor checked; shots record the detent as pose["b"].
    head_heading: the detent the head is in at the start.
    """
    import camera

    ax = axis.lower()
    s0 = fabmo.status()
    if s0["state"] != "idle":
        raise RuntimeError("machine is %s (must be idle)" % s0["state"])
    origin = fabmo.pose()
    if targets is None:
        targets = plan_stops(origin, ax, start, end, step, rows, row_spacing, row_start)
    elif callable(targets):
        targets = targets(origin)
    n = len(targets)
    fabmo.check_envelope([(t["x"], t["y"]) for t in targets])
    os.makedirs(outdir, exist_ok=True)
    out = "out%d" % laser_out
    if colour is None:
        colour = laser_colour()
    manual = manual_pan is not None
    # second, short exposure inside each laser-on window (see scan_settings)
    import scan_settings
    _st = scan_settings.load()
    exp1 = int(_st.get("camera_exposure_scan") or 0)
    exp2 = int(_st.get("camera_exposure_scan2") or 0)
    cam_dev = camera.find_device()
    hdr = bool(exp1 and 0 < exp2 < exp1 and cam_dev)
    if hdr:
        dwell_on += 0.6       # switch + ~0.3 s for the new exposure to show
        dwell_off += 0.2      # ... and for the long one to be back
    head = [0, ["G90", "M100 ({%s:0})" % out], None]
    segs = [head]        # [first stop, program lines, detent to turn to by hand first]
    lines = head[1]
    cur_b = float(head_heading) if manual else (origin.get("b") or 0.0)
    import pan as panmod
    for k, t in enumerate(targets):
        if "b" in t and abs(t["b"] - cur_b) > 0.01:
            if manual:
                if k == 0:
                    head[2] = t["b"]
                else:                    # machine idles here while the head is turned
                    lines.append("M100 ({%s:0})" % out)
                    lines = ["G90", "M100 ({%s:0})" % out]
                    segs.append([k, lines, t["b"]])
                lines.append("G0 X%.4f Y%.4f" % (t["x"], t["y"]))
            else:
                # new heading: final approach in +B (same as the calibration)
                for bb in panmod.approach_moves(cur_b, t["b"], fabmo.B_LIMIT)[:-1]:
                    lines.append("G0 B%.4f" % bb)
                lines.append("G0 X%.4f Y%.4f B%.4f" % (t["x"], t["y"], t["b"]))
            cur_b = t["b"]
        else:
            lines.append("G0 X%.4f Y%.4f" % (t["x"], t["y"]))
        lines += ["G4 P%.2f" % dwell_off,
                  "M100 ({%s:1})" % out, "G4 P%.2f" % dwell_on, "M100 ({%s:0})" % out]
    if any("b" in t for t in targets) and not manual:
        b_home = 0.0 if abs(origin.get("b") or 0) < 1 else origin["b"]
        for bb in panmod.approach_moves(cur_b, b_home, fabmo.B_LIMIT)[:-1]:
            lines.append("G0 B%.4f" % bb)
        lines.append("G0 X%.4f Y%.4f B%.4f" % (origin["x"], origin["y"], b_home))
    else:
        lines.append("G0 X%.4f Y%.4f" % (origin["x"], origin["y"]))
    lines.append("M100 ({%s:0})" % out)

    log("origin %s; %d stops (%d row%s) along %s from %+.3f to %+.3f in; %s laser out%d; "
        "%d job%s (%d lines)%s" % (origin, n, rows, "" if rows == 1 else "s", ax, start,
                                   end, colour, laser_out, len(segs),
                                   "" if len(segs) == 1 else "s",
                                   sum(len(sg[1]) for sg in segs),
                                   "; head turned by hand" if manual else ""))
    man = {"kind": "sweep", "mode": "job", "units": "inches", "origin": origin,
           "axis": ax, "start": start, "end": end, "step": step,
           "rows": rows, "row_spacing": row_spacing, "row_start": row_start,
           "laser_output": laser_out, "laser_color": colour,
           "dwell_off": dwell_off, "dwell_on": dwell_on,
           "exposure": exp1, "exposure2": exp2 if hdr else 0,
           "created": time.strftime("%Y-%m-%d %H:%M:%S"), "complete": False,
           "shots": []}
    if manual:
        man["manual_pan"] = True
    if extra_manifest:
        man.update(extra_manifest)
    if live is None:
        live = Live(outdir, n, pan=pan_model, colour=colour)
    if on_live:
        on_live(live)

    TOL = 0.003
    t0 = time.time()
    t_job = [t0]             # start of the program piece now running
    started = False
    stopped_by = None

    def at(s, t):
        return (abs(s["posx"] - t["x"]) <= TOL and abs(s["posy"] - t["y"]) <= TOL and
                (manual or "b" not in t or abs((s.get("posb") or 0) - t["b"]) <= 0.15))

    def where(s):
        return "X%.4f Y%.4f B%.2f" % (s["posx"], s["posy"], s.get("posb") or 0)

    def wait_for(cond, what, timeout):
        """Poll status until cond(s); raise if the job ends or abort."""
        deadline = time.time() + timeout
        while True:
            s = fabmo.status()
            if cond(s):
                return s
            if s["state"] in ("idle", "stopped", "dead") and time.time() - t_job[0] > 1.0:
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
            missed = []

            def miss(k, window, why):
                missed.append({"stop": k, "window": window, "why": why})
                log("  stop %d: missed (%s: %s) — skipped" % (k, window, why))
                if len(missed) > max(2, n // 10):
                    raise RuntimeError("missed %d frame windows — timing too tight "
                                       "(see scand log)" % len(missed))

            # A single slow /status reply (~1 s) can hide a whole 0.6 s laser
            # window; the machine keeps going regardless. So never wait for a
            # stop the machine has already passed: look a few stops ahead,
            # resync to where it actually is, and record the skipped ones
            # (2026-11-08: waiting for a passed stop aborted a sweep).
            LOOK = 10
            i, i_first, i_end, seg_k = 0, 0, 0, -1
            while i < n:
                if i >= i_end:
                    # next piece of the program (the only one, unless the head
                    # is turned by hand between headings)
                    if seg_k >= 0:
                        fabmo.wait_idle(timeout=60.0)
                    seg_k += 1
                    i_first, seg_lines, turn_to = segs[seg_k]
                    i = i_first
                    i_end = segs[seg_k + 1][0] if seg_k + 1 < len(segs) else n
                    if turn_to is not None:
                        log("  waiting for the head to be turned to %+g deg" % turn_to)
                        manual_pan(turn_to)
                        st = fabmo.status()["state"]
                        if st != "idle":
                            raise RuntimeError("machine is %s after the head was turned "
                                               "(must be idle)" % st)
                    fabmo.start_gcode("\n".join(seg_lines) + "\n")
                    started = True
                    t_job[0] = time.time()
                # the first stop is waited for exactly: before the job moves,
                # the head sits at its start position, which can coincide with
                # a later stop (start -0.5 in: stop 5 = the start position)
                ahead = (range(i, min(i_end, i + LOOK)) if i > i_first
                         else range(i_first, i_first + 1))
                ta = time.time()
                s = wait_for(lambda s: s.get(out) == 0 and any(at(s, targets[j]) for j in ahead),
                             "stop %d (X%.4f Y%.4f)" % (i, targets[i]["x"], targets[i]["y"]), 30.0)
                j = next(j for j in ahead if at(s, targets[j]))
                for k in range(i, j):
                    miss(k, "passed", "machine already at stop %d" % j)
                i = j
                t = targets[i]
                # --- laser-off window at stop i
                tb = time.time()
                time.sleep(0.4 if hdr else 0.2)     # settle + camera latency
                off = lf.read()
                tc = time.time()
                s = fabmo.status()
                td = time.time()
                if not (at(s, t) and s.get(out) == 0):
                    miss(i, "off", "%s out %s; verify %.2fs after detect"
                         % (where(s), s.get(out), td - tb))
                    i += 1
                    continue
                pose = {"x": s["posx"], "y": s["posy"], "z": s["posz"],
                        "a": s.get("posa"),
                        "b": t.get("b", float(head_heading)) if manual else s.get("posb")}
                # --- laser-on window: wait for it, or for the head to leave
                try:
                    s = wait_for(lambda s: (at(s, t) and s.get(out) == 1) or not at(s, t),
                                 "laser on at stop %d" % i, 5.0)
                except RuntimeError as e:
                    miss(i, "on-wait", str(e))
                    i += 1
                    continue
                if not (at(s, t) and s.get(out) == 1):
                    miss(i, "on-wait", "head left the stop before laser-on was seen (%s)"
                         % where(s))
                    i += 1
                    continue
                te = time.time()
                time.sleep(0.15)
                on = lf.read()
                on2 = None
                if hdr:
                    camera.write_exposure(cam_dev, exp2)
                    time.sleep(0.4)
                    on2 = lf.read()
                    camera.write_exposure(cam_dev, exp1)
                s = fabmo.status()
                tf = time.time()
                if not (at(s, t) and s.get(out) == 1):
                    miss(i, "on", "%s out %s; verify %.2fs after detect"
                         % (where(s), s.get(out), tf - te))
                    i += 1
                    continue
                rec = {"pose": pose, "row": t["row"],
                       "img_off": "off_%03d.jpg" % i, "img_on": "on_%03d.jpg" % i,
                       "timing": {"off_detect_to_verify": round(td - tb, 3),
                                  "off_grab": round(tc - tb, 3),
                                  "on_detect_to_verify": round(tf - te, 3),
                                  "stop_cycle": round(tf - ta, 3)}}
                if on2 is not None:
                    rec["img_on2"] = "on2_%03d.jpg" % i
                    rec["exposure_ratio2"] = round(exp2 / float(exp1), 4)
                man["shots"].append(rec)
                live.add(i, pose, off, on, rec, on2)
                if progress:
                    progress(i + 1, n)
                if i % 10 == 0 or i == n - 1:
                    log("  [%d/%d] row %d X%.4f Y%.4f B%.2f  %.0fs" % (
                        i + 1, n, t["row"], pose["x"], pose["y"], pose.get("b") or 0,
                        time.time() - t0))
                i += 1
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
                if hdr:
                    camera.write_exposure(cam_dev, exp1)
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

    camera.EXPOSURE_KIND[0] = "scan"
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


def laser_colour():
    """The laser_color setting ("red" / "blue")."""
    import scan_settings
    return scan_settings.load()["laser_color"]


def _stripe_points(off, on, signal, colour):
    pts = stripe.extract(off, on, orientation="horizontal", signal=signal,
                         min_signal=6.0, snr=3.5, colour=colour)
    pts = stripe.clean(pts, orientation="horizontal")
    # colour test rejects auto-exposure clutter, so the brightness cut can be
    # low enough to keep dim line on dark parts (black plastic)
    pts = stripe.drop_off_colour_runs(pts, off, on, orientation="horizontal", colour=colour)
    return stripe.drop_weak_runs(pts, orientation="horizontal", rel_signal=0.1)


def triangulate_shot(off, on, cal, dpose_mm, signal=None, R_cm=None, colour=None,
                     on2=None, ratio2=None):
    """-> (N, 4) [x, y, z, signal], mm, machine axes.
    colour: laser colour (default cal["colour"], else red).
    on2, ratio2: second laser-on frame at a shorter exposure and its exposure
    ratio to the main one (< 1); used where the main frame's line is clipped
    (stripe.merge_exposures). Its laser-off reference is the main off frame
    scaled by the ratio.
    R_cm: camera -> machine rotation of this shot (default: the reference
    heading's, mount.json); dpose_mm is then the full offset (pan.Pan
    .shot_transform gives both for a turned head)."""
    # low detection thresholds: the colour + run filters below remove what
    # they let through, and dim line on glossy black plastic needs them
    # (min 12 / snr 5 lost the far side of a black block's top, 2026-11-08)
    colour = colour or cal.get("colour") or "red"
    signal = signal or stripe.default_signal(colour)
    pts = _stripe_points(off, on, signal, colour)
    if on2 is not None:
        off2 = cv2.convertScaleAbs(off, alpha=float(ratio2 or 0.0))
        pts2 = _stripe_points(off2, on2, signal, colour)
        if len(pts2):
            pts2 = pts2.copy()
            pts2[:, 2] /= max(float(ratio2 or 1.0), 1e-3)     # comparable signal scale
        pts, _n = stripe.merge_exposures(pts, pts2, on, colour)
    if len(pts) == 0:
        return np.zeros((0, 4))
    u = cv2.undistortPoints(pts[:, [1, 0]].reshape(-1, 1, 2).astype(np.float64),
                            cal["K"], cal["D"]).reshape(-1, 2)
    r = np.c_[u, np.ones(len(u))]                       # camera rays
    X = r * (cal["c"] / (r @ cal["m"]))[:, None]        # on the laser sheet, camera frame
    if R_cm is None:
        P = X @ cal["R_mc"] + dpose_mm                  # R_mc^T X, machine axes, mm
    else:
        P = X @ R_cm.T + dpose_mm
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
    """Binary little-endian PLY (ASCII took ~4 s for a million points)."""
    with open(path, "wb") as fh:
        fh.write(("ply\nformat binary_little_endian 1.0\nelement vertex %d\n"
                  "property float x\nproperty float y\nproperty float z\nend_header\n"
                  % len(P)).encode())
        fh.write(np.ascontiguousarray(P[:, :3], dtype="<f4").tobytes())


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


def height_grid(P, cell, sweep_axis="y", max_gap_mm=4.0, agg="max"):
    """Max-height grid: (H, W) float32 (rows = Y, cols = X) with NaN holes,
    and its origin (mm). Gaps between successive stripes are bridged by
    linear interpolation along the sweep direction (up to max_gap_mm);
    larger holes (occlusion shadows) stay NaN."""
    lo = np.floor(P[:, :2].min(0) / cell) * cell
    ij = np.floor((P[:, :2] - lo) / cell).astype(int)
    W, H = ij.max(0) + 1
    grid = np.full((H, W), np.nan, np.float32)
    if agg == "median":
        # several headings see each cell, aligned to ~0.2-0.3 mm: the
        # median of the cell's points (max would pick the highest view)
        key = ij[:, 1] * W + ij[:, 0]
        order = np.lexsort((P[:, 2], key))
        k, z = key[order], P[order, 2]
        starts = np.r_[0, np.nonzero(np.diff(k))[0] + 1]
        counts = np.diff(np.r_[starts, len(k)])
        grid.ravel()[k[starts]] = z[starts + counts // 2]
    else:
        order = np.argsort(P[:, 2])                   # last write wins -> max
        grid[ij[order, 1], ij[order, 0]] = P[order, 2]
    gap = int(round(max_gap_mm / cell))
    if sweep_axis in ("y", "both"):
        for col in range(W):
            _fill_runs(grid[:, col], gap)
    if sweep_axis in ("x", "both"):
        for row in range(H):
            _fill_runs(grid[row, :], gap)
    # isolated single-cell holes across the stripe direction
    for row in range(H):
        _fill_runs(grid[row, :], 1)
    return grid, lo


def register_headings(P, hsid, shots, heading_of_shot, log=print):
    """Align every heading's points to the reference heading (B closest to
    0, whose pose is mount.json's) by surface registration; returns the
    merged points and a per-heading report."""
    import register
    bs = {}
    for s, h in zip(shots, heading_of_shot):
        bs.setdefault(int(h), s["pose"].get("b") or 0.0)
    ref_h = min(bs, key=lambda h: abs(bs[h]))
    out = [P[hsid == ref_h]]
    report = [{"heading": ref_h, "b": bs[ref_h], "reference": True,
               "n_points": int((hsid == ref_h).sum())}]
    for h in sorted(bs):
        if h == ref_h:
            continue
        Q = P[hsid == h]
        if len(Q) < 500:
            log("heading B%+.0f: only %d points, skipped" % (bs[h], len(Q)))
            continue
        try:
            R, t, info = register.align(out[0][:, :3], Q[:, :3])
        except RuntimeError as e:
            log("heading B%+.0f: not aligned (%s) — kept at the pan-model pose" % (bs[h], e))
            out.append(Q)
            report.append({"heading": h, "b": bs[h], "aligned": False, "error": str(e)})
            continue
        Q = Q.copy()
        Q[:, :3] = Q[:, :3] @ R.T + t
        out.append(Q)
        log("heading B%+.0f -> aligned: rms %.2f -> %.2f mm over %d pts, turn %.2f deg "
            "(yaw %+.2f), shift %s mm" % (bs[h], info["rms_before"], info["rms_after"],
                                          info["n_used"], info["rot_deg"], info["yaw_deg"],
                                          info["shift_mm"]))
        report.append(dict(info, heading=h, b=bs[h], aligned=True, n_points=len(Q)))
    return np.vstack(out), report


def _tri_pair(args):
    """Pool worker: one laser off/on pair -> (index, (N, 4))."""
    i, off_path, on_path, dp, signal, colour = args[:6]
    on2_path, ratio2 = args[6:8] if len(args) > 6 else (None, None)
    if "cal" not in _POOL_CAL:
        _POOL_CAL["cal"] = load_cal()
        cv2.setNumThreads(1)
    off, on = cv2.imread(off_path), cv2.imread(on_path)
    if off is None or on is None:
        return i, np.zeros((0, 4))
    on2 = cv2.imread(on2_path) if on2_path else None
    return i, triangulate_shot(off, on, _POOL_CAL["cal"], dp, signal, colour=colour,
                               on2=on2, ratio2=ratio2)


_POOL_CAL = {}


def process_dir(capdir, signal=None, log=print, progress=None, precomputed=None,
                patch_precomputed=None):
    """Triangulate a sweep capture directory. Returns the stats dict (also
    written to scan.json).

    precomputed: Live.raw from the capture — shots already triangulated
    during the scan are reused instead of being recomputed."""
    with open(os.path.join(capdir, "manifest.json")) as fh:
        man = json.load(fh)
    # captures from before the blue laser (Nov 2026) carry no colour: red
    colour = man.get("laser_color") or "red"
    cal = dict(load_cal(), colour=colour)
    auto_signal = stripe.default_signal(colour)      # what the live preview used
    signal = signal or auto_signal
    shots = man["shots"]
    if not shots:
        raise RuntimeError("no shots in %s" % capdir)
    p0 = np.array([shots[0]["pose"][a] for a in AXES])
    multi = man.get("kind") == "multi"
    pan_model = None
    if multi:
        import pan as panmod
        pan_model = panmod.Pan()
    allP, shot_ids = [], []
    reused = 0
    if man.get("kind") == "continuous":
        # laser-on frames only (continuous.py); decimate to ~line_step_in
        import continuous
        sp = np.array([s["pose"][man["axis"]] for s in shots])
        frame_step = float(np.median(np.abs(np.diff(sp)))) if len(sp) > 1 else 0.01
        want = float(man.get("line_step_in", 0.02))
        every = max(1, int(round(want / max(frame_step, 1e-6))))
        Ps, used = continuous.triangulate_frames(capdir, shots, every, progress,
                                                 colour=colour)
        allP = Ps
        shot_ids = [np.full(len(P_), i) for P_, i in zip(Ps, used)]
        man["step"] = frame_step * every          # for the neighbour-support filter
        log("continuous: %d frames, every %d used (line step %.4f in); image rows %s"
            % (len(shots), every, frame_step * every, continuous.BAND[0]))
        man["row_band"] = continuous.BAND[0]
        shots_iter = []
    else:
        shots_iter = shots
    for i, s in enumerate(shots_iter):
        pre = (precomputed or {}).get(s["img_off"])
        if pre is not None and signal == auto_signal and np.allclose(pre[0], p0):
            allP.append(pre[1])
            reused += 1
        else:
            off = cv2.imread(os.path.join(capdir, s["img_off"]))
            on = cv2.imread(os.path.join(capdir, s["img_on"]))
            on2 = cv2.imread(os.path.join(capdir, s["img_on2"])) if s.get("img_on2") else None
            hd = dict(on2=on2, ratio2=s.get("exposure_ratio2"))
            if multi:
                R, dp = pan_model.shot_transform(s["pose"], shots[0]["pose"])
                allP.append(triangulate_shot(off, on, cal, dp, signal, R_cm=R, **hd))
            else:
                dp = (np.array([s["pose"][a] for a in AXES]) - p0) * IN_TO_MM
                allP.append(triangulate_shot(off, on, cal, dp, signal, **hd))
        shot_ids.append(np.full(len(allP[-1]), i))
        if progress:
            progress(i + 1, len(shots))
    if reused:
        log("reused %d of %d shots triangulated during the scan" % (reused, len(shots)))
    # gap-fill patches (gaps.py): stop-and-go shots at absolute machine poses,
    # placed relative to this scan's first shot like its own shots
    next_id = max((int(x.max()) for x in shot_ids if len(x)), default=-1) + 1
    for pdir in man.get("patches", []):
        pd = os.path.join(capdir, pdir)
        try:
            with open(os.path.join(pd, "manifest.json")) as fh:
                pm = json.load(fh)
        except (IOError, ValueError):
            log("patch %s: no manifest, skipped" % pdir)
            continue
        n_before = len(allP)
        pre = (patch_precomputed or {}).get(pdir) or {}
        todo, reused_p = [], 0
        for ps in pm.get("shots", []):
            r = pre.get(ps["img_off"])
            if r is not None and signal == auto_signal:
                # live preview of the patch capture: points relative to the
                # patch's first shot -> shift to this scan's first shot
                P4 = r[1].copy()
                P4[:, :3] += (np.array(r[0]) - p0) * IN_TO_MM
                allP.append(P4)
                shot_ids.append(np.full(len(P4), next_id))
                next_id += 1
                reused_p += 1
            else:
                dp = (np.array([ps["pose"][a] for a in AXES]) - p0) * IN_TO_MM
                todo.append((len(todo), os.path.join(pd, ps["img_off"]),
                             os.path.join(pd, ps["img_on"]), dp, signal, colour,
                             os.path.join(pd, ps["img_on2"]) if ps.get("img_on2") else None,
                             ps.get("exposure_ratio2")))
        if todo:
            from multiprocessing import Pool
            with Pool(4) as pool:
                res = dict(pool.imap_unordered(_tri_pair, todo, chunksize=2))
            for k in range(len(todo)):
                allP.append(res[k])
                shot_ids.append(np.full(len(res[k]), next_id))
                next_id += 1
        log("patch %s: %d shots merged (%d reused from the capture)"
            % (pdir, len(allP) - n_before, reused_p))
    P = np.vstack(allP)
    sid = np.concatenate(shot_ids)
    rows_n = int(man.get("rows", 1) or 1)
    if rows_n > 1 and len(P):
        # Multi-row: rows overlap along the laser line. Keep each point only
        # if it is nearest to its OWN row's stripe centre, so overlaps are
        # split down the middle instead of stacking two slightly different
        # surfaces (calibration residuals make overlapping rows disagree by
        # up to ~1 mm at the frame edges).
        other = 0 if man.get("axis", "y") == "y" else 1        # row offset axis: 0 = X, 1 = Y
        row_of_shot = np.array([s.get("row", 0) for s in shots])
        cam = np.array([(s["pose"][AXES[other]] - p0[other]) * IN_TO_MM for s in shots])
        prow = row_of_shot[sid]
        c0 = np.median(P[:, other] - cam[sid])        # stripe centre vs camera position
        centres = np.array([np.median(cam[row_of_shot == r]) if (row_of_shot == r).any()
                            else np.nan for r in range(rows_n)]) + c0
        d = np.abs(P[:, other][:, None] - centres[None, :])
        d[:, np.isnan(centres)] = np.inf
        keep = np.argmin(d, axis=1) == prow
        log("multi-row: %d rows, kept %d of %d points nearest their own row"
            % (rows_n, keep.sum(), len(P)))
        P, sid = P[keep], sid[keep]
    n_raw = len(P)
    step_mm = abs(float(man.get("step", 0.1))) * IN_TO_MM
    registration = None
    if multi:
        heading_of_shot = np.array([s.get("row", 0) for s in shots])
        hsid = heading_of_shot[sid]
        keep = np.zeros(len(P), bool)
        for h in np.unique(hsid):                 # neighbour support within a heading
            m_ = hsid == h
            keep[np.nonzero(m_)[0][drop_unsupported(P[m_], sid[m_], step_mm)]] = True
        P, sid, hsid = P[keep], sid[keep], hsid[keep]
        log("%d shots -> %d points (%d unsupported dropped)" % (len(shots), len(P), n_raw - len(P)))
        P, registration = register_headings(P, hsid, shots, heading_of_shot, log)
    else:
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
        "laser_color": colour,
        "table": {"rms_mm": round(tab_rms, 3),
                  "tilt_x_deg": round(float(np.degrees(np.arctan(tab_co[0]))), 3),
                  "tilt_y_deg": round(float(np.degrees(np.arctan(tab_co[1]))), 3)},
        "registration": registration,
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
    grid, lo = height_grid(P, SURFACE_CELL_MM, "both" if multi else man.get("axis", "y"),
                           agg="median" if multi else "max")
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
    p.add_argument("--signal", default=None, choices=("r", "rg"),
                   help="stripe signal (see stripe.extract); default by laser colour")
    p.set_defaults(fn=process)
    t = sub.add_parser("stl", help="export the surface as a closed STL solid")
    t.add_argument("capdir")
    t.add_argument("--all", action="store_true", help="whole scan, not just the part")
    t.add_argument("--base", type=float, default=2.0, help="base thickness below table, mm")
    t.add_argument("--out")
    t.set_defaults(fn=stl)
    a = ap.parse_args()
    a.fn(a)
