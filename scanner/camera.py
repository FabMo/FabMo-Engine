"""Webcam helper: open a UVC camera, lock focus/exposure, grab frames.

Autofocus and auto-exposure silently change the camera model between
frames, which ruins calibration — so we lock everything we can via
v4l2-ctl before capturing.
"""

import glob
import subprocess
import time

import cv2

WIDTH = 1920
HEIGHT = 1080


def find_device():
    """Return the first /dev/video* node that reports video capture."""
    for dev in sorted(glob.glob("/dev/video*")):
        try:
            out = subprocess.run(
                ["v4l2-ctl", "-d", dev, "--all"],
                capture_output=True, text=True, timeout=5,
            ).stdout
        except Exception:
            continue
        # The Pi's internal codec/ISP nodes are platform devices; a
        # webcam enumerates on USB and does plain video capture.
        if "Bus info" in out and "usb" in out.split("Bus info")[1].splitlines()[0] \
                and "Video Capture" in out:
            return dev
    return None


def lock_controls(dev):
    """Best-effort lock of autofocus / auto-exposure / auto-WB.

    Control names vary by camera; failures are fine (control absent).
    """
    settings = [
        ("focus_automatic_continuous", "0"),
        ("focus_auto", "0"),
        ("auto_exposure", "1"),           # 1 = manual on most UVC cams
        ("exposure_auto", "1"),
        ("white_balance_automatic", "0"),
        ("white_balance_temperature_auto", "0"),
    ]
    for name, val in settings:
        subprocess.run(
            ["v4l2-ctl", "-d", dev, "--set-ctrl", "%s=%s" % (name, val)],
            capture_output=True,
        )


STREAM_URL = "http://localhost:3142/stream"   # video.fma camera-server


def open_camera(dev=None):
    dev = dev or find_device()
    if dev is None:
        raise RuntimeError("no webcam found (is it plugged in?)")
    lock_controls(dev)
    cap = cv2.VideoCapture(dev, cv2.CAP_V4L2)
    if cap.isOpened():
        cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, WIDTH)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, HEIGHT)
    else:
        # video.fma's camera-server usually owns the device; read its
        # MJPEG stream instead (same frames the dashboard sees).
        cap = cv2.VideoCapture(STREAM_URL)
        dev = STREAM_URL
    if not cap.isOpened():
        raise RuntimeError("failed to open %s" % dev)
    print("camera: %s @ %dx%d" % (
        dev,
        cap.get(cv2.CAP_PROP_FRAME_WIDTH),
        cap.get(cv2.CAP_PROP_FRAME_HEIGHT),
    ))
    return cap


def grab(cap, flush=4):
    """Grab a fresh frame, discarding buffered stale ones first."""
    for _ in range(flush):
        cap.grab()
    ok, frame = cap.read()
    if not ok:
        raise RuntimeError("frame capture failed")
    return frame


class LatestFrame:
    """Keeps a capture drained on a background thread (grab() only — no
    decode), so read() returns a frame captured within the last frame
    interval instead of a stale buffered one. Use while the machine runs a
    timed program and frames must be taken inside short windows.

        with LatestFrame(cap) as lf:
            frame = lf.read()
    """

    def __init__(self, cap):
        import threading
        self.cap = cap
        self.lock = threading.Lock()
        self.stop = threading.Event()
        self.grabbed = 0
        self.thread = threading.Thread(target=self._run, daemon=True)

    def _run(self):
        while not self.stop.is_set():
            with self.lock:
                ok = self.cap.grab()
            if ok:
                self.grabbed += 1
            else:
                time.sleep(0.01)

    def __enter__(self):
        self.thread.start()
        deadline = time.time() + 3.0               # wait for frames to flow
        while self.grabbed < 3 and time.time() < deadline:
            time.sleep(0.02)
        return self

    def __exit__(self, *exc):
        self.stop.set()
        self.thread.join(timeout=2.0)

    def read(self):
        """Decode the most recently grabbed frame. Waits for one new grab
        first, so the frame was exposed after this call started."""
        n0 = self.grabbed
        deadline = time.time() + 1.0
        while self.grabbed <= n0 and time.time() < deadline:
            time.sleep(0.003)
        with self.lock:
            ok, frame = self.cap.retrieve()
        if not ok:
            raise RuntimeError("frame retrieve failed")
        return frame


if __name__ == "__main__":
    cap = open_camera()
    time.sleep(0.5)
    frame = grab(cap)
    cv2.imwrite("test_frame.jpg", frame)
    print("wrote test_frame.jpg  %dx%d" % (frame.shape[1], frame.shape[0]))
