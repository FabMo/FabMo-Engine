# Keypad / manual-drive architecture review (Oct 2026)

Why this document: after shipping four runaway-class fixes in two months
(#1567 blur, #1568 disconnect deadman, #1570 rollover timer, plus the Oct 12
burst-out fix), the question was raised whether JS-level fixes are the right
approach at all, or whether the client side has grown too complicated to be
trusted with motion safety. This is the review that answered it and the design
rationale for the `feature/keypad-jgv-rework` prototype.

## The stack today

```
browser gesture JS ──socket.io──> manual runtime ──USB serial──> G2 planner
keyboard.js (557 lines, 18 state fields)      ManualDriver (1,498 lines,
keypad.js   (946 lines, 21 state fields,      ~12 lifecycle flags, renewal
             19 event bindings)                timers, nudge queue, JS
pendant (3rd gesture implementation)           envelope math)
```

34 commits touched this stack in 2026, 12 since September — nearly all fixes:
blur runaway, disconnect deadman, rollover runaway, nudge burst-out, goto-hold
phantom resume, exit lockup, limit-release wedge, dead nudge buttons.

## Why the fixes never stop coming

Every runaway bug is the same bug in different clothes. The protocol is
**"presence of stop = stop"**: once continuous motion starts, the server's
renewal loop self-sustains and the only brakes are an affirmative client stop
or a socket disconnect. Every way a browser can lose an event — blur, tab
switch, key rollover, a swallowed keyup, a wedged iframe — becomes a new
runaway, patched one at a time. Browsers can lose events in unbounded ways.

Compounding it: three state machines (browser gesture logic, ManualDriver,
G2's planner/feedhold) synchronized over two async hops, where "stop" is not
atomic — it is the `!` + `%` feedhold/flush dance, which races queued gcode
(the origin of `stop_pending`, the burst-out bug, and held-planner buffering).
The root cause of *that* is the G1 segment pump: we fake velocity control over
a position-based planner by queuing segment batches ahead, so there is always
queued future motion that stopping must claw back.

## The fix is inverting the default, not better JS

The safe model is **"absence of intent = stop"**: motion continues only while
a heartbeat arrives, at every layer. Then a client bug can only ever cause a
stop, never a run. We already built this model for the pendant:

**`cycle_jgv`** (g2core, in FabMo-G2-Core main since May 2026, present in the
shipped `101.57.66/.67` bins): the host streams `{"jgv":{"z":-120}}` velocity
setpoints; the firmware does jerk-limited ramps, per-axis soft-limit clamping,
accepts mid-flight direction flips with no feedhold/flush at all, and ramps to
a stop on its own after 500 ms of host silence (`$jvto` watchdog). The engine
side (`g2.jogVelocity()`, the `analogMode` path in ManualDriver) has been
exercised by the F310 analog stick for months. The keypad misses it only
because the dashboard sends `{cmd:"start", speed}` instead of ratios.

## The plan (this prototype implements all three)

1. **Server motion lease** (legacy G1 path, protects old firmware and every
   client forever): `keep_moving` is consumed by each renewal tick and must be
   re-asserted by the client's existing ~50 ms keep-alive stream; two missed
   windows ⇒ stop. Worst-case runaway drops from "forever" to roughly one
   renewal batch, for every present and future client bug.

2. **Route keypad continuous jog through jgv**, translated server-side in
   `startMotion` (zero client protocol change — the on-screen keypad and the
   keyboard both benefit immediately), gated on a firmware capability probe
   with the legacy path as permanent fallback. Stop becomes a decel ramp;
   direction flips become a velocity update (rapid Z tapping is then trivially
   correct *and* more responsive); the firmware watchdog backstops everything.
   Fixed-mode nudges stay as bounded G1 moves — bounded motion is already
   fail-safe; queue caps and TTL cover it.

3. **One client gesture state machine** (`jogintent.js`) owning tap-vs-hold,
   rollover, and the "no keys down ⇒ nothing live" invariant, with the input
   sources reduced to thin adapters. There will always be gesture JS — that is
   UI — but it should be a dumb intent encoder small enough to audit, not two
   parallel 500–900 line modules with ~40 flags between them.

## Known risks / open items

- jgv coupling: dashboard jog behaves differently on an unflashed board, so
  the capability probe + legacy fallback are permanent, not transitional.
- The jgv soft-limit velocity-cap constants were tuned at pendant speeds; a
  keypad-speed pass is needed (and the cap should use `z_jerk` for Z, not
  `xy_jerk` — fixed in this prototype).
- `keypad.js` (on-screen) conversion to `jogintent.js` is a follow-up; the
  server-side changes protect it in the meantime.
- Pendant digital (non-analog) holds and any fabmo.js app callers must stream
  keep-alives to live under the lease — verified for the shipped pendants in
  this prototype; documented for app authors.
