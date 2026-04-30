/*
 * runtime/output_policy.js
 *
 * Per-output ON/OFF policy enforcement at file-start and file-end transitions.
 * Configuration lives at machine.outputs (see profiles/default/config/machine.json):
 *   { "<N>": { label, on_mode, off_mode, on_seconds, off_seconds } }
 *
 * Supported modes (this branch — "input_trigger" reserved for follow-up):
 *   on_mode:  "file_start" | "command" | "timed_after_file_end"
 *   off_mode: "file_end"   | "command" | "timed_after_file_end"
 *
 * Outputs 1, 2, 4 are hardcoded (Spindle 1, Spindle 2, Arm Motion) and the
 * runtime ignores their policy entirely — their existing behavior in machine.js
 * (notably out4:0 at file end) is unchanged.
 *
 * `command` mode means the runtime takes no automatic action; the SO command
 * (always permitted) is the only way to drive the output. SO commands are not
 * gated by policy.
 */
"use strict";

var log = require("../log").logger("output_policy");

var HARDCODED = { 1: true, 2: true, 4: true };
var POLICY_OUTPUTS = [3, 5, 6, 7, 8, 9, 10, 11, 12];

// Pending timers from the most recent file-end. Keyed by `<n>:<on|off>` so
// each output can have at most one queued action per direction. Cleared on
// the next file-start so timers don't fire mid-job.
var pendingTimers = {};

function clearPending() {
    Object.keys(pendingTimers).forEach(function (key) {
        clearTimeout(pendingTimers[key]);
        delete pendingTimers[key];
    });
}

function driveOutput(machine, n, value) {
    var cmd = {};
    cmd["out" + n] = value;
    machine.driver.command(cmd);
    log.debug("output policy: out" + n + " -> " + value);
}

function getPolicy(n) {
    var config = require("../config");
    var outputs = config.machine && config.machine.get && config.machine.get("outputs");
    if (!outputs) return null;
    return outputs[String(n)] || null;
}

// File start: cancel any pending timed actions from the previous job, then
// drive ON for any output whose on_mode is "file_start".
function onFileStart(machine) {
    clearPending();
    POLICY_OUTPUTS.forEach(function (n) {
        if (HARDCODED[n]) return;
        var p = getPolicy(n);
        if (!p) return;
        if (p.on_mode === "file_start") {
            driveOutput(machine, n, 1);
        }
    });
}

// File end: drive OFF for "file_end" off_mode immediately. Schedule timed
// actions for either side configured with "timed_after_file_end". A non-
// positive on_seconds/off_seconds is treated as immediate.
function onFileEnd(machine) {
    POLICY_OUTPUTS.forEach(function (n) {
        if (HARDCODED[n]) return;
        var p = getPolicy(n);
        if (!p) return;

        if (p.off_mode === "file_end") {
            driveOutput(machine, n, 0);
        } else if (p.off_mode === "timed_after_file_end") {
            var offSec = Number(p.off_seconds) || 0;
            scheduleTimed(machine, n, "off", offSec, 0);
        }

        if (p.on_mode === "timed_after_file_end") {
            var onSec = Number(p.on_seconds) || 0;
            scheduleTimed(machine, n, "on", onSec, 1);
        }
    });
}

function scheduleTimed(machine, n, side, seconds, value) {
    var key = n + ":" + side;
    if (pendingTimers[key]) clearTimeout(pendingTimers[key]);
    if (seconds <= 0) {
        driveOutput(machine, n, value);
        return;
    }
    pendingTimers[key] = setTimeout(function () {
        delete pendingTimers[key];
        driveOutput(machine, n, value);
    }, seconds * 1000);
}

exports.onFileStart = onFileStart;
exports.onFileEnd = onFileEnd;
