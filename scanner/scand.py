"""scand — scanner daemon: HTTP/JSON API over the scan building blocks.

Owns the camera, the laser output, and machine motion (via the engine's
POST /code), and runs long operations on a worker thread so the
dashboard app can poll progress and abort. Serves mosaics / overlays /
scan sessions out of data/ as plain files.

Run:  python3 scand.py [--port 3150]

API (all JSON; CORS open so the dashboard app can call cross-port):
  GET  /status            daemon + machine state, progress, last results
  GET  /settings          current settings        POST /settings  {changes}
  POST /reference         survey empty table -> reference mosaic
  POST /locate            survey + diff -> part bbox
  POST /scan              {bbox_in?, session?, dry_run?} -> orbit scan
  POST /sweep             {axis, start, end, step, session?} -> line sweep
                          (offsets in inches from the current position),
                          then triangulated (sweep.process_dir)
  POST /process           {session} -> re-triangulate a sweep session
  GET  /plan              last generated orbit plan
  POST /abort             stop the running operation
  POST /confirm           acknowledge a manual-pan prompt
  GET  /sessions          list captured scan sessions (+ sweep stats)
  GET  /artifact/<path>   files under data/ (reference/, locate/, scans/)
  GET  /export/stl?session=<name>[&crop=part|all][&base=2]
                          closed STL solid of a sweep's height surface (mm)
  GET  /app/...           the dashboard app's files (open
                          http://<host>:3150/app/ directly while developing)
"""

import argparse
import json
import os
import re
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import camera
import fabmo_client as fabmo
import orbit
import scan_settings
import sweep
import table_map
from scan_settings import DATA_DIR

STATE_LOCK = threading.Lock()
STATE = {
    "state": "idle",          # idle | busy | error
    "op": None,               # reference | locate | scan
    "phase": "",
    "progress": {"done": 0, "total": 0},
    "message": "",
    "error": None,
    "waiting_confirm": None,  # message string when paused for manual pan
    "last_locate": None,
    "last_scan": None,
    "last_sweep": None,
}
ABORT = threading.Event()
LIVE = {"session": None, "live": None}     # the sweep being captured (sweep.Live)
CONFIRM = threading.Event()
LAST_PLAN = {"plan": None}


def set_state(**kw):
    with STATE_LOCK:
        STATE.update(kw)


def get_state():
    with STATE_LOCK:
        return dict(STATE)


# ---------------------------------------------------------------- camera

_cap_lock = threading.Lock()
_cap = [None]


def camgrab(flush=4):
    with _cap_lock:
        if _cap[0] is None:
            _cap[0] = camera.open_camera()
            time.sleep(0.5)
        try:
            return camera.grab(_cap[0], flush=flush)
        except RuntimeError:
            # stream hiccup: reopen once
            try:
                _cap[0].release()
            except Exception:
                pass
            _cap[0] = camera.open_camera()
            time.sleep(0.5)
            return camera.grab(_cap[0], flush=flush)


# ---------------------------------------------------------------- jobs

def progress_cb(done, total):
    set_state(progress={"done": done, "total": total})


def wait_confirm(message):
    CONFIRM.clear()
    set_state(waiting_confirm=message)
    while not CONFIRM.wait(timeout=0.25):
        if ABORT.is_set():
            set_state(waiting_confirm=None)
            raise orbit.Aborted()
    set_state(waiting_confirm=None)


def job_reference(_body):
    s = scan_settings.load()
    set_state(phase="surveying table (empty)", progress={"done": 0, "total": 0})
    mosaic, _ = table_map.capture_mosaic(fabmo, camgrab, s, progress_cb, ABORT)
    set_state(phase="saving reference")
    table_map.save_reference(mosaic)
    return {"message": "reference captured"}


def job_locate(_body):
    s = scan_settings.load()
    if not table_map.have_reference():
        raise RuntimeError("no reference mosaic — capture one with the table empty")
    set_state(phase="surveying table", progress={"done": 0, "total": 0})
    mosaic, _ = table_map.capture_mosaic(fabmo, camgrab, s, progress_cb, ABORT)
    set_state(phase="finding part")
    result = table_map.find_part(mosaic, s)
    set_state(last_locate=result)
    return result


def job_scan(body):
    s = scan_settings.load()
    bbox = body.get("bbox_in")
    if bbox is None:
        last = get_state()["last_locate"]
        if not (last and last.get("found")):
            raise RuntimeError("no bbox given and no located part — run locate first")
        bbox = last["bbox_in"]
    if len(bbox) != 4 or bbox[0] >= bbox[2] or bbox[1] >= bbox[3]:
        raise RuntimeError("bad bbox_in %r" % (bbox,))
    scan_plan = orbit.plan(bbox, s)
    LAST_PLAN["plan"] = scan_plan
    session = body.get("session") or time.strftime("scan_%Y%m%d_%H%M%S")
    session = re.sub(r"[^A-Za-z0-9_.-]", "_", session)
    set_state(phase="scanning (%d passes, %d frames)" % (
        scan_plan["n_passes"], scan_plan["n_frames"]))
    runner = orbit.OrbitRunner(fabmo, camgrab, s, progress_cb, ABORT, wait_confirm)
    result = runner.run(scan_plan, session)
    set_state(last_scan=result)
    return result


def _session_name(body, prefix):
    session = body.get("session") or time.strftime(prefix + "_%Y%m%d_%H%M%S")
    return re.sub(r"[^A-Za-z0-9_.-]", "_", session)


def job_sweep(body):
    s = scan_settings.load()
    try:
        axis = str(body.get("axis", "y")).lower()
        start, end, step = (float(body[k]) for k in ("start", "end", "step"))
        rows = int(body.get("rows", 1) or 1)
        row_spacing = float(body.get("row_spacing", 0) or 0)
        row_start = float(body.get("row_start", 0) or 0)
        headings = [float(h) for h in (body.get("headings") or [0])]
        length = float(body.get("length", 0) or 0)
    except (KeyError, TypeError, ValueError):
        raise RuntimeError("sweep needs numeric start, end, step (rows, row_spacing optional)")
    session = _session_name(body, "sweep")
    outdir = os.path.join(orbit.SCANS_DIR, session)
    if os.path.exists(outdir):
        raise RuntimeError("session %s already exists" % session)
    multi = len(headings) > 1 or any(abs(h) > 0.05 for h in headings)
    if multi:
        import pan as panmod
        if not panmod.Pan.available():
            raise RuntimeError("no pan.json — run the B-axis calibration (pan_calib.py) first")
        if rows > 1:
            raise RuntimeError("multi-heading scans use one sweep per heading (rows = 1)")
        if length <= 0:
            raise RuntimeError("multi-heading scans need a sweep length (inches)")
        pan_model = panmod.Pan()
        n = (int(round(length / step)) + 1) * len(headings)
    else:
        n = (int(round((end - start) / step)) + 1) * max(1, rows) if step > 0 else 0
    # Calibration is only valid at the calibrated resolution. If the video
    # app's camera server holds /dev/video0, camera.open_camera() falls back
    # to its MJPEG stream, which may be a different size — refuse that.
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "camera.json")) as fh:
        want_w, want_h = json.load(fh)["image_size"]
    frame = camgrab()
    if (frame.shape[1], frame.shape[0]) != (want_w, want_h):
        with _cap_lock:                     # let a later attempt reopen the device
            try:
                _cap[0].release()
            except Exception:
                pass
            _cap[0] = None
        raise RuntimeError(
            "camera gives %dx%d, calibration is %dx%d — the video app's camera "
            "server probably holds the camera (sudo systemctl stop camera-server-2)"
            % (frame.shape[1], frame.shape[0], want_w, want_h))
    set_state(phase=("scanning %d headings (%d stops)" % (len(headings), n)) if multi else
              "sweeping %s (%d stops%s)" % (axis.upper(), n, ", %d rows" % rows if rows > 1 else ""),
              progress={"done": 0, "total": n})

    def on_live(live):
        LIVE.update(session=session, live=live)

    with _cap_lock:              # the sweep owns the camera until it's done
        if _cap[0] is None:
            _cap[0] = camera.open_camera()
            time.sleep(0.5)
        if multi:
            def targets(origin):
                h = float(s["table_below_cam_mm"]) + \
                    (origin["z"] - float(s["table_ref_z_in"])) * 25.4
                return sweep.plan_headings(origin, headings, length, step, pan_model, h)
            man = sweep.run_capture_job(
                fabmo, _cap[0], outdir, "y", 0, 1, step, int(s["laser_output"]),
                progress_cb, ABORT, on_live=on_live, targets=targets, pan_model=pan_model,
                extra_manifest={"kind": "multi", "headings": sorted(headings),
                                "length": length, "rows": 1, "axis": "multi"})
        else:
            man = sweep.run_capture_job(fabmo, _cap[0], outdir, axis, start, end, step,
                                        int(s["laser_output"]), progress_cb, ABORT,
                                        on_live=on_live, rows=rows, row_spacing=row_spacing,
                                        row_start=row_start)
    if not man["complete"]:
        return {"message": "sweep stopped early", "session": session}
    set_state(phase="triangulating", progress={"done": 0, "total": len(man["shots"])})
    live = LIVE["live"]
    stats = sweep.process_dir(outdir, progress=progress_cb,
                              precomputed=live.raw if live is not None else None)
    result = {"session": session, "stats": stats}
    set_state(last_sweep=result)
    top = stats.get("top")
    msg = "sweep %s: %d points" % (session, stats["n_points"])
    if top:
        msg += ", top %.2f mm above table" % top["height_mm"]
    result["message"] = msg
    return result


def job_process(body):
    session = re.sub(r"[^A-Za-z0-9_.-]", "_", str(body.get("session", "")))
    outdir = os.path.join(orbit.SCANS_DIR, session)
    if not session or not os.path.isfile(os.path.join(outdir, "manifest.json")):
        raise RuntimeError("no such session %r" % session)
    set_state(phase="triangulating " + session, progress={"done": 0, "total": 0})
    stats = sweep.process_dir(outdir, progress=progress_cb)
    result = {"session": session, "stats": stats,
              "message": "re-processed %s: %d points" % (session, stats["n_points"])}
    set_state(last_sweep=result)
    return result


JOBS = {"reference": job_reference, "locate": job_locate, "scan": job_scan,
        "sweep": job_sweep, "process": job_process}
# jobs that never move the machine may start while it is busy elsewhere
NO_MOTION = {"process"}


def run_job(op, body):
    try:
        result = JOBS[op](body)
        set_state(state="idle", op=None, phase="", message=result.get("message", "done"),
                  error=None)
    except (orbit.Aborted, table_map.Aborted, sweep.Aborted):
        set_state(state="idle", op=None, phase="", message="aborted", error=None)
    except Exception as e:
        traceback.print_exc()
        set_state(state="idle", op=None, phase="", message="", error=str(e))


def start_job(op, body):
    with STATE_LOCK:
        if STATE["state"] == "busy":
            return False, "busy with %s" % STATE["op"]
    if op not in NO_MOTION:
        try:
            mstate = fabmo.status()["state"]
        except Exception as e:
            return False, "engine unreachable: %s" % e
        if mstate != "idle":
            return False, "machine is %s (must be idle)" % mstate
    ABORT.clear()
    set_state(state="busy", op=op, phase="starting", message="", error=None,
              progress={"done": 0, "total": 0})
    threading.Thread(target=run_job, args=(op, body), daemon=True).start()
    return True, None


# ---------------------------------------------------------------- HTTP

MIME = {".png": "image/png", ".jpg": "image/jpeg", ".json": "application/json",
        ".ply": "application/octet-stream", ".bin": "application/octet-stream",
        ".html": "text/html; charset=utf-8", ".js": "application/javascript",
        ".css": "text/css", ".svg": "image/svg+xml"}
APP_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "scanner.fma")


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        pass  # quiet; errors surface via API

    def _send(self, code, payload, ctype="application/json", extra=None):
        body = json.dumps(payload).encode() if ctype == "application/json" else payload
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        if extra:
            self.send_header("Access-Control-Expose-Headers", ", ".join(extra))
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(body)

    def _json_body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if not n:
            return {}
        try:
            return json.loads(self.rfile.read(n))
        except ValueError:
            return {}

    def do_OPTIONS(self):
        self._send(200, {})

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/status":
            st = get_state()
            try:
                m = fabmo.status()
                st["machine"] = {"state": m["state"], "x": m["posx"],
                                 "y": m["posy"], "z": m["posz"]}
            except Exception as e:
                st["machine"] = {"state": "unreachable", "error": str(e)}
            st["have_reference"] = table_map.have_reference()
            if LIVE["live"] is not None:
                st["live"] = dict(LIVE["live"].info(), session=LIVE["session"])
            st["have_mount_cal"] = os.path.exists(
                os.path.join(os.path.dirname(os.path.abspath(__file__)), "mount.json"))
            return self._send(200, st)
        if path == "/settings":
            return self._send(200, scan_settings.load())
        if path == "/export/stl":
            q = dict(kv.split("=", 1) for kv in self.path.split("?", 1)[-1].split("&")
                     if "=" in kv) if "?" in self.path else {}
            session = re.sub(r"[^A-Za-z0-9_.-]", "_", q.get("session", ""))
            crop = "all" if q.get("crop") == "all" else "part"
            try:
                base = min(50.0, max(0.5, float(q.get("base", 2.0))))
            except ValueError:
                base = 2.0
            capdir = os.path.join(orbit.SCANS_DIR, session)
            if not session or not os.path.isfile(os.path.join(capdir, "surface.bin")):
                return self._send(404, {"error": "no processed scan %r" % session})
            try:
                data = sweep.surface_stl(capdir, crop, base)
            except Exception as e:
                return self._send(500, {"error": str(e)})
            fname = "%s%s.stl" % (session, "" if crop == "part" else "_all")
            return self._send(200, data, "model/stl", extra={
                "Content-Disposition": 'attachment; filename="%s"' % fname})
        if path == "/live/points":
            # binary float32 x,y,z (mm, provisional heights) for shots >= from;
            # X-Shots-Done tells the client where to continue
            live = LIVE["live"]
            try:
                frm = int(dict(kv.split("=", 1) for kv in self.path.split("?", 1)[1]
                               .split("&") if "=" in kv).get("from", 0)) \
                    if "?" in self.path else 0
            except ValueError:
                frm = 0
            if live is None:
                return self._send(404, {"error": "no live sweep"})
            P, done = live.snapshot(frm)
            return self._send(200, P.astype("<f4").tobytes(), "application/octet-stream",
                              extra={"X-Shots-Done": str(done),
                                     "X-Live-Session": LIVE["session"] or ""})
        if path == "/plan":
            return self._send(200, LAST_PLAN["plan"] or {})
        if path == "/sessions":
            out = []
            if os.path.isdir(orbit.SCANS_DIR):
                for name in sorted(os.listdir(orbit.SCANS_DIR), reverse=True):
                    man = os.path.join(orbit.SCANS_DIR, name, "manifest.json")
                    entry = {"session": name}
                    try:
                        with open(man) as fh:
                            m = json.load(fh)
                        entry.update(complete=m.get("complete"),
                                     kind=m.get("kind", "orbit" if "plan" in m else "sweep"),
                                     created=m.get("created"),
                                     frames=len(m.get("shots", [])) * 2)
                    except (IOError, ValueError):
                        entry["complete"] = None
                    stats = os.path.join(orbit.SCANS_DIR, name, "scan.json")
                    if os.path.isfile(stats):
                        try:
                            with open(stats) as fh:
                                entry["stats"] = json.load(fh)
                        except ValueError:
                            pass
                        if not entry.get("created"):
                            entry["created"] = time.strftime(
                                "%Y-%m-%d %H:%M:%S", time.localtime(os.path.getmtime(man)))
                    out.append(entry)
            return self._send(200, out)
        if path in ("/app", "/app/"):
            path = "/app/index.html"
        if path.startswith("/app/"):
            rel = os.path.normpath(path[len("/app/"):])
            full = os.path.join(APP_DIR, rel)
            if rel.startswith("..") or os.path.isabs(rel) or not os.path.isfile(full):
                return self._send(404, {"error": "not found"})
            with open(full, "rb") as fh:
                data = fh.read()
            return self._send(200, data, MIME.get(os.path.splitext(full)[1].lower(),
                                                  "application/octet-stream"))
        if path.startswith("/artifact/"):
            rel = os.path.normpath(path[len("/artifact/"):])
            if rel.startswith("..") or os.path.isabs(rel):
                return self._send(400, {"error": "bad path"})
            full = os.path.join(DATA_DIR, rel)
            if not os.path.isfile(full):
                return self._send(404, {"error": "not found"})
            with open(full, "rb") as fh:
                data = fh.read()
            ext = os.path.splitext(full)[1].lower()
            return self._send(200, data, MIME.get(ext, "application/octet-stream"))
        return self._send(404, {"error": "unknown endpoint"})

    def do_POST(self):
        path = self.path.split("?")[0]
        body = self._json_body()
        if path == "/settings":
            return self._send(200, scan_settings.update(body))
        if path == "/abort":
            ABORT.set()
            return self._send(200, {"aborting": get_state()["state"] == "busy"})
        if path == "/confirm":
            CONFIRM.set()
            return self._send(200, {})
        if path == "/scan" and body.get("dry_run"):
            try:
                s = scan_settings.load()
                bbox = body.get("bbox_in")
                if bbox is None:
                    last = get_state()["last_locate"]
                    if not (last and last.get("found")):
                        raise RuntimeError("no bbox for dry run — run locate first")
                    bbox = last["bbox_in"]
                p = orbit.plan(bbox, s)
                LAST_PLAN["plan"] = p
                return self._send(200, p)
            except Exception as e:
                return self._send(400, {"error": str(e)})
        if path in ("/reference", "/locate", "/scan", "/sweep", "/process"):
            ok, err = start_job(path[1:], body)
            if ok:
                return self._send(202, {"started": path[1:]})
            return self._send(409, {"error": err})
        return self._send(404, {"error": "unknown endpoint"})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=3150)
    args = ap.parse_args()
    os.makedirs(DATA_DIR, exist_ok=True)
    scan_settings.save(scan_settings.load())  # materialize defaults
    srv = ThreadingHTTPServer(("0.0.0.0", args.port), Handler)
    print("scand listening on :%d  (data in %s)" % (args.port, DATA_DIR))
    srv.serve_forever()


if __name__ == "__main__":
    main()
