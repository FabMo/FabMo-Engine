# scanner-poc — webcam-on-gantry 3D scanning proof of concept

Milestone 1: prove that machine-known camera poses give metric depth
from a plain webcam. No laser, no printed mount — tape is fine.

## Milestone 2: scan daemon + dashboard app

`scand.py` is an HTTP/JSON daemon (port 3150) that owns the camera, the
laser output, and machine motion, and runs the scan workflow:

1. **Capture Reference** — stop-and-shoot survey of the (empty) table;
   every frame is warped onto the table plane (`table_map.py`) into a
   metric orthophoto mosaic.
2. **Find Part** — re-survey, diff against the reference, morphological
   cleanup → part bounding box in machine coordinates.
3. **Scan** — `orbit.py` plans sweeps around the bbox: for each indexed
   pan heading (B axis), straight stop-and-shoot passes that walk the
   vertical laser plane across the part (lanes if the part is wider
   than one stripe), capturing laser off/on frame pairs with full pose
   stamping into `data/scans/<session>/manifest.json`. Triangulation is
   the next milestone and runs offline from the manifest.

`scanner.fma/` is the dashboard app (thin client; polls the daemon,
shows the table map + bbox + plan overlay, runs the workflow). Install:
zip the directory to `scanner_app.fma` and upload through the app
manager. Hardware toggles live in settings: `use_laser`, `use_pan`
(B axis wired?), `pan_prompt` (manual head rotation), `laser_output`
(M100 ({outN:…}), default out5).

Run the daemon: `python3 scand.py` (data + settings in `data/`).

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

## Calibrating a head-mounted camera (PRS Alpha, Nov 2026)

With the camera fixed in a canted head (30° here) the board can only lie
roughly flat under it, so handheld views alone leave the focal length
loose (it trades off against distance; fx/fy wandered ±2-5%). What worked:

1. Lock the video mode and focus at the scanning standoff first (camera.py
   keeps the current focus value; set it with v4l2-ctl).
2. Size the board to about half the view: `python3 make_target.py 12`
   → print the PDF at Actual Size. Measure the WHOLE board both ways
   (10 squares long, 7 short) — a single-square caliper read was 1.7% off.
3. `python3 capture_calib.py 30` with the board flat, pushed into every
   image corner, plus some propped views (far edge raised so it faces
   the camera — stays in focus, unlike lifting the near edge). Then
   `python3 calibrate_intrinsics.py <sq>` → provisional `camera.json`.
4. Machine grid with Z steps, board centered on the grid:
   `python3 capture_grid.py handeye --nx 3 --ny 3 --step 0.3 --zs 0,-0.3,-0.6`
   `python3 hand_eye.py captures/handeye` → initial `mount.json`.
5. `python3 refine_calib.py <long>x<short> captures/handeye --scale-from-machine`
   jointly refines intrinsics + mount using the known machine moves as
   the length reference (verify the machine's steps-per-unit with a tape
   first). Good result: machine-grid RMS close to the handheld RMS.
   Its per-shot-PnP "motion scale" lines are a noisy diagnostic only.

## Notes

- Machine moves go through `POST /code` (gcode runtime, idle only).
  Poses are stamped from `/status` after each move settles.
- All moves in capture_grid are relative to the start point, same Z.
- `fabmo_client.py` / `camera.py` are the reusable building blocks for
  the eventual laser-line scanner app.

## Laser-plane calibration

The line must run ACROSS the camera's cant: with the camera tilted about
machine X (looking toward +Y), the line runs along machine X —
horizontal in the image. A line along Y puts the laser sheet through the
camera centre (edge-on, no triangulation; first PRS mount, Nov 2026).

1. Lay the chessboard flat so the stripe crosses it (the whole board need
   not be in view — a 9x5/9x4 sub-grid fixes the board plane just as well).
2. `python3 laser_plane.py capture laserboard` — laser off/on pairs at Z
   offsets 0..-0.6 in (down only; laser forced off, Z restored at the end).
3. `python3 laser_plane.py fitboard captures/laserboard` → `laser.json`.
   Each laser-off frame locates the board, so stripe pixels become exact
   3D points; the plane is a direct mm fit. Good: RMS ~0.1 mm, per-shot
   mean offsets ~0.01 mm.

A table-only fit (`laser_plane.py fit`) can't work alone: over a usable
Z range the stripe position vs Z is almost linear, which fixes the
plane's direction and the offset/height ratio but not the absolute
distance. Kept as a diagnostic.

`fabmo_client.goto()` verifies every move and re-sends a dropped one;
`set_output()` verifies output changes. A /code run sent right after
another can be accepted and silently never executed.
