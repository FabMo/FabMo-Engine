/*
 * Manual-gesture log — the field record of HOW each continuous manual move
 * ended.
 *
 * A jog gesture is supposed to end because the operator let go and the
 * release event arrived. Every other ending is a backstop firing: the window
 * lost focus, the pointer was seen with no button down, the server's motion
 * lease expired, the per-gesture travel cap tripped... Each of those is a
 * release event that went missing somewhere, caught by a different net.
 *
 * This module counts every ending by reason (since engine start) and keeps
 * the abnormal ones — in memory (recent ring), in the engine log (warn), and
 * appended to a small file in the log directory so they survive a restart
 * and ride along in the diagnostic bundle (/log/bundle zips that directory).
 * It answers "is this still happening to anyone, and which net caught it".
 *
 * No dependencies on the machine or driver; safe to require anywhere.
 */
"use strict";

var fs = require("fs");
var path = require("path");
var log = require("../../log").logger("manual");

var ANOMALY_FILE = "manual-gesture-anomalies.log";
var MAX_FILE_BYTES = 256 * 1024; // rotate to .1 past this
var RING_SIZE = 100;

// Endings that mean "the release arrived normally". Everything else is
// recorded as an anomaly.
//   client:release  dashboard reported a delivered release
//   client:stop     a client that sends no reason (old cached dashboard, apps)
//   stop            server-side caller with no reason (pendant stick release,
//                   SBP-driven manual moves)
var NORMAL = { "client:release": true, "client:stop": true, stop: true };

var counts = {};
var recent = [];
var startedAt = Date.now();
var client = { ua: null, address: null };

// Remember who is driving, so an anomaly can name the browser. Called from
// the websocket layer on manual commands; cheap enough for the 20Hz stream.
function noteClient(ua, address) {
    client.ua = ua || null;
    client.address = address || null;
}

// Client-supplied tags are untrusted free text: keep them short and tame,
// and namespace them so they can't impersonate a server-side reason.
function clientReason(reason) {
    if (typeof reason !== "string" || !reason) return "client:stop";
    return "client:" + reason.replace(/[^a-zA-Z0-9_]/g, "").slice(0, 32);
}

function cleanSource(source) {
    if (typeof source !== "string" || !source) return null;
    return source.replace(/[^a-zA-Z0-9_]/g, "").slice(0, 16);
}

function isNormal(reason) {
    return NORMAL[reason] === true;
}

function anomalyPath() {
    try {
        return path.join(require("../../config").getDataDir("log"), ANOMALY_FILE);
    } catch (e) {
        return null;
    }
}

function appendAnomaly(entry) {
    var file = anomalyPath();
    if (!file) return;
    try {
        try {
            if (fs.statSync(file).size > MAX_FILE_BYTES) {
                fs.renameSync(file, file + ".1");
            }
        } catch (e) {
            /* no file yet */
        }
        fs.appendFile(file, JSON.stringify(entry) + "\n", function () {});
    } catch (e) {
        /* diagnostics must never break motion handling */
    }
}

// Record one gesture ending.
//   entry: { reason, source, path, axis, second_axis, duration_ms, travel }
function record(entry) {
    try {
        var reason = entry.reason || "stop";
        counts[reason] = (counts[reason] || 0) + 1;
        if (isNormal(reason)) {
            return;
        }
        var rec = {
            ts: new Date().toISOString(),
            reason: reason,
            source: entry.source || null,
            path: entry.path || null,
            axis: entry.axis || null,
            second_axis: entry.second_axis || null,
            duration_ms: entry.duration_ms,
            travel: entry.travel,
            ua: client.ua,
            address: client.address,
        };
        recent.push(rec);
        if (recent.length > RING_SIZE) recent.shift();
        log.warn("Manual gesture ended abnormally: " + JSON.stringify(rec));
        appendAnomaly(rec);
    } catch (e) {
        /* diagnostics must never break motion handling */
    }
}

// Human-readable summary for the diagnostic bundle.
function summary() {
    var lines = [];
    lines.push("Manual gesture endings since engine start (" + new Date(startedAt).toISOString() + ")");
    lines.push("Normal endings: client:release, client:stop, stop. Anything else is a backstop firing");
    lines.push("(a release event that did not arrive normally).");
    lines.push("");
    var keys = Object.keys(counts).sort();
    if (!keys.length) lines.push("  (no continuous manual gestures recorded)");
    keys.forEach(function (k) {
        lines.push("  " + (isNormal(k) ? "  " : "! ") + k + ": " + counts[k]);
    });
    lines.push("");
    lines.push("Recent abnormal endings (newest last, max " + RING_SIZE + "):");
    if (!recent.length) lines.push("  (none)");
    recent.forEach(function (r) {
        lines.push("  " + JSON.stringify(r));
    });
    lines.push("");
    lines.push("Older abnormal endings, across restarts: " + ANOMALY_FILE + " in this bundle.");
    return lines.join("\n") + "\n";
}

// Test hook.
function _reset() {
    counts = {};
    recent = [];
    client = { ua: null, address: null };
}

module.exports = {
    record: record,
    noteClient: noteClient,
    clientReason: clientReason,
    cleanSource: cleanSource,
    isNormal: isNormal,
    summary: summary,
    counts: function () {
        return Object.assign({}, counts);
    },
    recent: function () {
        return recent.slice();
    },
    _reset: _reset,
};
