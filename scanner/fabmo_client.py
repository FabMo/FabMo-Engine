"""Minimal FabMo engine client for the scanner proof-of-concept.

Talks to the local engine over HTTP: status polling, wait-for-idle,
and direct gcode execution via POST /code (machine must be idle).
"""

import json
import time
import urllib.request

BASE = "http://localhost"


def _get(path):
    with urllib.request.urlopen(BASE + path, timeout=5) as r:
        return json.loads(r.read())


def _post(path, payload):
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=5) as r:
        return json.loads(r.read())


def status():
    return _get("/status")["data"]["status"]


def pose():
    """Current work position as a dict (x, y, z, a, b).

    Rotary axes are only in the status report when the machine has them
    enabled (e.g. no posa on a PRS without an A axis) — missing ones are None.
    """
    s = status()
    return {"x": s["posx"], "y": s["posy"], "z": s["posz"],
            "a": s.get("posa"), "b": s.get("posb")}


def run_gcode(cmd):
    """Run gcode and block until the machine is idle again.

    Returns the final status. Raises on engine-reported errors.
    """
    resp = _post("/code", {"cmd": cmd, "runtime": "g"})
    if resp.get("status") != "success":
        raise RuntimeError("engine rejected code: %s" % resp.get("message"))

    # Wait for the machine to leave idle (fast moves may finish before we
    # ever see a non-idle state, so cap this phase).
    deadline = time.time() + 2.0
    while time.time() < deadline:
        if status()["state"] != "idle":
            break
        time.sleep(0.05)

    # Now wait for it to come back to idle.
    deadline = time.time() + 120.0
    while time.time() < deadline:
        s = status()
        if s["state"] == "idle":
            return s
        # 'stopped' is a transient state on the way back to idle after a
        # direct /code run — keep waiting. Only 'dead' is fatal.
        if s["state"] == "dead":
            raise RuntimeError("machine entered state 'dead' during move")
        time.sleep(0.1)
    raise RuntimeError("timed out waiting for idle")


POS_TOL = 0.002   # inches


def goto(x=None, y=None, z=None, feed=None, retries=2):
    """Absolute move in work coordinates. Only supplied axes move.

    Verifies the position afterwards and re-sends the move if the machine
    didn't get there: a /code run sent immediately after another one can
    be accepted by the engine yet never execute (seen 2026-11-07: an
    M100 output command followed at once by a G0 Z move — the Z move was
    silently dropped). Raises if the target still isn't reached.
    """
    target = {"posx": x, "posy": y, "posz": z}
    words = []
    for axis, val in (("X", x), ("Y", y), ("Z", z)):
        if val is not None:
            words.append("%s%.4f" % (axis, val))
    if not words:
        return status()
    cmd = ("G90 G1 F%g %s" % (feed, " ".join(words))) if feed \
        else ("G90 G0 " + " ".join(words))
    for attempt in range(retries + 1):
        s = run_gcode(cmd)
        off = {k: s[k] - v for k, v in target.items()
               if v is not None and abs(s[k] - v) > POS_TOL}
        if not off:
            return s
        time.sleep(0.3)
    raise RuntimeError("move %r did not reach target after %d tries (error %s)" % (
        cmd, retries + 1, off))


def set_output(n, value, retries=2):
    """Set digital output n (M100 ({outN:v})) and verify it in the status."""
    for attempt in range(retries + 1):
        s = run_gcode("M100 ({out%d:%d})" % (n, value))
        if s.get("out%d" % n) == value:
            return s
        time.sleep(0.3)
        s = status()
        if s.get("out%d" % n) == value:
            return s
    raise RuntimeError("out%d did not change to %d" % (n, value))


if __name__ == "__main__":
    print(json.dumps(pose(), indent=2))
