// MPG handwheel pulse-stream state machine.
//
// Pure logic — no I/O, no machine handle. The device adapter feeds it pulses
// via recordPulse() on each HID event and calls tick() at TICK_HZ. tick()
// returns a (possibly empty) list of intents which the adapter executes
// through pendant/actions.js: { type:"nudge", axis, ticks, stepSize, speed }
// → actions.jog, { type:"start", axis, speed, ratio } → actions.jogStart,
// { type:"stop" } → actions.jogStop.
//
// Wheel mode is chosen explicitly by the pendant's Continuous / Step buttons
// and passed in to tick(). The feed selector is dual-labeled on the device:
//   - Step positions (0.001 / 0.01 / 0.1 / 1.0) carry stepSize, no percent
//   - Continuous positions (60% / 100% / Lead) carry percent (or lead), no
//     stepSize
// A selector position whose label doesn't match the active mode disables
// jogging — e.g. step mode with the selector at 60% is a no-op.

var TUNABLES = {
    TICK_HZ: 20,
    IDLE_MS: 120,           // jgv pulses silent for this long → stop
    MAX_IPM_FALLBACK: 60,
    NUDGE_SPEED_FRAC: 0.5,  // step-mode nudge runs at this fraction of max IPM
    // Step-mode snap: if no step-mode pulse arrives for this long, drop the
    // planned-position cache so the next detent re-seeds from the live
    // machine position. Catches the user moving the axis by other means
    // (dashboard, gamepad, keypad) between wheel touches.
    PLANNED_POS_IDLE_MS: 1500,
};

// Snap a single nudge tick. Returns the signed distance from basePos to the
// next grid line in `direction` (+1 / -1) at `stepSize` spacing. When basePos
// is already on the grid, advance one full increment so taps don't no-op —
// matches driver.js snapNudgeDistance for parity with the keypad-style snap.
function snapOneTick(basePos, direction, stepSize) {
    var EPSILON = 1e-6;
    var posInGrid = basePos / stepSize;
    var line;
    if (direction > 0) {
        line = Math.ceil(posInGrid);
        if (Math.abs(line - posInGrid) < EPSILON) line += 1;
    } else {
        line = Math.floor(posInGrid);
        if (Math.abs(line - posInGrid) < EPSILON) line -= 1;
    }
    return line * stepSize - basePos;
}

function create(opts) {
    opts = opts || {};
    var TICK_HZ = opts.tickHz || TUNABLES.TICK_HZ;
    var IDLE_MS = opts.idleMs != null ? opts.idleMs : TUNABLES.IDLE_MS;

    var state = {
        accumulator: 0,         // signed pulses waiting for nudge emission
        lastPulseAt: 0,         // wall ms of last non-zero pulse
        lastPulseSign: 0,       // +1 / -1 — used for jgv direction
        lastTickAt: 0,          // wall ms of last tick (for dt — unused but kept for telemetry)
        activeMode: null,       // "jgv" while a firmware cycle is in flight, else null
        activeAxis: null,       // axis the active jgv was started on
        prevWheelMode: null,    // wheelMode from previous tick — used to detect a switch
        // Per-axis planned position used by step-mode snap. Seeded from the
        // live machine position on first detent; advanced by snapped distance
        // each subsequent detent so taps land on consecutive grid lines
        // instead of all snapping to the same line (which would happen if we
        // read the live position mid-motion). Cleared on axis change, mode
        // change, and after PLANNED_POS_IDLE_MS without a step pulse.
        plannedPos: {},
        plannedPosTouchedAt: 0,
    };

    // Compute the snapped distance for an N-tick step-mode nudge on `axis` and
    // advance the planned position. Falls back to `currentPos` only when the
    // plan is empty or stale.
    function snapStepNudge(axis, ticks, stepSize, currentPos, now) {
        if (!stepSize || !ticks) return 0;
        if (state.plannedPosTouchedAt && now - state.plannedPosTouchedAt > TUNABLES.PLANNED_POS_IDLE_MS) {
            state.plannedPos = {};
        }
        var basePos = state.plannedPos[axis];
        if (basePos === undefined || basePos === null) {
            if (currentPos === undefined || currentPos === null) {
                return ticks * stepSize;
            }
            basePos = currentPos;
        }
        var direction = ticks > 0 ? 1 : -1;
        var nTicks = Math.abs(ticks);
        var pos = basePos;
        for (var i = 0; i < nTicks; i++) {
            pos += snapOneTick(pos, direction, stepSize);
        }
        state.plannedPos[axis] = pos;
        state.plannedPosTouchedAt = now;
        return pos - basePos;
    }

    function recordPulse(delta, now) {
        if (!delta) return;
        state.accumulator += delta;
        state.lastPulseAt = now;
        state.lastPulseSign = delta > 0 ? 1 : -1;
    }

    // Record a pulse AND, if we're in step mode with a valid selector, emit
    // a nudge intent immediately rather than waiting for the next tick. This
    // is what gives step mode a crisp 1-click-per-detent feel — the 50ms
    // tick interval would otherwise collapse fast clicks into single moves.
    // Continuous-mode pulses fall through to the tick loop unchanged.
    //
    // `currentPos` is the live machine position for `axis` — used only to
    // seed snapStepNudge when no planned position exists yet.
    function consumePulse(delta, axis, feed, maxIpm, wheelMode, now, currentPos) {
        if (!delta) return [];
        state.accumulator += delta;
        state.lastPulseAt = now;
        state.lastPulseSign = delta > 0 ? 1 : -1;

        if (wheelMode !== "step") return [];
        if (!axis || !feed) return [];
        var stepSize = effectiveStepSize(feed);
        if (stepSize == null) return [];

        var ticks = state.accumulator;
        var distance = snapStepNudge(axis, ticks, stepSize, currentPos, now);
        if (distance === 0) {
            state.accumulator = 0;
            return [];
        }
        var intent = {
            type: "nudge",
            axis: axis,
            ticks: ticks,
            stepSize: stepSize,
            distance: distance,
            speed: (maxIpm || TUNABLES.MAX_IPM_FALLBACK) * TUNABLES.NUDGE_SPEED_FRAC,
        };
        state.accumulator = 0;
        state.activeAxis = axis;
        return [intent];
    }

    // In step mode the selector's step-zone positions (0.001 / 0.01 / 0.1 / 1.0)
    // carry stepSize. The continuous-zone positions (60 / 100 / Lead) carry no
    // stepSize — in step mode we clamp them all to the largest step (1.0), so
    // rotating past 1.0 keeps stepping at 1.0 rather than disabling the wheel.
    function effectiveStepSize(feed) {
        if (!feed) return null;
        if (feed.stepSize != null) return feed.stepSize;
        return 1.0;
    }

    function reset() {
        state.accumulator = 0;
        state.activeMode = null;
        state.activeAxis = null;
        state.lastPulseSign = 0;
        state.plannedPos = {};
        state.plannedPosTouchedAt = 0;
    }

    // Decide intents for this tick given current selector and mode state.
    //   axis      — selected axis name (X/Y/Z/A/B/C) or null
    //   feed      — { stepSize, percent, lead? } or null
    //   maxIpm    — ceiling for jgv feedrate (config.manual.xy_speed * 60)
    //   now       — wall ms timestamp
    //   wheelMode — "continuous" | "step" (or null → no-op until user picks)
    //   currentPos — live machine position for `axis`, used by step-mode snap
    //                to seed the planned-position cache. May be omitted; the
    //                step nudge falls back to non-snapped distance in that case.
    function tick(axis, feed, maxIpm, now, wheelMode, currentPos) {
        maxIpm = maxIpm || TUNABLES.MAX_IPM_FALLBACK;
        state.lastTickAt = now;

        // Mode switch mid-gesture → stop any in-flight cycle before the new
        // mode's logic runs, but DON'T zero the accumulator — fresh pulses
        // that arrived during the switch should still feed the new mode.
        // Leaving step mode also drops the planned-position cache so a return
        // to step seeds fresh from the live position.
        var preface = [];
        if (state.prevWheelMode && state.prevWheelMode !== wheelMode) {
            if (state.activeMode === "jgv") {
                preface.push({ type: "stop" });
                state.activeMode = null;
                state.activeAxis = null;
            }
            state.plannedPos = {};
            state.plannedPosTouchedAt = 0;
        }
        state.prevWheelMode = wheelMode;

        // No axis, no feed, no mode → cannot jog. Stop any active cycle and drain.
        if (!axis || !feed || !wheelMode) {
            return preface.concat(drainAndMaybeStop());
        }

        var out;
        if (wheelMode === "continuous") out = tickContinuous(axis, feed, maxIpm, now);
        else if (wheelMode === "step") out = tickStep(axis, feed, maxIpm, now, currentPos);
        else out = [];
        return preface.concat(out);
    }

    // Continuous-mode tick. The feed selector is dual-labeled — step-zone
    // positions (0.001 / 0.01 / 0.1 / 1.0) double as fine continuous speeds
    // (2% / 5% / 10% / 30% of max IPM), and percent-zone positions
    // (60% / 100% / Lead) cover the upper range. Any wheel motion within
    // IDLE_MS keeps a jgv cycle alive at the selected speed; direction =
    // sign of the most recent pulse.
    function tickContinuous(axis, feed, maxIpm, now) {
        // Idle timeout: pulses stopped → end the cycle.
        if (state.lastPulseAt && now - state.lastPulseAt > IDLE_MS) {
            state.accumulator = 0;
            if (state.activeMode === "jgv") {
                state.activeMode = null;
                state.activeAxis = null;
                return [{ type: "stop" }];
            }
            return [];
        }

        // No motion yet (or fresh after a stop) → wait for a pulse.
        if (!state.lastPulseSign && state.activeMode !== "jgv") return [];

        var speed;
        if (feed.lead) speed = maxIpm;
        else if (feed.percent != null) speed = maxIpm * (feed.percent / 100);
        else speed = 0;
        if (!speed) {
            return drainAndMaybeStop();
        }
        // Pulses became velocity — don't re-emit them as nudges.
        state.accumulator = 0;
        state.activeMode = "jgv";
        state.activeAxis = axis;
        return [{ type: "start", axis: axis, speed: speed, ratio: state.lastPulseSign || 1 }];
    }

    // Step-mode tick. Selector must be at 0.001 / 0.01 / 0.1 / 1.0 (stepSize set).
    // Each accumulated pulse → one nudge of stepSize. No velocity escalation;
    // crank-fast feels just like many discrete nudges in a row.
    function tickStep(axis, feed, maxIpm, now, currentPos) {
        var stepSize = effectiveStepSize(feed);
        if (stepSize == null) {
            return drainAndMaybeStop();
        }

        if (state.accumulator === 0) return [];
        var ticks = state.accumulator;
        var distance = snapStepNudge(axis, ticks, stepSize, currentPos, now);
        state.accumulator = 0;
        if (distance === 0) return [];
        var intent = {
            type: "nudge",
            axis: axis,
            ticks: ticks,
            stepSize: stepSize,
            distance: distance,
            speed: maxIpm * TUNABLES.NUDGE_SPEED_FRAC,
        };
        state.activeAxis = axis;
        return [intent];
    }

    function drainAndMaybeStop() {
        var out = [];
        if (state.activeMode === "jgv") {
            out.push({ type: "stop" });
            state.activeMode = null;
            state.activeAxis = null;
        }
        state.accumulator = 0;
        return out;
    }

    // Called when the axis selector changes mid-gesture. Returns a {type:"stop"}
    // intent (or null) the adapter should execute before applying the new axis.
    // The previous axis's planned position is invalidated — once we're off it,
    // an external move could happen unobserved.
    function onAxisChange(newAxis) {
        var changed = state.activeAxis && newAxis !== state.activeAxis;
        if (!changed) return null;
        var hadJgv = state.activeMode === "jgv";
        if (state.activeAxis) delete state.plannedPos[state.activeAxis];
        state.activeMode = null;
        state.activeAxis = null;
        state.accumulator = 0;
        return hadJgv ? { type: "stop" } : null;
    }

    function getState() {
        return state;
    }

    void TICK_HZ;
    return {
        recordPulse: recordPulse,
        consumePulse: consumePulse,
        tick: tick,
        reset: reset,
        onAxisChange: onAxisChange,
        getState: getState,
    };
}

module.exports = {
    TUNABLES: TUNABLES,
    create: create,
};
