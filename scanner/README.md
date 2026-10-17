# scanner — webcam-on-gantry 3D scanning proof of concept

Milestone 1: prove that machine-known camera poses give metric depth
from a plain webcam. No laser, no printed mount — tape is fine.

Code lives here; generated working data (calibration frames, camera.json,
mount.json, captures, point clouds) is gitignored — the live working set
is on the dev Pi at `/home/pi/dev/scanner-poc/`. End goal: camera + line
laser on an indexed pan head gripping the spindle, driven as a spare G2
rotary axis; all point clouds land in machine coordinates (no ICP).

Status (Oct 2026): intrinsics calibrated on the dev webcam (RMS 0.40 px,
640x480 via video.fma camera-server MJPEG stream at :3142 — it owns
/dev/video0, we read its stream). Machine-control loop verified against
POST /code. Next: hand-eye run with camera taped to the Z carriage, then
machine-baseline stereo on a test block.

## One-time setup

1. Plug in the webcam. Sanity check: `python3 camera.py` → `test_frame.jpg`.
2. `python3 make_target.py` → print `chessboard_letter.png` at **actual
   size** (300 DPI), tape it to something flat. Measure a square with
   calipers.
3. Intrinsics (camera can be handheld/desk-mounted for this):
   `python3 capture_calib.py 20` — wave the board through the view
   (vary tilt/distance/corners), then
   `python3 calibrate_intrinsics.py <square_mm>` → `camera.json`.
   Want RMS < 0.5 px.

## Machine session

4. Tape the camera to the Z carriage pointing down, cable strain-relieved.
   Lay the chessboard flat on the table.
5. Jog so the board is centered in view at a comfortable height
   (~12" standoff works), then:
   `python3 capture_grid.py handeye --nx 3 --ny 3 --step 0.75`
   (keep the board fully in view at all 9 positions).
6. `python3 hand_eye.py captures/handeye` → `mount.json` + the headline
   accuracy number (machine-vs-camera residuals, mm).
7. Put a textured object (wood block etc.) on the table, jog over it:
   `python3 capture_grid.py block --nx 2 --ny 1 --step 1.0`
   `python3 stereo_depth.py captures/block` → `depth.png`, `cloud.ply`.
8. Measure the block top vs table in the cloud; compare to calipers.

## Notes

- Machine moves go through `POST /code` (gcode runtime, idle only).
  Poses are stamped from `/status` after each move settles.
- All moves in capture_grid are relative to the start point, same Z.
- `fabmo_client.py` / `camera.py` are the reusable building blocks for
  the eventual laser-line scanner app.
