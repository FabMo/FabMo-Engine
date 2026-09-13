/*
 * runtime/position_trigger.js
 *
 * Position-based output triggering: drive an output when an axis crosses a
 * configured threshold. Configuration lives with the rest of the per-output
 * policy in machine.outputs:
 *
 *   on_mode:  "position", on_position:  { axis: "z", side: "below", value: 0.5 }
 *   off_mode: "position", off_position: { axis: "z", side: "above", value: 0.5 }
 *
 * Positions come from G2 status reports (working coordinates, current units),
 * so worst-case trigger latency is one status-report interval (si, 100ms)
 * plus the command round trip. The listener is attached directly to the
 * driver's "status" event, which fires synchronously inside the status-report
 * handler — ahead of the heavier machine.js status fan-out — and the out
 * command goes down the JSON command channel, which preempts queued g-code.
 * This is adequate for spin-up-class actuators (pneumatic drill heads, dust
 * collection); anything needing cut-synchronized precision (plasma) would
 * need a firmware-side position compare instead.
 *
 * Triggers are edge-based with hysteresis: an output fires once when its
 * condition becomes true and re-arms only after the axis backs out past the
 * threshold by a small deadband, so an SO command in a file can still
 * override the output until the next genuine crossing. The first status
 * report after startup (or after the trigger is reconfigured) establishes a
 * baseline without firing — outputs never fire just because the machine was
 * already parked in the zone when the trigger came into effect.
 *
 * Triggers are live whenever position is reported — files, jogs, keypad
 * moves — matching "whenever Z goes below 0.5" semantics.
 */
"use strict";

var log = require("../log").logger("position_trigger");

// Same exclusions as output_policy.js: outputs 1, 2, 4 are hardcoded
// (spindles, arm motion) and never position-triggered.
var POLICY_OUTPUTS = [3, 5, 6, 7, 8, 9, 10, 11, 12];
var AXES = { x: true, y: true, z: true, a: true, b: true, c: true };

// Hysteresis: once fired, a trigger re-arms only after the axis crosses back
// past the threshold by this much (current units; also used as-is for
// rotary/degree axes, where it is conservatively small).
var DEADBAND = { in: 0.01, mm: 0.25 };

var machine = null;

// Per-trigger state, keyed "<n>:<on|off>":
//   { params: "<axis>|<side>|<value>", active: bool }
// A missing entry (or a params mismatch after reconfiguration) means the
// next report baselines `active` from the current position without firing.
var triggers = {};

function getOutputs() {
    var config = require("../config");
    return (config.machine && config.machine.get && config.machine.get("outputs")) || null;
}

// True when pos satisfies the condition, widened by `slack` on the release
// side so the active state persists through the deadband.
function condTrue(side, pos, thresh, slack) {
    return side === "above" ? pos > thresh - slack : pos < thresh + slack;
}

function drive(n, value, cond, pos, thresh) {
    var cmd = {};
    cmd["out" + n] = value;
    machine.driver.command(cmd);
    // Overshoot = how far past the threshold the axis was when we saw the
    // crossing; the real-world latency figure for this feature.
    log.info(
        "position trigger: out" +
            n +
            " -> " +
            value +
            " (" +
            cond.axis +
            "=" +
            pos.toFixed(4) +
            " " +
            cond.side +
            " " +
            thresh +
            ", overshoot " +
            Math.abs(pos - thresh).toFixed(4) +
            ")",
    );
}

function evalTrigger(n, side, cond, value, status) {
    if (!cond || !AXES[cond.axis]) return;
    var thresh = Number(cond.value);
    if (!isFinite(thresh)) return;
    var pos = status["pos" + cond.axis];
    if (typeof pos !== "number" || !isFinite(pos)) return;

    var key = n + ":" + side;
    var params = cond.axis + "|" + cond.side + "|" + thresh;
    var s = triggers[key];
    if (!s || s.params !== params) {
        triggers[key] = { params: params, active: condTrue(cond.side, pos, thresh, 0) };
        return;
    }
    if (!s.active) {
        if (condTrue(cond.side, pos, thresh, 0)) {
            s.active = true;
            drive(n, value, cond, pos, thresh);
        }
    } else if (!condTrue(cond.side, pos, thresh, DEADBAND[status.unit] || DEADBAND.in)) {
        s.active = false;
    }
}

function onStatus(status) {
    recordCadence(status);
    var outputs = getOutputs();
    if (!outputs) return;
    for (var i = 0; i < POLICY_OUTPUTS.length; i++) {
        var n = POLICY_OUTPUTS[i];
        var p = outputs[String(n)];
        if (!p) continue;
        if (p.on_mode === "position") evalTrigger(n, "on", p.on_position, 1, status);
        if (p.off_mode === "position") evalTrigger(n, "off", p.off_position, 0, status);
    }
}

/*
 * Status-report cadence instrumentation.
 *
 * The latency budget for a position trigger is one status-report gap plus
 * the command round trip, so this measures the gaps between consecutive
 * reports while motion is running (stat 5). A summary line goes to the log
 * when each run ends (and every 5000 samples mid-run for long jobs):
 *
 *   sr cadence (run ended): n=1843 mean=100.4ms max=142ms >150ms:0 ...
 *
 * Consistent ~100ms means the design holds; counts in the >1s/>2s buckets
 * mean the engine process stalled and the trigger fired late by that much.
 */
var STAT_RUNNING = 5;
var srStats = null;
var lastSrTime = null;
var lastStat = null;

function recordCadence(status) {
    var now = Date.now();
    var stat = status.stat;
    if (stat === STAT_RUNNING && lastStat === STAT_RUNNING && lastSrTime !== null) {
        var gap = now - lastSrTime;
        if (!srStats) {
            srStats = { n: 0, sum: 0, max: 0, over150: 0, over250: 0, over500: 0, over1000: 0, over2000: 0 };
        }
        srStats.n++;
        srStats.sum += gap;
        if (gap > srStats.max) srStats.max = gap;
        if (gap > 150) srStats.over150++;
        if (gap > 250) srStats.over250++;
        if (gap > 500) srStats.over500++;
        if (gap > 1000) srStats.over1000++;
        if (gap > 2000) srStats.over2000++;
        if (srStats.n >= 5000) flushCadence("5000 samples");
    } else if (stat !== STAT_RUNNING && lastStat === STAT_RUNNING) {
        flushCadence("run ended");
    }
    lastSrTime = now;
    lastStat = stat;
}

function flushCadence(why) {
    // Below ~20 samples (a couple seconds of motion) the summary is noise.
    if (srStats && srStats.n >= 20) {
        log.info(
            "sr cadence (" +
                why +
                "): n=" +
                srStats.n +
                " mean=" +
                (srStats.sum / srStats.n).toFixed(1) +
                "ms" +
                " max=" +
                srStats.max +
                "ms" +
                " >150ms:" +
                srStats.over150 +
                " >250ms:" +
                srStats.over250 +
                " >500ms:" +
                srStats.over500 +
                " >1s:" +
                srStats.over1000 +
                " >2s:" +
                srStats.over2000,
        );
    }
    srStats = null;
}

function init(m) {
    machine = m;
    machine.driver.on("status", onStatus);
    log.info("Position trigger watcher attached to driver status reports");
}

exports.init = init;
