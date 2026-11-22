"""Webcam helper: open a UVC camera, lock focus/exposure, grab frames.

Autofocus and auto-exposure silently change the camera model between
frames, which ruins calibration — so we lock everything we can via
v4l2-ctl before capturing.
"""

import glob
import os
import subprocess
import time

import cv2

WIDTH = 1920
HEIGHT = 1080


def find_device():
    """Return the webcam's capture node (/dev/videoN).

    Reads /sys/class/video4linux: a USB device's node with index 0 is its
    video-capture node (index 1 is metadata). No v4l2-ctl calls — those
    sometimes took longer than their timeout right after the camera had
    been streaming, and the camera then looked absent (2026-11-08).
    """
    for sysdir in sorted(glob.glob("/sys/class/video4linux/video*"),
                         key=lambda p: int(p.rsplit("video", 1)[1])):
        try:
            real = os.path.realpath(os.path.join(sysdir, "device"))
            with open(os.path.join(sysdir, "index")) as fh:
                idx = int(fh.read().strip() or 0)
        except (OSError, ValueError):
            continue
        if "/usb" in real and idx == 0:
            return "/dev/" + os.path.basename(sysdir)
    return _find_device_v4l2()


def _find_device_v4l2():
    """Fallback: the first /dev/video* node that reports video capture."""
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


EXPOSURE_KIND = ["calib"]      # which exposure setting lock_controls applies


def exposure_value(kind=None):
    import scan_settings
    st = scan_settings.load()
    return int(st.get("camera_exposure_%s" % (kind or EXPOSURE_KIND[0])) or 300)


def set_exposure(kind, dev=None, settle=1.2):
    """Switch between the "scan" and "calib" exposure settings; it sticks
    across reopens (lock_controls) until switched back. Returns the value."""
    EXPOSURE_KIND[0] = kind
    dev = dev or find_device()
    val = exposure_value(kind)
    if dev and str(dev).startswith("/dev/"):
        apply_exposure(dev)
        time.sleep(settle)                  # a few frames at the old exposure
    return val


def apply_exposure(dev, cap=None):
    """Write the current exposure setting to the camera. The EMEET only
    honours it while it is STREAMING: a value written before the first frame
    reads back fine but the stream starts at its default (found 2026-11-22,
    a whole scan ran at 300 with the control saying 75). So opens call this
    after a first grab (pass cap), and the value is nudged so the write is
    never a no-op."""
    if cap is not None:
        cap.grab()
    val = exposure_value()
    for v in (val + 1, val):
        subprocess.run(["v4l2-ctl", "-d", dev, "--set-ctrl",
                        "exposure_time_absolute=%d" % v], capture_output=True)


def lock_controls(dev):
    """Best-effort lock of autofocus / auto-exposure / auto-WB, then the
    calibrated focus and the scanning brightness from the scanner settings
    (camera_focus, camera_brightness).

    The camera forgets everything when it's unplugged (back to continuous
    autofocus, brightness default) — and the calibration (camera.json) is
    only valid at the focus it was made at — so set them on every open
    instead of trusting the device state (2026-11-08: a replug left AF on).
    Control names vary by camera; failures are fine (control absent).
    """
    try:
        import scan_settings
        st = scan_settings.load()
        focus, bright = st.get("camera_focus"), st.get("camera_brightness")
    except Exception:
        focus = bright = None
    settings = [
        ("focus_automatic_continuous", "0"),
        ("focus_auto", "0"),
        ("auto_exposure", "1"),           # 1 = manual on most UVC cams
        ("exposure_auto", "1"),
        ("white_balance_automatic", "0"),
        ("white_balance_temperature_auto", "0"),
    ]
    if focus is not None:
        settings.append(("focus_absolute", str(int(focus))))
    if bright is not None:
        settings.append(("brightness", str(int(bright))))
    try:
        settings.append(("exposure_time_absolute", str(exposure_value())))
        settings.append(("exposure_absolute", str(exposure_value())))
    except Exception:
        pass
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
    # The EMEET is sometimes still "busy" for a moment after another
    # process closed it (or after a replug) — retry before falling back.
    for attempt in range(4):
        cap = cv2.VideoCapture(dev, cv2.CAP_V4L2)
        if cap.isOpened():
            break
        cap.release()
        time.sleep(1.0)
    if cap.isOpened():
        cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, WIDTH)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, HEIGHT)
        apply_exposure(dev, cap)
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
