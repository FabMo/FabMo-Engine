# Canned Cuts — design notes

Goal: replace common woodshop tools (chop saw, drill press, table saw,
router table) with pendant-triggered canned operations that cut at the
current machine position. The pendant + future small screen gives a
near-headless workflow.

This document describes the prototype shipped on `feature/canned-cuts`
and the path from here to the full vision.

---

## Architecture

Three layers, kept deliberately separate so each can be tested or
extended on its own.

```
┌─────────────────────────────────────────────────────────────────────┐
│  Pure G-code generators           runtime/manual/cannedCuts/        │
│  - circularBore(params) -> {gcode, summary}                          │
│  - (future) drill, rectangle, line, helix, ...                       │
│  No engine coupling, no I/O. Tested in isolation with jest.          │
└─────────────────────────────────────────────────────────────────────┘
                              ▲
                              │ generates G-code
                              │
┌─────────────────────────────────────────────────────────────────────┐
│  Controller / state machine       pendant/cannedCutsController.js    │
│  - State: idle | active | executing                                  │
│  - Holds the current cutType + param object                          │
│  - toggle() / adjustParam(name, delta) / commit() / cancel()         │
│  - On commit: reads machine.status for XY/Z, writes /tmp file,       │
│    calls machine.runFile(file, bypassInterlock=true)                 │
│  - Emits canned_cut_state events                                     │
└─────────────────────────────────────────────────────────────────────┘
                              ▲
                              │ method calls
                              │
┌─────────────────────────────────────────────────────────────────────┐
│  Device adapters                  pendant/devices/                   │
│  - F310 wires LSTICK/RSTICK/D-pad to controller methods             │
│  - (Future) XHC pendant could expose the same triggers              │
│  - (Future) dashboard app could call setParam / commit via WS       │
└─────────────────────────────────────────────────────────────────────┘
```

Event flow back to clients:

```
controller emits canned_cut_state
   → machine.emit('canned_cut_state', payload)
   → routes/websocket.js broadcasts to / and /private
   → fabmoapi.js .on('canned_cut_state', cb) on any dashboard
```

## What's implemented

| Layer                 | Status | Notes                                                       |
| --------------------- | ------ | ----------------------------------------------------------- |
| circularBore() pure   | ✅      | pocket + perimeter modes, depth passes, G2/G3, validation   |
| Controller state mach | ✅      | toggle, adjust, commit, cancel, executing→active on idle    |
| F310 input            | ✅      | LSTICK toggle, RSTICK commit, D-pad context-switched        |
| WebSocket relay       | ✅      | canned_cut_state forwarded to dashboard listeners           |
| Jest coverage         | ✅      | 28 tests across pure generator + controller                 |
| Dashboard UI          | ❌      | nothing yet — events are emitted but no consumer            |
| Pendant LCD readout   | ❌      | XHC LCD has fixed numeric fields — see Known limits         |
| Drill / rectangle /   | ❌      | only circular_bore today; controller has type slot          |
|   line / helix cuts   |        |                                                             |
| Camera target picking | ❌      | calibration exists; click→coords→commit bridge missing      |
| ArUco target picking  | ❌      | no ArUco code in the codebase at all                        |
| Per-cut config in     | ❌      | params are hardcoded defaults in DEFAULT_PARAMS today       |
|   machine.json        |        |                                                             |

## F310 button mapping (prototype)

| Button       | Idle state       | Cut mode active                  |
| ------------ | ---------------- | -------------------------------- |
| LSTICK click | enter cut mode   | exit cut mode (no commit)        |
| RSTICK click | (unbound)        | commit cut at current position   |
| D-pad ↑      | jog +Y           | diameter +0.0625" (1/16)          |
| D-pad ↓      | jog -Y           | diameter -0.0625"                 |
| D-pad ←      | jog -X           | depth -0.0625"                    |
| D-pad →      | jog +X           | depth +0.0625"                    |
| All others   | unchanged        | unchanged                         |

Reasoning: LSTICK + RSTICK are the only buttons unused across both F310
modes (D and X). D-pad context-switching reuses an existing physical
control rather than burning more buttons; the controller's state flag
gates which behavior fires.

To add per-param adjust (e.g. plunge-per-pass, cutter diameter), bind
LB or RB *while in cut mode* as a "param cursor" modifier and rotate
through which value the D-pad targets. Out of scope for the prototype.

## Default parameters

Defined in `pendant/cannedCutsController.js` → `DEFAULT_PARAMS`. For
`circular_bore`:

```js
{
    diameter: 0.5,        // bore diameter in display units (inches)
    depth: 0.25,          // total cut depth below current Z
    plungePerPass: 0.125, // Z step per pass
    cutterDiameter: 0.25, // tool diameter for compensation
    feedRateXY: 60,       // IPM
    feedRateZ: 30,        // IPM
    safeZ: 0.5,           // retract above startZ
    mode: "pocket",       // "pocket" | "perimeter"
    pocketOverlap: 0.5,   // stepOver = cutterDia * (1 - overlap)
    direction: "cw",      // G2 (cw) or G3 (ccw)
}
```

Hard bounds enforced in `BOUNDS`: diameter [0.0625, 12], depth [0.01, 4],
plungePerPass [0.01, 0.5], cutterDiameter [0.0625, 1.0].

## Execution path

When the user commits:

1. Controller reads `machine.status.{posx, posy, posz}` for the center
   and starting Z.
2. Calls `circularBore({ ...params, center, startZ })` → array of G-code
   lines + summary.
3. Writes the G-code to `/tmp/fabmo-canned-cuts/canned-<type>-<ts>.nc`.
4. Calls `machine.runFile(filename, true)` — `bypassInterlock=true`
   matches the macro-press privilege model (this is operator-driven).
5. Engine transitions to file-running runtime, executes, returns to idle.
6. Controller's status listener sees `state === 'idle'` and transitions
   from `executing` back to `active` so the next commit doesn't need a
   re-toggle.

After the cut, the machine is **not** in manual mode — `runFile` is a
full mode change. Re-press LB on the F310 (manual toggle) if you want
to jog again. This is consistent with how macros behave; if it proves
awkward, see "Re-enter manual automatically" in Open questions.

## Extending: adding a new cut type

1. Add `runtime/manual/cannedCuts/<newCut>.js` exporting a pure function:
   ```js
   function newCut({center, startZ, ...params}) {
       return { gcode: [...], summary: {...} };
   }
   ```
2. Add it to `runtime/manual/cannedCuts/index.js` exports.
3. Add a defaults entry in `DEFAULT_PARAMS` in
   `pendant/cannedCutsController.js`.
4. Extend `commit()` switch to call the new generator.
5. Add a way to select between cut types — TBD; suggestion: cycle on
   LB press while in cut mode (current cut type displayed on LCD/screen).
6. Add jest tests under `test/cannedCuts.<newCut>.test.js`.

The pure-function layer is the only place where geometry math lives.
Controller, pendant, and dashboard are all geometry-agnostic.

## How camera / ArUco picking would attach

(See `survey of camera and ArUco integration` in the work log; in short,
the calibration data structure exists but no homography→motion bridge.)

The cleanest integration point: a new method on the controller that
takes an absolute target instead of using current position:

```js
controller.commitAt({ x, y }, { startZ })   // skips machine.status read
```

Workflow:
1. User clicks a point on the video feed (or ArUco marker detected).
2. Dashboard app converts pixel → work-coord via existing homography
   in `previewer.fma/js/viewer.js:_h_inverse3`.
3. Dashboard calls `commitAt({x, y})` over WS (new command).
4. Controller generates G-code with target as center (G0 there first,
   then the cut sequence).

Required new code:
- WS command handler (`routes/websocket.js`) for `canned_cut_commit_at`.
- Homography utility extracted from viewer.js into a shared module.
- Dashboard app (or extension of video.fma) with the click handler.
- ArUco detection module (would add ~200 LOC; OpenCV bindings or
  WASM-aruco library).

None of that is needed for the F310 + current-position workflow shipping
in this prototype.

## Known limitations

1. **No undo / no preview.** Commit is immediate. Future: emit a
   ghost-run G-code preview to the dashboard before the user confirms.
2. **Single cut at a time.** Multiple sequential commits work but no
   queueing or batching. Programming a "drill pattern at marked points"
   needs a separate workflow.
3. **No cutter library.** `cutterDiameter` is per-cut. Real shops want
   a tool table that the cut reads from. Future: add a tool field and
   look up diameter from a config.machine.tools table.
4. **No coolant / spindle interlock.** The generated G-code assumes
   the user has the spindle on. Future: emit M3 / M5 sandwiching the
   cut moves.
5. **Pendant LCD readout impossible.** The XHC LCD has fixed numeric
   fields (no arbitrary text), so we can't show "diameter 0.5" on it.
   Phone-as-display via WS is the realistic readout path until
   dedicated hardware arrives.
6. **No retract-after-error.** If the G-code fails mid-cut, retract
   behavior is whatever the engine does on a runtime error. Worth
   adding an explicit safe-Z retract in error recovery.

## Open design questions

- **Cycle through cut types — how?** Once we have drill / rectangle /
  line, the F310 needs a way to pick which is "armed." LB press while
  in active mode is the obvious slot; would need to revisit the
  manual-mode-toggle behavior on LB.
- **Re-enter manual automatically?** When the cut finishes, currently
  the machine is in idle (not manual). The pendant could auto-toggle
  back to manual to make the workflow seamless — but that's a state
  injection that might confuse the dashboard's mode indicator.
- **Where do per-cut overrides live?** Currently `DEFAULT_PARAMS` are
  in code. The natural home is `config.machine.cannedCuts.<type>`.
- **Camera vs. current-position as the default UX.** The current-
  position workflow is fastest (jog + commit). Camera picking is
  more visual but requires looking at a screen. Likely both should
  coexist, with the gamepad workflow being the default.

## File index

- `runtime/manual/cannedCuts/circularBore.js` — pure G-code generator
- `runtime/manual/cannedCuts/index.js` — barrel export
- `pendant/cannedCutsController.js` — state machine + commit
- `pendant/index.js` — wires shared controller into ctx
- `pendant/devices/logitech-f310/index.js` — F310 bindings + D-pad ctx
- `routes/websocket.js` — `canned_cut_state` broadcast
- `dashboard/static/js/libs/fabmoapi.js` — client-side event registration
- `test/cannedCuts.circularBore.test.js` — 17 jest tests
- `test/pendant.cannedCutsController.test.js` — 11 jest tests
