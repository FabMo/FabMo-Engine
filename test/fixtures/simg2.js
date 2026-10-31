/*
 * SimG2 — a simulated motion controller for manual-drive scenario tests.
 *
 * The unit suites mock the driver at the function level (feedHold: jest.fn()),
 * which can't catch timing-contract bugs: every one of the Oct 2026 bench
 * bugs (the tap-eating %, typematic burst-stepping, stale-flag queueing) was
 * invisible to function mocks. This fixture models the parts of the contract
 * those bugs lived in:
 *
 *  - G1/G0 moves parsed from the cycle stream execute with realistic
 *    duration (distance/feedrate + overhead), strictly in order
 *  - status reports behave like the board's: stat:5 when motion starts,
 *    stat:3 only when the queue runs dry, each carrying fresh positions,
 *    delivered SR_LATENCY after the fact
 *  - a raw "%" takes effect WIRE_LATENCY after it is written (serial transit)
 *    and discards buffered-but-unstarted moves — the semantics that made the
 *    unconditional end-of-move flush eat taps that raced it
 *
 * Drive it under jest fake timers. `executed` logs every completed move
 * ({word, dist, startT, endT}) for assertions; `now()` is the fake clock.
 */
"use strict";

var EventEmitter = require("events").EventEmitter;
var util = require("util");

var EXEC_OVERHEAD_MS = 20; // accel/decel + planner overhead per move
var SR_LATENCY_MS = 60; // report throttle/transit: state change -> handler
var WIRE_LATENCY_MS = 15; // raw writes (e.g. "%") in serial transit
var INTAKE_MS = 30; // gcode sits in the receive/planner buffer before it
// starts executing - the window where a flush can discard it. Without this
// the sim starts moves instantly and no flush race can ever be observed.

function SimG2() {
    EventEmitter.call(this);
    this.STAT_INTERLOCK = 11;
    this.STAT_SHUTDOWN = 10;
    this.STAT_PANIC = 13;
    this.STAT_ALARM = 12;
    this.STAT_RUNNING = 5;
    this.STAT_STOP = 3;
    this.STAT_END = 4;
    this.STAT_HOLDING = 6;
    this.status = { stat: 3, hold: 0, posx: 0, posy: 0, posz: 0 };
    this.pause_hold = false;
    this.pause_flag = false;
    this.jgv_supported = false;

    this.queue = []; // parsed, not-yet-started moves
    this.executing = null;
    this.executed = []; // completed moves, for assertions
    this.feed = 60; // modal F, units/min
    this.feedHolds = 0;
    this.flushes = 0;
    this._clock = 0;
    var self = this;
    // The manual driver writes gcode into its cycle stream; wire it here.
    this.stream = {
        write: function (s) {
            self._ingest(s);
        },
    };
    this.prime = function () {};
    this.discardStreamBacklog = function () {
        return 0;
    };
    this.jogVelocity = function () {};
    this.jogStop = function () {};
    this.queueFlush = function (cb) {
        if (cb) cb(); // the driver's callback raw-writes "%"
    };
}
util.inherits(SimG2, EventEmitter);

SimG2.prototype.now = function () {
    return Date.now(); // jest fake timers drive this
};

SimG2.prototype.feedHold = function () {
    this.feedHolds += 1;
    // Scenario scope: a hold freezes new starts; the in-flight move finishes.
    this.held = true;
};

// Raw serial write (bypasses the gcode stream). Only "%" matters here, and
// like the real wire it takes effect after transit — the window the
// tap-eating race lived in.
SimG2.prototype._write = function (s) {
    if (String(s).indexOf("%") === -1) return;
    var self = this;
    setTimeout(function () {
        self.flushes += 1;
        self.held = false;
        self.queue = []; // discard everything buffered but not started
    }, WIRE_LATENCY_MS);
};

SimG2.prototype._ingest = function (s) {
    var lines = String(s).split("\n");
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line || line[0] === "{" || line[0] === "M") continue;
        var f = /F([\d.]+)/.exec(line);
        if (f) this.feed = parseFloat(f[1]);
        if (!/^G[01]\b|^G1[XYZABC]/.test(line.replace(/\s+/g, ""))) continue;
        var words = line.replace(/^G[01]\s*/, "").replace(/F[\d.]+/, "");
        var re = /([XYZABC])(-?[\d.]+)/g;
        var m;
        var move = { words: [], feed: this.feed };
        while ((m = re.exec(words)) !== null) {
            move.words.push({ axis: m[1].toLowerCase(), dist: parseFloat(m[2]) });
        }
        if (move.words.length) {
            this.queue.push(move);
        }
    }
    this._pump();
};

SimG2.prototype._pump = function () {
    if (this.executing || this.held || this.queue.length === 0) return;
    var move = this.queue[0];
    if (!move._intakeAt) {
        // Model planner intake: the move stays in the (flushable) buffer for
        // INTAKE_MS before execution begins.
        move._intakeAt = this.now() + INTAKE_MS;
        var self0 = this;
        setTimeout(function () {
            self0._pump();
        }, INTAKE_MS);
        return;
    }
    if (this.now() < move._intakeAt) return;
    this.queue.shift();
    this.executing = move;
    move.startT = this.now();
    var maxDist = 0;
    move.words.forEach(function (w) {
        maxDist = Math.max(maxDist, Math.abs(w.dist));
    });
    var durMs = (maxDist / move.feed) * 60000 + EXEC_OVERHEAD_MS;
    if (this.status.stat !== this.STAT_RUNNING) {
        this._emitSR(this.STAT_RUNNING);
    }
    var self = this;
    setTimeout(function () {
        move.words.forEach(function (w) {
            self.status["pos" + w.axis] += w.dist;
        });
        move.endT = self.now();
        self.executed.push(move);
        self.executing = null;
        if (self.queue.length > 0 && !self.held) {
            self._pump(); // back-to-back: stat stays RUNNING, no stat:3 between
        } else {
            self._emitSR(self.STAT_STOP);
        }
    }, Math.max(1, Math.round(durMs)));
};

// Reports arrive SR_LATENCY after the state change, carrying fresh positions
// as of emit time (the report is built when sent, not when scheduled).
SimG2.prototype._emitSR = function (stat) {
    var self = this;
    setTimeout(function () {
        // A newer state change may have superseded this one (e.g. a queued
        // move started before the stop report went out) — report reality.
        var liveStat = self.executing ? self.STAT_RUNNING : stat;
        self.status.stat = liveStat;
        var report = { stat: liveStat };
        ["x", "y", "z"].forEach(function (a) {
            report["pos" + a] = self.status["pos" + a];
        });
        self.emit("status", report);
    }, SR_LATENCY_MS);
};

module.exports = SimG2;
