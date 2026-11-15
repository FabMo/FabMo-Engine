/*
 * Motor Music — voice engine (no DOM, no FabMo calls; shared with jest).
 *
 * A stepper's pitch is its step rate, so a note is just an axis speed:
 *     speed (units/min) = frequency (Hz) * 60 / steps-per-unit
 * One voice per axis. Each animation tick, frame() returns the velocity-jog
 * command that holds the current chord, in the ratio form of manualStart:
 *     axis, speed, second_axis, second_speed, primary_ratio, secondary_ratio
 * where each axis runs at speed x ratio.
 *
 * Notes shuttle back and forth inside a small box around where playing
 * started, so holding a key never walks the tool across the table.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.MotorSynth = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    var NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

    function noteName(midi) {
        return NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
    }

    // Equal temperament, A4 (midi 69) = 440 Hz, shifted by the tuning
    function noteFreq(midi, tuning) {
        var t = tuning || {};
        var semis = midi - 69 + (t.transpose || 0) + (t.cents || 0) / 100;
        return 440 * Math.pow(2, semis / 12);
    }

    /*
     * opts:
     *   axes      [{ axis: "X", su: stepsPerUnit }, ...]  one voice each (1 or 2)
     *   box       half-width of the play area, machine units
     *   maxSpeed  units/min ceiling for any voice
     *   tuning    { transpose (semitones), cents }
     *   vibrato   { rate (Hz), depth (semitones) }
     */
    function Synth(opts) {
        this.configure(opts || {});
        this.counter = 0;
        this.lastT = null;
    }

    Synth.prototype.configure = function (opts) {
        var old = this.voices || [];
        this.box = opts.box > 0 ? opts.box : 1;
        this.maxSpeed = opts.maxSpeed > 0 ? opts.maxSpeed : 150;
        this.tuning = opts.tuning || { transpose: 0, cents: 0 };
        this.vibrato = opts.vibrato || { rate: 6, depth: 0.4 };
        this.voices = (opts.axes || []).slice(0, 2).map(function (a, i) {
            var prev = old[i] && old[i].axis === a.axis ? old[i] : null;
            return {
                axis: a.axis,
                su: a.su,
                note: null,
                order: 0,
                dir: prev ? prev.dir : 1,
                pos: prev ? prev.pos : 0, // offset from the box centre
                v: 0,
                freq: 0,
            };
        });
    };

    // Where each axis is relative to where playing started (from status
    // reports). Between reports the synth dead-reckons from its own commands.
    Synth.prototype.setOffset = function (axis, offset) {
        this.voices.forEach(function (v) {
            if (v.axis === axis && typeof offset === "number" && isFinite(offset)) v.pos = offset;
        });
    };

    Synth.prototype.held = function () {
        return this.voices
            .filter(function (v) {
                return v.note !== null;
            })
            .map(function (v) {
                return v.note;
            });
    };

    Synth.prototype.noteOn = function (midi) {
        var vs = this.voices;
        if (!vs.length) return null;
        for (var i = 0; i < vs.length; i++) if (vs[i].note === midi) return vs[i];
        var pick = null;
        vs.forEach(function (v) {
            if (v.note === null && (!pick || v.order < pick.order)) pick = v; // longest-idle free voice
        });
        if (!pick) {
            vs.forEach(function (v) {
                if (!pick || v.order < pick.order) pick = v; // steal the oldest note
            });
        }
        pick.note = midi;
        pick.order = ++this.counter;
        // head back toward the centre; from the centre, alternate
        if (Math.abs(pick.pos) > 0.05 * this.box) pick.dir = pick.pos > 0 ? -1 : 1;
        else pick.dir = -pick.dir;
        return pick;
    };

    Synth.prototype.noteOff = function (midi) {
        this.voices.forEach(function (v) {
            if (v.note === midi) v.note = null;
        });
    };

    Synth.prototype.allOff = function () {
        this.voices.forEach(function (v) {
            v.note = null;
        });
    };

    /*
     * Advance to time tSec (seconds, any monotonic clock).
     * Returns { cmd, voices }: cmd is null when nothing is sounding, else
     * { axis, speed, second_axis, second_speed, primary_ratio, secondary_ratio }.
     */
    Synth.prototype.frame = function (tSec, vibratoOn) {
        var dt = this.lastT === null ? 0 : Math.min(Math.max(tSec - this.lastT, 0), 0.25);
        this.lastT = tSec;
        var self = this;
        var bend = 1;
        if (vibratoOn && this.vibrato.depth > 0) {
            bend = Math.pow(2, (this.vibrato.depth * Math.sin(2 * Math.PI * this.vibrato.rate * tSec)) / 12);
        }
        var top = 0;
        this.voices.forEach(function (v) {
            v.pos += (v.v / 60) * dt; // dead-reckon the last command
            if (v.note === null || !(v.su > 0)) {
                v.v = 0;
                v.freq = 0;
                return;
            }
            if (v.pos * v.dir >= self.box) v.dir = -v.dir; // bounce off the box wall
            v.freq = noteFreq(v.note, self.tuning) * bend;
            var speed = Math.min((v.freq * 60) / v.su, self.maxSpeed);
            v.v = v.dir * speed;
            if (speed > top) top = speed;
        });
        var out = {
            cmd: null,
            voices: this.voices.map(function (v) {
                return { axis: v.axis, note: v.note, freq: v.freq, speed: v.v, offset: v.pos };
            }),
        };
        if (top > 0) {
            var a = this.voices[0],
                b = this.voices[1];
            out.cmd = {
                axis: a.axis,
                speed: top,
                second_axis: b ? b.axis : undefined,
                second_speed: b ? top : undefined,
                primary_ratio: a.v / top,
                secondary_ratio: b ? b.v / top : 0,
            };
        }
        return out;
    };

    // Steps-per-unit for each axis letter from the G2 driver config
    // (motor N drives axis index `Nma`; `Nsu` is its steps per unit).
    function stepsPerUnit(driverCfg) {
        var letters = ["X", "Y", "Z", "A", "B", "C"];
        var out = {};
        if (!driverCfg) return out;
        for (var n = 1; n <= 6; n++) {
            var ax = letters[driverCfg[n + "ma"]];
            var su = Number(driverCfg[n + "su"]);
            if (ax && su > 0 && out[ax] === undefined) out[ax] = su;
        }
        return out;
    }

    return { Synth: Synth, noteName: noteName, noteFreq: noteFreq, stepsPerUnit: stepsPerUnit };
});
