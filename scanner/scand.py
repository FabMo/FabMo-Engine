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
  GET  /plan              last generated orbit plan
  POST /abort             stop the running operation
  POST /confirm           acknowledge a manual-pan prompt
  GET  /sessions          list captured scan sessions
  GET  /artifact/<path>   files under data/ (reference/, locate/, scans/)
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
}
ABORT = threading.Event()
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


def camgrab():
    with _cap_lock:
        if _cap[0] is None:
            _cap[0] = camera.open_camera()
            time.sleep(0.5)
        try:
            return camera.grab(_cap[0])
        except RuntimeError:
            # stream hiccup: reopen once
            try:
                _cap[0].release()
            except Exception:
                pass
            _cap[0] = camera.open_camera()
            time.sleep(0.5)
            return camera.grab(_cap[0])


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


JOBS = {"reference": job_reference, "locate": job_locate, "scan": job_scan}


def run_job(op, body):
    try:
        result = JOBS[op](body)
        set_state(state="idle", op=None, phase="", message=result.get("message", "done"),
                  error=None)
    except (orbit.Aborted, table_map.Aborted):
        set_state(state="idle", op=None, phase="", message="aborted", error=None)
    except Exception as e:
        traceback.print_exc()
        set_state(state="idle", op=None, phase="", message="", error=str(e))


def start_job(op, body):
    with STATE_LOCK:
        if STATE["state"] == "busy":
            return False, "busy with %s" % STATE["op"]
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
        ".ply": "application/octet-stream"}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        pass  # quiet; errors surface via API

    def _send(self, code, payload, ctype="application/json"):
        body = json.dumps(payload).encode() if ctype == "application/json" else payload
        self.send_response(code)
        self.send_header("Content-Type", ctype)
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
            st["have_mount_cal"] = os.path.exists(
                os.path.join(os.path.dirname(os.path.abspath(__file__)), "mount.json"))
            return self._send(200, st)
        if path == "/settings":
            return self._send(200, scan_settings.load())
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
                                     frames=len(m.get("shots", [])) * 2)
                    except (IOError, ValueError):
                        entry["complete"] = None
                    out.append(entry)
            return self._send(200, out)
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
        if path in ("/reference", "/locate", "/scan"):
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
