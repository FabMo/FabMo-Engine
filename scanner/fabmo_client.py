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
    """Current work position as a dict (x, y, z, a)."""
    s = status()
    return {"x": s["posx"], "y": s["posy"], "z": s["posz"], "a": s["posa"]}


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


def goto(x=None, y=None, z=None, feed=None):
    """Absolute move in work coordinates. Only supplied axes move."""
    words = []
    for axis, val in (("X", x), ("Y", y), ("Z", z)):
        if val is not None:
            words.append("%s%.4f" % (axis, val))
    if not words:
        return status()
    if feed:
        return run_gcode("G90 G1 F%g %s" % (feed, " ".join(words)))
    return run_gcode("G90 G0 " + " ".join(words))


if __name__ == "__main__":
    print(json.dumps(pose(), indent=2))
