// MPG handwheel pulse-stream state machine.
//
// Pure logic — no I/O, no machine handle. The device adapter feeds it pulses
// via recordPulse() on each HID event and calls tick() at TICK_HZ. tick()
// returns a (possibly empty) list of intents which the adapter executes
// through pendant/actions.js: { type:"nudge", axis, ticks, stepSize, speed }
// → actions.jog, { type:"start", axis, speed, ratio } → actions.jogStart,
// { type:"stop" } → actions.jogStop.
//
// Two behaviors blended (per user spec):
//   - Step mode (selector at 0.001/0.01/0.1/1.0 step size):
//       slow turn → one nudge per pulse-batch (per tick)
//       fast turn → velocity-jog (jgv) at a feedrate that tracks wheel speed,
//                   scaled by the selected step size as a per-step ceiling
//   - Velocity mode (selector at 60% / 100% / lead): always jgv when the wheel
//       is moving, with the selector providing a fraction-of-max ceiling
//
// Transitions are hysteretic: a fast spin enters jgv at FAST_PPS; the only
// way back to nudges (mid-gesture) is the smoothed rate dropping below
// FAST_PPS - DECAY_HYST. Otherwise jgv exits via the IDLE_MS timeout.

var TUNABLES = {
    TICK_HZ: 20,
    IDLE_MS: 120,           // pulses silent for this long → jgvStop / drain
    FAST_PPS: 15,           // pulses/sec above which step mode switches to jgv
    DECAY_HYST: 5,          // pps below FAST_PPS to drop back from jgv to nudges
    SMOOTHING_ALPHA: 0.5,   // EMA factor for pulses/sec smoothing
    MAX_IPM_FALLBACK: 60,
    NUDGE_SPEED_FRAC: 0.5,  // nudge runs at this fraction of max IPM
};

// Map step-size to a per-step-size jgv feedrate cap (fraction of max IPM).
// A 0.001 spin should still feel like fine-tuning even when the user cranks
// the wheel; 1.0 mode is allowed to hit the table-traverse ceiling.
function stepSizeCap(stepSize, maxIpm) {
    if (stepSize <= 0.001) return maxIpm * 0.10;
    if (stepSize <= 0.01) return maxIpm * 0.30;
    if (stepSize <= 0.1) return maxIpm * 0.70;
    return maxIpm;
}

function create(opts) {
    opts = opts || {};
    var TICK_HZ = opts.tickHz || TUNABLES.TICK_HZ;
    var FAST_PPS = opts.fastPps != null ? opts.fastPps : TUNABLES.FAST_PPS;
    var DECAY_HYST = opts.decayHyst != null ? opts.decayHyst : TUNABLES.DECAY_HYST;
    var IDLE_MS = opts.idleMs != null ? opts.idleMs : TUNABLES.IDLE_MS;
    var ALPHA = opts.smoothingAlpha != null ? opts.smoothingAlpha : TUNABLES.SMOOTHING_ALPHA;

    var state = {
        accumulator: 0,         // signed pulses waiting for nudge emission
        lastPulseAt: 0,         // wall ms of last non-zero pulse
        lastPulseSign: 0,       // +1 / -1 — used for jgv direction
        smoothedPps: 0,         // EMA of |pulses|/sec
        lastTickAt: 0,          // wall ms of last tick (for dt)
        activeMode: null,       // "jgv" while a firmware cycle is in flight, else null
        activeAxis: null,       // axis the active jgv was started on
    };

    function recordPulse(delta, now) {
        if (!delta) return;
        state.accumulator += delta;
        state.lastPulseAt = now;
        state.lastPulseSign = delta > 0 ? 1 : -1;
    }

    function reset() {
        state.accumulator = 0;
        state.smoothedPps = 0;
        state.activeMode = null;
        state.activeAxis = null;
        state.lastPulseSign = 0;
    }

    // Decide intents for this tick given current selector state.
    //   axis    — selected axis name (X/Y/Z/A/B/C) or null
    //   feed    — { stepSize, percent, lead? } or null
    //   maxIpm  — ceiling for jgv feedrate (config.manual.xy_speed * 60)
    //   now     — wall ms timestamp
    function tick(axis, feed, maxIpm, now) {
        maxIpm = maxIpm || TUNABLES.MAX_IPM_FALLBACK;

        var dt = state.lastTickAt ? (now - state.lastTickAt) / 1000 : 1 / TICK_HZ;
        state.lastTickAt = now;
        if (dt <= 0) dt = 1 / TICK_HZ;

        // Update smoothed pulses/sec. |accumulator| isn't strictly the pulse
        // count (it's net signed), but at human spin rates pulses don't
        // reverse mid-tick — |net| matches count closely enough.
        var pps = Math.abs(state.accumulator) / dt;
        state.smoothedPps = ALPHA * pps + (1 - ALPHA) * state.smoothedPps;

        // Idle: no pulses for IDLE_MS → wrap up the gesture.
        if (state.lastPulseAt && now - state.lastPulseAt > IDLE_MS) {
            var idleIntents = [];
            if (state.activeMode !== "jgv" &&
                state.accumulator !== 0 &&
                feed && feed.stepSize != null && axis) {
                idleIntents.push(makeNudge(axis, state.accumulator, feed.stepSize, maxIpm));
            }
            if (state.activeMode === "jgv") {
                idleIntents.push({ type: "stop" });
            }
            state.smoothedPps = 0;
            state.accumulator = 0;
            state.activeMode = null;
            state.activeAxis = null;
            return idleIntents;
        }

        // No axis or no feed selected → cannot jog. Stop any active cycle.
        if (!axis || !feed) {
            if (state.activeMode === "jgv") {
                state.activeMode = null;
                state.activeAxis = null;
                state.accumulator = 0;
                state.smoothedPps = 0;
                return [{ type: "stop" }];
            }
            return [];
        }

        var velocityOnly = feed.stepSize == null;
        var wantJgv;
        if (velocityOnly) {
            // Velocity mode: any motion keeps jgv alive (idle handler stops it).
            wantJgv = state.smoothedPps > 0 || state.activeMode === "jgv";
        } else if (state.activeMode === "jgv") {
            // Hysteresis on the way down — only drop out of jgv once smoothed
            // rate has clearly fallen below FAST_PPS.
            wantJgv = state.smoothedPps >= FAST_PPS - DECAY_HYST;
        } else {
            wantJgv = state.smoothedPps >= FAST_PPS;
        }

        if (wantJgv) {
            var speed = computeJgvSpeed(feed, state.smoothedPps, maxIpm);
            if (!speed) {
                if (state.activeMode === "jgv") {
                    state.activeMode = null;
                    state.activeAxis = null;
                    state.accumulator = 0;
                    return [{ type: "stop" }];
                }
                return [];
            }
            var sign = state.lastPulseSign || 1;
            state.accumulator = 0;  // pulses became velocity, don't re-emit as nudges
            state.activeMode = "jgv";
            state.activeAxis = axis;
            return [{ type: "start", axis: axis, speed: speed, ratio: sign }];
        }

        // Nudge mode (step selector + smoothed rate below threshold).
        if (state.activeMode === "jgv") {
            // Decay path: leave jgv first; the user can resume nudges on the
            // next pulse. We deliberately drop the current tick's accumulator
            // since those pulses contributed to the (now-stopping) velocity.
            state.activeMode = null;
            state.activeAxis = null;
            state.accumulator = 0;
            return [{ type: "stop" }];
        }
        if (state.accumulator !== 0 && feed.stepSize != null) {
            var intent = makeNudge(axis, state.accumulator, feed.stepSize, maxIpm);
            state.accumulator = 0;
            state.activeAxis = axis;
            return [intent];
        }
        return [];
    }

    function makeNudge(axis, ticks, stepSize, maxIpm) {
        return {
            type: "nudge",
            axis: axis,
            ticks: ticks,
            stepSize: stepSize,
            speed: maxIpm * TUNABLES.NUDGE_SPEED_FRAC,
        };
    }

    function computeJgvSpeed(feed, smoothedPps, maxIpm) {
        if (feed.lead) return maxIpm;
        if (feed.stepSize == null) {
            // 60% / 100% positions: cap = selector ratio of max.
            return maxIpm * (feed.percent / 100);
        }
        // Step-mode fast-spin: cap by step-size (per stepSizeCap) and also by
        // a physical "spin rate × step size" estimate, so the feedrate scales
        // smoothly with how hard the user cranks the wheel rather than
        // snapping to the per-step ceiling.
        var perStepCap = stepSizeCap(feed.stepSize, maxIpm);
        var fromRate = smoothedPps * feed.stepSize * 60;
        return Math.min(perStepCap, Math.max(fromRate, 0), maxIpm);
    }

    // Called when the axis selector changes mid-gesture. Returns a {type:"stop"}
    // intent (or null) the adapter should execute before applying the new axis.
    function onAxisChange(newAxis) {
        var changed = state.activeAxis && newAxis !== state.activeAxis;
        if (!changed) return null;
        var hadJgv = state.activeMode === "jgv";
        state.activeMode = null;
        state.activeAxis = null;
        state.accumulator = 0;
        state.smoothedPps = 0;
        return hadJgv ? { type: "stop" } : null;
    }

    function getState() {
        return state;
    }

    return {
        recordPulse: recordPulse,
        tick: tick,
        reset: reset,
        onAxisChange: onAxisChange,
        getState: getState,
    };
}

module.exports = {
    TUNABLES: TUNABLES,
    stepSizeCap: stepSizeCap,
    create: create,
};
