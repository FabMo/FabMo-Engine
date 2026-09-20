/*
 * runtime/output_triggers.js
 *
 * Status-report-driven output triggers: drive an output when an axis crosses
 * a configured position threshold, or when an input changes state.
 * Configuration lives with the rest of the per-output policy in
 * machine.outputs — each side (on/off) picks one mode:
 *
 *   on_mode:  "position", on_position:  { axis: "z", side: "below", value: 0.5 }
 *   off_mode: "position", off_position: { axis: "z", side: "above", value: 0.5 }
 *   on_mode:  "input",    on_input:     { input: 5, state: "on" }
 *   off_mode: "input",    off_input:    { input: 5, state: "off" }
 *
 * Binding both sides of an output to the same input with complementary
 * states gives follow ("momentary") behavior; binding one side gives a
 * latch ("permanent"). Same composition for position (ON below / OFF above).
 *
 * Positions and input states come from G2 status reports (positions in
 * working coordinates, current units), so worst-case trigger latency is one
 * status-report interval (si, 100ms) plus the command round trip — and G2
 * pushes a report immediately on an input edge, so input triggers are
 * usually faster than that. The listener is attached directly to the
 * driver's "status" event, which fires synchronously inside the status-report
 * handler — ahead of the heavier machine.js status fan-out — and the out
 * command goes down the JSON command channel, which preempts queued g-code.
 * This is adequate for spin-up-class actuators (pneumatic drill heads, dust
 * collection); anything needing cut-synchronized precision (plasma) would
 * need a firmware-side position compare instead.
 *
 * Triggers are edge-based: an output fires once when its condition becomes
 * true and re-arms only after the condition clears (position triggers add a
 * small hysteresis deadband), so an SO command in a file can still override
 * the output until the next genuine transition. The first status report
 * after startup (or after the trigger is reconfigured) establishes a
 * baseline without firing — outputs never fire just because the machine was
 * already in the zone / the input was already in the state when the trigger
 * came into effect.
 *
 * Triggers are live whenever status is reported — files, jogs, keypad
 * moves — matching "whenever Z goes below 0.5" semantics.
 */
"use strict";

var log = require("../log").logger("output_triggers");

// Same exclusions as output_policy.js: outputs 1, 2, 4 are hardcoded
// (spindles, arm motion) and never trigger-driven.
var POLICY_OUTPUTS = [3, 5, 6, 7, 8, 9, 10, 11, 12];
var AXES = { x: true, y: true, z: true, a: true, b: true, c: true };
var MAX_INPUT = 12;

// Hysteresis: once fired, a position trigger re-arms only after the axis
// crosses back past the threshold by this much (current units; also used
// as-is for rotary/degree axes, where it is conservatively small).
var DEADBAND = { in: 0.01, mm: 0.25 };

var machine = null;

// Per-trigger state, keyed "<n>:<on|off>" (a side has exactly one mode, so
// position and input triggers share the key space):
//   { params: "<condition fingerprint>", active: bool }
// A missing entry (or a params mismatch after reconfiguration) means the
// next report baselines `active` from the current status without firing.
var triggers = {};

function getOutputs() {
    var config = require("../config");
    return (config.machine && config.machine.get && config.machine.get("outputs")) || null;
}

function drive(n, value, detail) {
    var cmd = {};
    cmd["out" + n] = value;
    machine.driver.command(cmd);
    log.info("output trigger: out" + n + " -> " + value + " (" + detail + ")");
}

// Shared edge logic: look up (or baseline) the trigger's state and fire on
// the false→true transition of `condNow`. `condHold` is the same condition
// widened by any hysteresis — the trigger re-arms only when it goes false.
function edge(key, params, condNow, condHold, fire) {
    var s = triggers[key];
    if (!s || s.params !== params) {
        triggers[key] = { params: params, active: condNow };
        return;
    }
    if (!s.active) {
        if (condNow) {
            s.active = true;
            fire();
        }
    } else if (!condHold) {
        s.active = false;
    }
}

function evalPosition(n, side, cond, value, status) {
    if (!cond || !AXES[cond.axis]) return;
    var thresh = Number(cond.value);
    if (!isFinite(thresh)) return;
    var pos = status["pos" + cond.axis];
    if (typeof pos !== "number" || !isFinite(pos)) return;

    var db = DEADBAND[status.unit] || DEADBAND.in;
    var above = cond.side === "above";
    var condNow = above ? pos > thresh : pos < thresh;
    var condHold = above ? pos > thresh - db : pos < thresh + db;
    edge(n + ":" + side, "pos|" + cond.axis + "|" + cond.side + "|" + thresh, condNow, condHold, function () {
        // Overshoot = how far past the threshold the axis was when we saw
        // the crossing; the real-world latency figure for this feature.
        drive(
            n,
            value,
            cond.axis +
                "=" +
                pos.toFixed(4) +
                " " +
                cond.side +
                " " +
                thresh +
                ", overshoot " +
                Math.abs(pos - thresh).toFixed(4),
        );
    });
}

function evalInput(n, side, cond, value, status) {
    if (!cond) return;
    var inputNum = Math.round(Number(cond.input));
    if (!(inputNum >= 1 && inputNum <= MAX_INPUT)) return;
    var st = status["in" + inputNum];
    if (st === undefined || st === null) return;
    st = st ? 1 : 0;
    var want = cond.state === "off" ? 0 : 1;

    var condNow = st === want;
    edge(n + ":" + side, "in|" + inputNum + "|" + want, condNow, condNow, function () {
        drive(n, value, "input " + inputNum + " " + (want ? "on" : "off"));
    });
}

function onStatus(status) {
    recordCadence(status);
    var outputs = getOutputs();
    if (!outputs) return;
    for (var i = 0; i < POLICY_OUTPUTS.length; i++) {
        var n = POLICY_OUTPUTS[i];
        var p = outputs[String(n)];
        if (!p) continue;
        if (p.on_mode === "position") evalPosition(n, "on", p.on_position, 1, status);
        else if (p.on_mode === "input") evalInput(n, "on", p.on_input, 1, status);
        if (p.off_mode === "position") evalPosition(n, "off", p.off_position, 0, status);
        else if (p.off_mode === "input") evalInput(n, "off", p.off_input, 0, status);
    }
}

/*
 * Status-report cadence instrumentation.
 *
 * The latency budget for a status-driven trigger is one status-report gap
 * plus the command round trip, so this measures the gaps between consecutive
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
    log.info("Output trigger watcher attached to driver status reports");
}

exports.init = init;
