/* eslint-disable no-unused-vars */
/* eslint-disable no-undef */
/* pretty-ignore */
// All turned off for this module

/*
 * Device-keyboard jog adapter.
 *
 * This module used to own a full gesture implementation (tap windows,
 * typematic, rollover, ~18 state fields) in parallel with keypad.js's copy —
 * and every divergence between them became a runaway bug (lost keyups, the
 * rollover-orphaned timer, blur). All gesture logic now lives in ONE place,
 * libs/jogintent.js; this file only:
 *
 *   - maps key events to press/release on the shared state machine
 *     (keyCode -> axis/direction, Alt-modified diagonals captured at press)
 *   - keeps the jog keys away from browser defaults while jogging is enabled
 *   - paints the on-screen arrow styling
 *   - forwards window blur/visibility/pagehide as hard gesture ends
 *
 * The outward surface is unchanged: main.js still constructs it the same way
 * and listens for "go" / "stop" / "nudge" / "nudgeCancel"; `going`,
 * `interval`, `stop()` and `setEnabled()` behave as before (with one fix:
 * setEnabled(false) mid-gesture now emits the stop the server needs instead
 * of silently dropping the client-side state).
 */

(function (root, factory) {
    /* CommonJS */
    if (typeof module == "object" && module.exports) module.exports = factory();
    /* AMD module */ else if (typeof define == "function" && define.amd)
        define(factory);
    /* Browser global */ else root.WheelControl = factory();
})(this, function () {
    "use strict";

    var JogIntent;
    if (typeof module == "object" && module.exports) {
        JogIntent = require("./jogintent");
    } else if (typeof window !== "undefined") {
        JogIntent = window.JogIntent;
    }

    var KEY_RIGHT = 39;
    var KEY_LEFT = 37;
    var KEY_UP = 38;
    var KEY_DOWN = 40;
    var KEY_PGUP = 33;
    var KEY_PGDOWN = 34;
    // SB3-style diagonal jog keys: "/" = +X+Y, "\" = +X-Y; Alt inverts
    // both signs (Alt+"/" = -X-Y, Alt+"\" = -X+Y).
    var KEY_SLASH = 191;
    var KEY_NUMPAD_DIVIDE = 111;
    var KEY_BACKSLASH = 220;

    var JOG_KEYS = [
        KEY_UP,
        KEY_DOWN,
        KEY_LEFT,
        KEY_RIGHT,
        KEY_PGUP,
        KEY_PGDOWN,
        KEY_SLASH,
        KEY_NUMPAD_DIVIDE,
        KEY_BACKSLASH,
    ];
    var isJogKey = function (code) {
        return JOG_KEYS.indexOf(code) !== -1;
    };

    // Fields where the jog keys have a legitimate editing job (cursor
    // movement, typing "/") — leave the browser default alone there.
    // Notably NOT input[type=range]: the speed slider must never respond
    // to arrow keys, they belong to jogging.
    var isTextEntry = function (el) {
        if (!el || !el.tagName) return false;
        var tag = el.tagName.toUpperCase();
        if (tag === "TEXTAREA") return true;
        if (tag !== "INPUT") return false;
        var type = (el.type || "text").toLowerCase();
        return type !== "range" && type !== "checkbox" && type !== "radio" && type !== "button";
    };

    // Diagonal keypad buttons carry no keyboardArrow_* id; find them by
    // their axis-direction class pair (e.g. ".x_pos.y_neg").
    var diagSelector = function (axis, dir, second_axis, second_dir) {
        return (
            "." + axis + (dir === 1 ? "_pos" : "_neg") +
            "." + second_axis + (second_dir === 1 ? "_pos" : "_neg")
        );
    };

    // Map a key press to the move it commands. Alt is captured here, at
    // press time, and baked into the move for the gesture's whole life —
    // releasing Alt a beat early must not flip a tap-nudge's direction.
    var moveForKey = function (keyCode, altKey) {
        switch (keyCode) {
            case KEY_UP:
                return { axis: "y", dir: 1 };
            case KEY_DOWN:
                return { axis: "y", dir: -1 };
            case KEY_LEFT:
                return { axis: "x", dir: -1 };
            case KEY_RIGHT:
                return { axis: "x", dir: 1 };
            case KEY_PGUP:
                return { axis: "z", dir: 1 };
            case KEY_PGDOWN:
                return { axis: "z", dir: -1 };
            case KEY_SLASH:
            case KEY_NUMPAD_DIVIDE:
                return altKey
                    ? { axis: "x", dir: -1, second_axis: "y", second_dir: -1 }
                    : { axis: "x", dir: 1, second_axis: "y", second_dir: 1 };
            case KEY_BACKSLASH:
                return altKey
                    ? { axis: "x", dir: -1, second_axis: "y", second_dir: 1 }
                    : { axis: "x", dir: 1, second_axis: "y", second_dir: -1 };
            default:
                return null;
        }
    };

    var selectorFor = function (move) {
        if (!move) return null;
        return move.second_axis
            ? diagSelector(move.axis, move.dir, move.second_axis, move.second_dir)
            : "#keyboardArrow_" + move.axis + (move.dir === 1 ? "_pos" : "_neg");
    };

    var Keyboard = function (id, options) {
        this.id = id;
        this.elem = this.id ? $(id) : null;
        if (this.elem) {
            this.elem.attr("tabindex", 0);
        }
        this.enabled = false;

        this.intent = new JogIntent({
            getFixedMode: function () {
                return $(".fixed-switch input").is(":checked");
            },
        });
        this.setOptions(options);

        // Styling follows the intent machine's events so it can never
        // disagree with what was actually commanded.
        this.intent.on("go", this._styleContinuous.bind(this));
        this.intent.on("stop", this._styleClear.bind(this));
        this.intent.on("nudge", this._styleTransient.bind(this));

        this.init();
    };

    Keyboard.prototype.init = function () {
        if (this.elem) {
            this.elem.on("click", this.onClick.bind(this));
            this.elem.on("blur", this.onBlur.bind(this));
            this.elem.on("mouseleave", this.onMouseLeave.bind(this));
            this.elem.on("keydown", this.onKeyDown.bind(this));
            this.elem.on("keyup", this.onKeyUp.bind(this));
        } else {
            $(document).on("keydown", this.onKeyDown.bind(this));
            $(document).on("keyup", this.onKeyUp.bind(this));
        }

        // A keyup is never delivered to a blurred window (alt-tab, OS dialog,
        // focus into an iframe) and none are coming after a tab close —
        // losing the window is a hard gesture end, delivered while the
        // socket can still flush the stop. The server motion lease (and the
        // firmware jgv watchdog) backstop this if the send doesn't make it.
        $(window).on("blur", this._onFocusLost.bind(this));
        document.addEventListener(
            "visibilitychange",
            function () {
                if (document.hidden) this._onFocusLost();
            }.bind(this)
        );
        window.addEventListener("pagehide", this._onFocusLost.bind(this));
    };

    Keyboard.prototype._onFocusLost = function () {
        if (this.intent.isActive()) {
            console.warn("Keyboard: window lost focus mid-gesture - forcing stop");
        }
        this.intent.cancelAll();
        this._styleClear();
    };

    Keyboard.prototype.setOptions = function (options) {
        options = options || {};
        this.intent.setOptions({
            refreshInterval: options.refreshInterval,
            tapWindow: options.nudgeTimeout,
            repeatDelay: options.nudgeRepeatDelay,
            repeatInterval: options.nudgeRepeatInterval,
            getFixedMode: this.intent.getFixedMode,
        });
    };

    // Gesture events come from the intent machine; proxy subscriptions.
    Keyboard.prototype.on = function (evt, func) {
        this.intent.on(evt, func);
    };

    Keyboard.prototype.setEnabled = function (enabled) {
        this.enabled = enabled;
        if (this.elem) {
            if (enabled) {
                this.elem
                    .removeClass("keyboard-button-inactive")
                    .addClass("keyboard-button-active");
            } else {
                this.elem
                    .removeClass("keyboard-button-active")
                    .addClass("keyboard-button-inactive");
            }
        }
        if (!enabled) {
            // Disabling mid-gesture must end the gesture properly (emitting
            // the stop/cancel the server needs), not just drop local state.
            this.intent.cancelAll();
            this._styleClear();
        }
    };

    // Hard stop, for the host (modal close paths in main.js).
    Keyboard.prototype.stop = function () {
        this.intent.cancelAll();
        this._styleClear();
    };

    Keyboard.prototype.onClick = function (evt) {
        this.setEnabled(!this.enabled);
    };

    Keyboard.prototype.onBlur = function (evt) {
        this.setEnabled(false);
    };

    Keyboard.prototype.onMouseLeave = function (evt) {
        this.setEnabled(false);
    };

    Keyboard.prototype.onKeyDown = function (evt) {
        // While keyboard jogging is enabled the jog keys belong to us — keep
        // the browser's defaults (stepping a focused speed slider, page
        // scroll, "/" quick-find) out of it, auto-repeat events included.
        if (this.enabled && isJogKey(evt.keyCode) && !isTextEntry(evt.target)) {
            evt.preventDefault();
        }
        if (!this.enabled || !isJogKey(evt.keyCode)) {
            return;
        }
        var move = moveForKey(evt.keyCode, evt.altKey);
        if (move) {
            this.intent.press(evt.keyCode, move);
        }
    };

    Keyboard.prototype.onKeyUp = function (evt) {
        // Only jog keys may end or alter a gesture — a stray letter-key
        // release must never feedhold or consume gesture timing.
        if (!isJogKey(evt.keyCode)) {
            return;
        }
        // Releases are processed even when disabled, so a key held across a
        // disable can't leave stale pressed-state behind.
        this.intent.release(evt.keyCode);
    };

    // ---- styling ---------------------------------------------------------

    Keyboard.prototype._styleContinuous = function (move) {
        var sel = selectorFor(move);
        if (sel) {
            $(sel).addClass("drive-button-active");
        }
    };

    Keyboard.prototype._styleTransient = function (move) {
        var sel = selectorFor(move);
        if (!sel) return;
        $(sel).addClass("drive-button-active-transient");
        setTimeout(
            function () {
                if (!this.intent.isContinuous()) {
                    $(sel).removeClass("drive-button-active-transient");
                }
            }.bind(this),
            200
        );
    };

    Keyboard.prototype._styleClear = function () {
        $(".drive-button").removeClass("drive-button-active");
        $(".drive-button").removeClass("drive-button-active-transient");
    };

    // ---- host compatibility ---------------------------------------------
    // main.js reads `keyboard.going || keyboard.interval` to ask "is a
    // gesture live"; mirror the intent machine's state.
    Object.defineProperty(Keyboard.prototype, "going", {
        get: function () {
            return this.intent ? this.intent.isContinuous() : false;
        },
    });
    Object.defineProperty(Keyboard.prototype, "interval", {
        get: function () {
            return this.intent ? this.intent.heartbeat : null;
        },
    });

    return Keyboard;
});
