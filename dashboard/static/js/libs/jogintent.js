/*
 * JogIntent — the one gesture state machine for manual jogging.
 *
 * Every jog input source (device keyboard, on-screen keypad, future surfaces)
 * reduces to the same small problem: a set of momentary sources (keys,
 * buttons) that press and release, a tap-vs-hold decision, a fixed-step vs
 * continuous mode, and one iron invariant — WITH NO SOURCE HELD, NOTHING MAY
 * BE LIVE. Historically each input surface reimplemented this with its own
 * flags and timers, and every divergence became a runaway (lost keyups,
 * rollover-orphaned timers, blur). This module owns the state machine once,
 * with no DOM and no jQuery, so it is small enough to audit and test.
 *
 * The host adapter maps raw input events to press(id, move) / release(id) and
 * forwards window-level loss events to cancelAll(). This module emits:
 *
 *   "nudge"  (move)  one fixed step (a tap, a fixed-mode press, a typematic
 *                    repeat). Bounded motion — inherently fail-safe.
 *   "go"     (move)  continuous-motion heartbeat, re-emitted every
 *                    refreshInterval while the gesture is held. The server's
 *                    motion lease / the firmware jgv watchdog feed on this —
 *                    if this stream stops for any reason, motion stops.
 *   "stop"           end of continuous motion.
 *   "nudgeCancel"    a fixed-mode hold ended after typematic repeats fired —
 *                    discard the server-side nudge backlog.
 *
 * States: IDLE -> PENDING (tap window, owned by the newest pressed source)
 *              -> CONTINUOUS (tap window expired with the owner still held)
 *         IDLE -> FIXED_HOLD (fixed mode: step on press, typematic while held)
 *
 * Rollover rule: a second source pressed inside the tap window takes the
 * window over; the older press dies silently. (The old per-surface code
 * orphaned the older timer instead — it fired after all keys were released
 * and started unstoppable motion; see the Oct 2026 rapid-tap Z runaway.)
 *
 * Release rule: in CONTINUOUS, the release of ANY tracked source ends motion
 * — predictable and fail-safe. Motion restarts only on a fresh deliberate
 * press, never from a key's auto-repeat.
 */

(function (root, factory) {
    /* CommonJS */
    if (typeof module == "object" && module.exports) module.exports = factory();
    /* AMD module */ else if (typeof define == "function" && define.amd) define(factory);
    /* Browser global */ else root.JogIntent = factory();
})(this, function () {
    "use strict";

    var IDLE = "idle";
    var PENDING = "pending";
    var CONTINUOUS = "continuous";
    var FIXED_HOLD = "fixed_hold";

    function JogIntent(options) {
        this.listeners = { go: [], stop: [], nudge: [], nudgeCancel: [] };
        this.setOptions(options);
        this.state = IDLE;
        this.down = {}; // source id -> true while physically held
        this.owner = null; // source id that owns the current gesture
        this.move = null; // {axis, dir [, second_axis, second_dir]}
        this.tapTimer = null;
        this.heartbeat = null;
        this.repeatTimer = null;
        this.repeatCount = 0;
    }

    JogIntent.prototype.setOptions = function (options) {
        options = options || {};
        // How long a press may last and still be a tap (-> single nudge).
        this.tapWindow = options.tapWindow != null ? options.tapWindow : 200;
        // Continuous-motion heartbeat cadence. Feeds the server motion lease
        // and the firmware jgv watchdog; must be well inside both.
        this.refreshInterval = options.refreshInterval || 50;
        // Typematic for fixed-mode holds. repeatInterval <= 0 disables
        // repeating (a hold then yields exactly one step).
        this.repeatDelay = options.repeatDelay != null ? options.repeatDelay : 600;
        this.repeatInterval = options.repeatInterval != null ? options.repeatInterval : 250;
        // Host callback, sampled ONCE at gesture start and captured for the
        // gesture's life — mode flips mid-gesture must not morph a continuous
        // gesture into a fixed one (whose release path sends no stop).
        this.getFixedMode = options.getFixedMode || null;
    };

    JogIntent.prototype.on = function (evt, fn) {
        if (evt in this.listeners) {
            this.listeners[evt].push(fn);
        }
    };

    JogIntent.prototype.emit = function (evt, data) {
        var listeners = this.listeners[evt] || [];
        for (var i = 0; i < listeners.length; i++) {
            try {
                listeners[i](data);
            } catch (e) {
                // A broken listener must never break the state machine —
                // especially not between a "go" and its "stop".
                if (typeof console !== "undefined" && console.error) {
                    console.error("JogIntent listener error for '" + evt + "': " + e);
                }
            }
        }
    };

    // A source went down. `move` is captured now (including any modifier
    // state the adapter folded in) and reused for the whole gesture.
    //
    // fixedOverride: pass a boolean when the SOURCE determines the mode (the
    // on-screen keypad has distinct fixed/continuous buttons); omit it to
    // sample getFixedMode() (the keyboard's global Fixed switch).
    JogIntent.prototype.press = function (id, move, fixedOverride) {
        var fresh = !this.down[id];
        this.down[id] = true;
        if (!fresh) {
            // Auto-repeat of a held source: the original press owns all
            // timing. Repeats never extend a tap window or restart motion.
            return;
        }
        if (this.state === CONTINUOUS) {
            // Continuous motion is live; the extra press is tracked (so its
            // release is accounted for — any release stops motion) but does
            // not start anything.
            return;
        }
        if (this.state === FIXED_HOLD) {
            // Fixed mode steps per press: a fresh press closes out the
            // previous hold (cancelling its typematic backlog if repeats
            // fired) and immediately starts its own gesture — matching the
            // on-screen keypad's press-to-step feel when alternating keys.
            this._endFixed();
        }
        if (this.state === PENDING) {
            // Rollover: the newest press takes the tap window over. The older
            // press dies silently — never orphan its timer.
            this._clearTap();
        }
        this.owner = id;
        this.move = move;
        var fixed =
            typeof fixedOverride === "boolean"
                ? fixedOverride
                : !!(this.getFixedMode && this.getFixedMode());
        if (fixed) {
            // Fixed mode: step immediately on press (matches the on-screen
            // keypad feel), typematic while held.
            this.state = FIXED_HOLD;
            this.repeatCount = 0;
            this.emit("nudge", move);
            if (this.repeatInterval > 0) {
                this.repeatTimer = setTimeout(this._repeat.bind(this), this.repeatDelay);
            }
        } else if (this.tapWindow <= 0) {
            // No tap window: the host classifies tap-vs-hold itself (the
            // on-screen keypad's Hammer recognizers) and a press means
            // continuous motion NOW.
            this.state = CONTINUOUS;
            this._beat();
        } else {
            this.state = PENDING;
            this.tapTimer = setTimeout(this._tapExpired.bind(this), this.tapWindow);
        }
    };

    // A source came up.
    JogIntent.prototype.release = function (id) {
        delete this.down[id];
        switch (this.state) {
            case PENDING:
                if (id === this.owner) {
                    // Released inside the tap window: it was a tap.
                    this._clearTap();
                    var move = this.move;
                    this._toIdle();
                    this.emit("nudge", move);
                }
                // A non-owner release inside another press's window is the
                // tail of a rollover — its press was already superseded.
                break;
            case CONTINUOUS:
                // Any release ends continuous motion. Predictable, and the
                // fail-safe direction when sources interleave.
                this._stopContinuous();
                break;
            case FIXED_HOLD:
                if (id === this.owner) {
                    this._endFixed();
                }
                break;
        }
        // The invariant, enforced unconditionally: no sources held means no
        // pending start, no heartbeat, no typematic — whatever the path here.
        if (this._noneDown()) {
            this._enforceIdle();
        }
    };

    // Hard gesture end for window blur, visibilitychange, modal close,
    // disable. Release events are not coming; clear everything, emitting
    // the stop/cancel the live gesture needs. Safe to call when idle.
    JogIntent.prototype.cancelAll = function () {
        this.down = {};
        this._enforceIdle();
    };

    // True if any gesture state or timer is live.
    JogIntent.prototype.isActive = function () {
        return this.state !== IDLE;
    };

    // True while continuous motion is commanded (the host's legacy `going`).
    JogIntent.prototype.isContinuous = function () {
        return this.state === CONTINUOUS;
    };

    // ---- internals ----------------------------------------------------

    JogIntent.prototype._tapExpired = function () {
        this.tapTimer = null;
        if (this.state !== PENDING) {
            return;
        }
        if (!this.down[this.owner]) {
            // Belt: the owner is somehow no longer held (lost release raced
            // the timer) — a start now would have no release to stop it.
            this._toIdle();
            return;
        }
        this.state = CONTINUOUS;
        this._beat();
    };

    JogIntent.prototype._beat = function () {
        if (this.state !== CONTINUOUS) {
            return;
        }
        this.emit("go", this.move);
        this.heartbeat = setTimeout(this._beat.bind(this), this.refreshInterval);
    };

    JogIntent.prototype._repeat = function () {
        this.repeatTimer = null;
        if (this.state !== FIXED_HOLD || !this.down[this.owner]) {
            return;
        }
        this.repeatCount++;
        this.emit("nudge", this.move);
        if (this.repeatInterval > 0) {
            this.repeatTimer = setTimeout(this._repeat.bind(this), this.repeatInterval);
        }
    };

    JogIntent.prototype._stopContinuous = function () {
        if (this.heartbeat) {
            clearTimeout(this.heartbeat);
            this.heartbeat = null;
        }
        this._toIdle();
        this.emit("stop", null);
    };

    JogIntent.prototype._endFixed = function () {
        if (this.repeatTimer) {
            clearTimeout(this.repeatTimer);
            this.repeatTimer = null;
        }
        var fired = this.repeatCount > 0;
        this._toIdle();
        if (fired) {
            // Repeats queued server-side; stop the backlog with the in-flight
            // step. (No "stop" — a feedhold would race the nudge gcode.)
            this.emit("nudgeCancel", null);
        }
    };

    JogIntent.prototype._enforceIdle = function () {
        if (this.state === CONTINUOUS) {
            this._stopContinuous();
        } else if (this.state === FIXED_HOLD) {
            this._endFixed();
        } else {
            this._clearTap();
            this._toIdle();
        }
    };

    JogIntent.prototype._clearTap = function () {
        if (this.tapTimer) {
            clearTimeout(this.tapTimer);
            this.tapTimer = null;
        }
    };

    JogIntent.prototype._toIdle = function () {
        this.state = IDLE;
        this.owner = null;
        this.move = null;
        this.repeatCount = 0;
        if (this.heartbeat) {
            clearTimeout(this.heartbeat);
            this.heartbeat = null;
        }
        if (this.repeatTimer) {
            clearTimeout(this.repeatTimer);
            this.repeatTimer = null;
        }
    };

    JogIntent.prototype._noneDown = function () {
        for (var k in this.down) {
            if (Object.prototype.hasOwnProperty.call(this.down, k)) {
                return false;
            }
        }
        return true;
    };

    return JogIntent;
});
