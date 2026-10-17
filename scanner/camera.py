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


if __name__ == "__main__":
    cap = open_camera()
    time.sleep(0.5)
    frame = grab(cap)
    cv2.imwrite("test_frame.jpg", frame)
    print("wrote test_frame.jpg  %dx%d" % (frame.shape[1], frame.shape[0]))
