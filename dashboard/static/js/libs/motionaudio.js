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

    // Raw step rates are musically hostile — a 4000 steps/inch machine at
    // 1.5 in/s is a 6 kHz shriek. Listen through a /10 prescaler instead:
    // proportions (ramps, ratios between axes) are unchanged, but jogs land
    // in the comfortable few-hundred-Hz band.
    var PITCH_DIVISOR = 10;

    // Audible band for the (divided) pitch. Below MIN we call it stopped;
    // above MAX we just pin the pitch.
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
    // Velocity estimation windows. The dashboard "status" stream is NOT a
    // clean 10 Hz position feed: the machine emits status for plenty of
    // non-position reasons, so back-to-back samples with identical positions
    // a few ms apart are normal. Pairwise velocity over adjacent samples
    // reads those as "stopped" and the tone stutters. Instead, velocity is
    // measured across a sliding window - chatter inside the window cannot
    // zero it - and an axis only goes silent after staying below threshold
    // for OFF_HOLD_MS, so a missed or late report cannot cut the tone.
    var V_WINDOW_MS = 350; // velocity baseline: newest vs oldest within this
    var MIN_SPAN_MS = 50; // need at least this much baseline to say anything
    var OFF_HOLD_MS = 250; // sustain through dropouts before going silent

    function MotionAudioModel(options) {
        options = options || {};
        this.stepsPerUnit = options.stepsPerUnit || {};
        this.samples = []; // [{t, pos:{x,y,z}}], pruned to the window
        this.offSince = {}; // axis -> t of first below-threshold reading
        this.lastFreq = {}; // axis -> last audible frequency (for sustain)
    }

    MotionAudioModel.prototype.setStepsPerUnit = function (spu) {
        this.stepsPerUnit = spu || {};
    };

    MotionAudioModel.prototype.reset = function () {
        this.samples = [];
        this.offSince = {};
        this.lastFreq = {};
    };

    // Feed one status sample. Returns per-axis oscillator targets:
    //   { x: {freq, on}, y: {...}, z: {...} }
    // null means hard-mute NOW (invalid positions, coordinate teleport);
    // undefined means "nothing to say yet, change nothing" (warming up,
    // duplicate tick). Callers must also mute on their own clock when
    // updates stop arriving - the model only speaks when fed.
    MotionAudioModel.prototype.update = function (status, tMs) {
        var pos = {};
        for (var i = 0; i < AXES.length; i++) {
            var v = status["pos" + AXES[i]];
            if (typeof v !== "number" || isNaN(v)) {
                this.reset();
                return null;
            }
            pos[AXES[i]] = v;
        }

        var newest = this.samples.length ? this.samples[this.samples.length - 1] : null;
        if (newest && tMs - newest.t <= 2) {
            return undefined; // same tick; nothing new
        }

        // status.unit: 0 = inches (G20), 1 = mm (G21); tolerate string forms.
        var metric = status.unit === 1 || status.unit === "mm";
        var teleportLimit = metric ? TELEPORT_MM_PER_S : TELEPORT_IN_PER_S;

        if (newest) {
            var adt = (tMs - newest.t) / 1000;
            if (adt > 0.5) {
                // Stale gap (hidden tab, hold, disconnect): restart the window.
                this.reset();
            } else {
                // Teleport check against the adjacent sample: zeroing an axis
                // or an offset change jumps work coordinates instantly - mute
                // and restart the window rather than chirp.
                for (i = 0; i < AXES.length; i++) {
                    if (Math.abs(pos[AXES[i]] - newest.pos[AXES[i]]) / adt > teleportLimit) {
                        this.reset();
                        this.samples.push({ t: tMs, pos: pos });
                        return null;
                    }
                }
            }
        }

        this.samples.push({ t: tMs, pos: pos });
        while (this.samples.length && tMs - this.samples[0].t > V_WINDOW_MS) {
            this.samples.shift();
        }

        var oldest = this.samples[0];
        var span = (tMs - oldest.t) / 1000;
        if (span * 1000 < MIN_SPAN_MS) {
            return undefined; // warming up - hold whatever is sounding
        }

        var out = {};
        for (i = 0; i < AXES.length; i++) {
            var axis = AXES[i];
            var speed = Math.abs(pos[axis] - oldest.pos[axis]) / span; // units/s
            var spu = this.stepsPerUnit[axis] || DEFAULT_STEPS_PER_UNIT;
            var freq = (speed * spu) / PITCH_DIVISOR;
            if (freq >= FREQ_MIN) {
                this.offSince[axis] = null;
                this.lastFreq[axis] = Math.min(freq, FREQ_MAX);
                out[axis] = { freq: this.lastFreq[axis], on: true };
            } else if (this.offSince[axis] == null && this.lastFreq[axis]) {
                // First below-threshold reading after sound: sustain the
                // last pitch through the hold window instead of cutting out.
                this.offSince[axis] = tMs;
                out[axis] = { freq: this.lastFreq[axis], on: true };
            } else if (this.offSince[axis] != null && tMs - this.offSince[axis] < OFF_HOLD_MS) {
                out[axis] = { freq: this.lastFreq[axis] || 0, on: !!this.lastFreq[axis] };
            } else {
                this.lastFreq[axis] = 0;
                out[axis] = { freq: 0, on: false };
            }
        }
        return out;
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
        this.silenceTimer = null;
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
            this.model.reset();
            if (this.silenceTimer) {
                clearTimeout(this.silenceTimer);
                this.silenceTimer = null;
            }
        }
    };

    MotionAudio.prototype.toggle = function () {
        this.setEnabled(!this.enabled);
        return this.enabled;
    };

    // Hook this to the engine "status" event stream.
    MotionAudio.prototype.onStatus = function (status) {
        if (!this.enabled || !this.ctx || !status) return;

        // The model sustains tone through sparse/duplicate reports, so it can
        // never silence itself if reports stop entirely (machine idle, G2
        // gone). This is the tone's own deadman: no status for 700ms -> mute.
        if (this.silenceTimer) clearTimeout(this.silenceTimer);
        this.silenceTimer = setTimeout(this._muteAll.bind(this), 700);

        var targets = this.model.update(status, (typeof performance !== "undefined" ? performance.now() : Date.now()));
        if (targets === undefined) {
            return; // warming up / duplicate tick - change nothing
        }
        if (targets === null) {
            this._muteAll(); // invalid positions or coordinate teleport
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
