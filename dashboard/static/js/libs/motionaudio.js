/*
 * MotionAudio — hear the machine move, no hardware required.
 *
 * The bench trick this replaces: a piezo speaker clipped to a step output on
 * the G2 card, so you can *hear* commanded motion (pitch = step rate) on a
 * board with no motors attached — ramps, stutters, runaways, hesitations are
 * all instantly audible. This module synthesizes the same thing from the
 * telemetry we already have: G2 streams position in every status report
 * (~10 Hz), so per-axis velocity falls out of the position deltas, and
 * velocity x steps-per-unit is the step rate Ted's speaker would be clicking
 * at. One square-wave oscillator per axis (square, because step pulses are),
 * panned apart so X/Y/Z are distinguishable, with pitch glides between
 * status reports so ramps sound like ramps.
 *
 * Two layers:
 *   MotionAudioModel — pure math, no DOM, no audio. Position samples in,
 *       per-axis frequency targets out. Unit-tested directly.
 *   MotionAudio      — thin WebAudio glue around the model. Created lazily
 *       on first enable (browsers require a user gesture for audio anyway).
 *
 * Honest limits: this is the 10 Hz *sampled* view of motion, not the
 * planner's microsecond truth — fine for "is it moving / how fast / did it
 * really stop", which is what the bench speaker is for. Work-coordinate
 * jumps (zeroing an axis, offset changes) would read as huge instantaneous
 * velocity; a teleport guard mutes those instead of chirping.
 */

(function (root, factory) {
    /* CommonJS */
    if (typeof module == "object" && module.exports) module.exports = factory();
    /* AMD module */ else if (typeof define == "function" && define.amd) define(factory);
    /* Browser global */ else root.MotionAudio = factory();
})(this, function () {
    "use strict";

    var AXES = ["x", "y", "z"];

    // Audible band for a step rate. Below MIN we call it stopped (20 steps/s
    // is slower than any real jog); above MAX we just pin the pitch.
    var FREQ_MIN = 20;
    var FREQ_MAX = 6000;

    // Any implied speed above this is a coordinate jump (zeroing, offset
    // change), not motion — mute and rebase rather than chirp. Positions
    // arrive in the machine's current display units, so the ceiling has to
    // follow suit (30 in/s is absurd; 30 mm/s is a slow jog).
    var TELEPORT_IN_PER_S = 30;
    var TELEPORT_MM_PER_S = 760;

    // Status report cadence is ~100 ms; glide pitch slightly past the next
    // expected sample so ramps sound continuous instead of stair-stepped.
    var GLIDE_S = 0.12;

    // Fallback when the g2 motor config isn't readable: 1 unit/s -> 2 kHz,
    // the right ballpark for a 4000 steps/inch machine jogging at inches/s.
    var DEFAULT_STEPS_PER_UNIT = 2000;

    // Per-axis steps-per-unit from the g2 motor config: for each motor 1..6,
    // {N}ma maps it to an axis (0=X 1=Y 2=Z...), and steps/unit =
    // (360 / {N}sa step angle) * {N}mi microsteps / {N}tr travel-per-rev.
    // Absolute pitch accuracy doesn't matter much here (proportionality
    // does), so any unreadable value just falls back.
    function stepsPerUnitFromDriverConfig(driverCfg) {
        var out = {};
        if (!driverCfg) return out;
        for (var m = 1; m <= 6; m++) {
            var ma = driverCfg[m + "ma"];
            var sa = driverCfg[m + "sa"];
            var mi = driverCfg[m + "mi"];
            var tr = driverCfg[m + "tr"];
            if (ma == null || !sa || !mi || !tr) continue;
            var axis = AXES[ma]; // only x/y/z get a voice
            if (!axis || out[axis]) continue; // first motor on an axis wins
            out[axis] = ((360 / sa) * mi) / tr;
        }
        return out;
    }

    // ---- pure model --------------------------------------------------------

    function MotionAudioModel(options) {
        options = options || {};
        this.stepsPerUnit = options.stepsPerUnit || {};
        this.last = null; // { t, pos: {x,y,z} }
    }

    MotionAudioModel.prototype.setStepsPerUnit = function (spu) {
        this.stepsPerUnit = spu || {};
    };

    // Feed one status sample. Returns per-axis oscillator targets:
    //   { x: {freq, on}, y: {...}, z: {...} }
    // or null when this sample can't produce a velocity (first sample, stale
    // gap, teleport) — callers should mute on null.
    MotionAudioModel.prototype.update = function (status, tMs) {
        var pos = {};
        for (var i = 0; i < AXES.length; i++) {
            var v = status["pos" + AXES[i]];
            if (typeof v !== "number" || isNaN(v)) return this._rebase(null);
            pos[AXES[i]] = v;
        }

        var last = this.last;
        this.last = { t: tMs, pos: pos };
        if (!last) return null;

        var dt = (tMs - last.t) / 1000;
        if (dt <= 0.005 || dt > 0.5) {
            // Duplicate burst or a stale gap (page hidden, hold, disconnect)
            // — velocity over this interval is meaningless.
            return null;
        }

        // status.unit: 0 = inches (G20), 1 = mm (G21); tolerate string forms.
        var metric = status.unit === 1 || status.unit === "mm";
        var teleportLimit = metric ? TELEPORT_MM_PER_S : TELEPORT_IN_PER_S;

        var out = {};
        for (i = 0; i < AXES.length; i++) {
            var axis = AXES[i];
            var speed = Math.abs(pos[axis] - last.pos[axis]) / dt; // units/s
            if (speed > teleportLimit) {
                // Coordinate jump — rebase so the next sample is clean.
                this.last = { t: tMs, pos: pos };
                return null;
            }
            var spu = this.stepsPerUnit[axis] || DEFAULT_STEPS_PER_UNIT;
            var freq = speed * spu;
            if (freq < FREQ_MIN) {
                out[axis] = { freq: 0, on: false };
            } else {
                out[axis] = { freq: Math.min(freq, FREQ_MAX), on: true };
            }
        }
        return out;
    };

    MotionAudioModel.prototype._rebase = function (v) {
        this.last = null;
        return v;
    };

    // ---- WebAudio glue -----------------------------------------------------

    // options.getDriverConfig: () -> the g2 config object (or null); read at
    // enable time so steps/unit tracks the connected machine's motor setup.
    function MotionAudio(options) {
        options = options || {};
        this.getDriverConfig = options.getDriverConfig || null;
        this.model = new MotionAudioModel();
        this.enabled = false;
        this.ctx = null;
        this.voices = null; // axis -> {osc, gain}
        this.master = null;
    }

    MotionAudio.prototype.setEnabled = function (enabled) {
        if (enabled === this.enabled) return;
        this.enabled = enabled;
        if (enabled) {
            this.model.setStepsPerUnit(
                stepsPerUnitFromDriverConfig(this.getDriverConfig ? this.getDriverConfig() : null)
            );
            this._ensureContext();
        } else {
            this._muteAll();
            this.model.last = null;
        }
    };

    MotionAudio.prototype.toggle = function () {
        this.setEnabled(!this.enabled);
        return this.enabled;
    };

    // Hook this to the engine "status" event stream.
    MotionAudio.prototype.onStatus = function (status) {
        if (!this.enabled || !this.ctx || !status) return;
        var targets = this.model.update(status, (typeof performance !== "undefined" ? performance.now() : Date.now()));
        if (!targets) {
            this._muteAll();
            return;
        }
        var now = this.ctx.currentTime;
        for (var axis in this.voices) {
            var voice = this.voices[axis];
            var t = targets[axis];
            if (!t || !t.on) {
                voice.gain.gain.setTargetAtTime(0, now, 0.03);
            } else {
                voice.osc.frequency.cancelScheduledValues(now);
                voice.osc.frequency.linearRampToValueAtTime(t.freq, now + GLIDE_S);
                voice.gain.gain.setTargetAtTime(voice.level, now, 0.03);
            }
        }
    };

    MotionAudio.prototype._ensureContext = function () {
        if (this.ctx) {
            if (this.ctx.state === "suspended") this.ctx.resume();
            return;
        }
        var Ctx = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
        if (!Ctx) return; // no WebAudio: toggle is a no-op
        this.ctx = new Ctx();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.12; // bench-speaker loud, not alarm loud
        this.master.connect(this.ctx.destination);
        this.voices = {};
        // Pan the axes apart so a diagonal is audibly two motors.
        var panFor = { x: -0.6, y: 0.6, z: 0 };
        var levelFor = { x: 1.0, y: 1.0, z: 1.0 };
        for (var i = 0; i < AXES.length; i++) {
            var axis = AXES[i];
            var osc = this.ctx.createOscillator();
            osc.type = "square"; // step pulses are square waves — sounds like a stepper
            osc.frequency.value = FREQ_MIN;
            var gain = this.ctx.createGain();
            gain.gain.value = 0;
            osc.connect(gain);
            var out = gain;
            if (this.ctx.createStereoPanner) {
                var pan = this.ctx.createStereoPanner();
                pan.pan.value = panFor[axis];
                gain.connect(pan);
                out = pan;
            }
            out.connect(this.master);
            osc.start();
            this.voices[axis] = { osc: osc, gain: gain, level: levelFor[axis] };
        }
    };

    MotionAudio.prototype._muteAll = function () {
        if (!this.ctx || !this.voices) return;
        var now = this.ctx.currentTime;
        for (var axis in this.voices) {
            this.voices[axis].gain.gain.setTargetAtTime(0, now, 0.03);
        }
    };

    return {
        MotionAudio: MotionAudio,
        MotionAudioModel: MotionAudioModel,
        stepsPerUnitFromDriverConfig: stepsPerUnitFromDriverConfig,
    };
});
