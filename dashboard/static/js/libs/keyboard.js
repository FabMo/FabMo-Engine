/* eslint-disable no-unused-vars */
/* eslint-disable no-undef */
/* pretty-ignore */
// All turned off for this module

(function (root, factory) {
    /* CommonJS */
    if (typeof module == "object" && module.exports) module.exports = factory();
    /* AMD module */ else if (typeof define == "function" && define.amd)
        define(factory);
    /* Browser global */ else root.WheelControl = factory();
})(this, function () {
    "use strict";

    var DEFAULT_NUDGE_TIMEOUT = 200;
    var DEFAULT_REPEAT_DELAY = 600; // ms held before typematic fixed moves begin
    var DEFAULT_REPEAT_INTERVAL = 250; // ms between typematic fixed moves
    var MOVE_THRESH = 50; //10; // for mouse to disrupt ?
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

    var Keyboard = function (id, options) {
        this.id = id;
        this.elem = this.id ? $(id) : null;
        if (this.elem) {
            this.elem.attr("tabindex", 0);
        }
        this.moves = 0;
        this.init();
        this.enabled = false;
        this.move = null;
        this.going = false;
        this.interval = null;
        this.listeners = { go: [], stop: [], nudge: [], nudgeCancel: [] };
        this.setOptions(options);
        this.nudgeTimer = null;
        this.nudgeTimerKey = null; // keyCode that owns the pending tap window
        this.downJogKeys = {}; // jog keys currently held (keyCode -> true)
        this.fixedGesture = false; // True if the current/last gesture was a fixed-mode nudge
        this.fixedRepeatCount = 0;
    };

    /* Keyboard keys and mouse-keypad keys work similarly, but not identically. Idea is that presses up to a threshold
     length will trigger a "fixed move" (via nudge process) as will any presses with "fixed" button on. Presses longer
     will trigger longer moves assuming "fixed" button off. Stop triggers a g2 feedhold, from 2023 */

    /* Further: th 3/3/23 Per the note above, keyboard.js seems intended to micmick keypad.js in how the visuals on the keypad work.
    But, setEnabled did not appear to be setting any visuals for keyboard arrow keys when they were pressed in 
    modal-keypad (classes are mislabled but action never gets to the call in anycase). I could not figure how "elem", the key
    to the designed functionality, was ever supposed to be handled for the keyboard case (vs the keypad case). I also went back
    a bit in time and did not find evidence that this system ever worked to set a visual indicators that an axis button was
    being pushed from the device keyboard arrows. I have kludged the handling of key display for now. */

    Keyboard.prototype.init = function () {
        if (this.elem) {
            this.elem.on("click", this.onClick.bind(this));
            this.elem.on("focus", this.onFocus.bind(this));
            this.elem.on("mouseenter", this.onMouseEnter.bind(this));
            this.elem.on("blur", this.onBlur.bind(this));
            this.elem.on("mousemove", this.onMouseMove.bind(this));
            this.elem.on("keydown", this.onKeyDown.bind(this));
            this.elem.on("mouseleave", this.onMouseLeave.bind(this));
            this.elem.on("keyup", this.onKeyUp.bind(this));
        } else {
            $(document).on("keydown", this.onKeyDown.bind(this));
            $(document).on("keyup", this.onKeyUp.bind(this));
        }

        // A keyup is never delivered to a blurred window (alt-tab, OS dialog,
        // focus into an iframe) — without this, a held jog key leaves the
        // typematic/refresh loop firing forever from a backgrounded tab.
        // Losing the window or tab is a hard gesture end.
        $(window).on("blur", this._onFocusLost.bind(this));
        document.addEventListener(
            "visibilitychange",
            function () {
                if (document.hidden) this._onFocusLost();
            }.bind(this)
        );
        // Window/tab closing (alt+F4, ctrl+W): fire the stop while the
        // socket can still flush it. The server's disconnect deadman is the
        // backstop if this send doesn't make it out.
        window.addEventListener("pagehide", this._onFocusLost.bind(this));
    };

    Keyboard.prototype._onFocusLost = function () {
        // Keyups are lost to a blurred window — the held-key tracking must
        // reset with the gesture, and a pending tap-start must die too.
        this.downJogKeys = {};
        if (this.nudgeTimer && this.nudgeTimer !== 1) {
            clearTimeout(this.nudgeTimer);
            this.nudgeTimer = null;
            this.nudgeTimerKey = null;
        }
        if (this.going || this.interval) {
            console.warn("Keyboard: window lost focus mid-gesture - forcing stop");
            this.stop();
        }
    };

    Keyboard.prototype.setOptions = function (options) {
        options = options || {};
        this.refreshInterval =
            options.refreshInterval || this.refreshInterval || 50; // from 100 to make more responsive like pad
        this.nudgeTimeout = options.nudgeTimeout != null ? options.nudgeTimeout : DEFAULT_NUDGE_TIMEOUT;
        // Typematic repeat for fixed mode: hold a jog key past repeatDelay
        // and fixed moves keep coming every repeatInterval. Interval 0 (or
        // negative) disables repeating — a hold then yields a single nudge.
        this.repeatDelay = options.nudgeRepeatDelay != null ? options.nudgeRepeatDelay : DEFAULT_REPEAT_DELAY;
        this.repeatInterval = options.nudgeRepeatInterval != null ? options.nudgeRepeatInterval : DEFAULT_REPEAT_INTERVAL;
        console.log("refreshInterval now=" + this.refreshInterval + ", nudgeTimeout=" + this.nudgeTimeout);
    };

    Keyboard.prototype.emit = function (evt, data) {
        if (evt in this.listeners) {
            var listeners = this.listeners[evt];
            for (var i = 0; i < listeners.length; i++) {
                try {
                    listeners[i](data);
                } catch (e) {
                    console.error("Error calling listener: " + e);
                }
            }
        }
    };

    Keyboard.prototype.on = function (evt, func) {
        if (evt in this.listeners) {
            this.listeners[evt].push(func);
        }
    };

    Keyboard.prototype.setEnabled = function (enabled) {
        this.enabled = enabled;
        if (enabled) {
            this.moves = MOVE_THRESH;
            if (this.elem) {
                this.elem
                    .removeClass("keyboard-button-inactive")
                    .addClass("keyboard-button-active");
            }
        } else {
            this.going = false;
            this.moves = 0;
            if (this.elem) {
                this.elem
                    .removeClass("keyboard-button-active")
                    .addClass("keyboard-button-inactive");
            }
        }
    };

    // End the current gesture with the right server command: continuous
    // motion gets a stop (feedhold); a fixed-mode gesture must NOT — the
    // server answers a stop with a feedhold + queue flush that races the
    // nudge's gcode, truncating the move or stranding it in the nudge queue.
    // Instead, if typematic repeats fired, cancel the queued leftovers so
    // motion ends with the in-flight increment.
    Keyboard.prototype._endGesture = function () {
        if (this.fixedGesture) {
            if (this.fixedRepeatCount > 1) {
                this.emit("nudgeCancel", null);
            }
            this.fixedGesture = false;
            this.fixedRepeatCount = 0;
        } else {
            this.emit("stop", null);
        }
    };

    // Keep pumping
    Keyboard.prototype.refresh = function () {
        // Defensive state checks
        if (this.enabled !== true || this.going !== true) {
            console.log("Keyboard: Stopping due to state check", {enabled: this.enabled, going: this.going});
            this._endGesture();
            this.going = false;  // Ensure clean state
            return;
        }

        // Branch on the mode captured at gesture start (see start()) — never
        // re-read the checkbox here.
        if (this.fixedGesture) {
            this.nudgeTimer = 1;
            this.going = true;
            if (this.enabled === true) {
                $(".drive-button").removeClass("drive-button-active");
                this.emit("nudge", this.move);
                // Typematic: while the key stays down, keep nudging. The
                // first repeat waits repeatDelay so a deliberate
                // hold-for-one doesn't double-fire; keyup lands in stop(),
                // which clears this timer.
                if (this.repeatInterval > 0) {
                    var delay = this.fixedRepeatCount === 0 ? this.repeatDelay : this.repeatInterval;
                    this.fixedRepeatCount++;
                    this.interval = setTimeout(this.refresh.bind(this), delay);
                }
            }
        } else {
            if (this.enabled === true) {
                this.emit("go", this.move);
            }
            // Safety timeout limit
            if (this.going === true && this.enabled === true) {
                this.interval = setTimeout(this.refresh.bind(this), this.refreshInterval);
            } else {
                console.warn("Keyboard: Motion terminated due to state change");
                this.emit("stop", null);
            }
        }
    }

    // Get keypad icons to light when keyboard arrow keys are used; see note above
    Keyboard.prototype.start = function (axis, direction, second_axis, second_dir) {
        // Defensive checks
        if (this.going === true) {
            console.warn("Keyboard: Already in motion, ignoring start command");
            return;
        }
        if (this.enabled !== true) {
            console.warn("Keyboard: Not enabled, ignoring start command");
            return;
        }
    
        console.log("Keyboard: Starting motion", axis, direction); 
    
        this.move = { axis: axis, dir: direction };
        if (second_axis) {
            this.move.second_axis = second_axis;
            this.move.second_dir = second_dir;
        }
        this.fixedRepeatCount = 0;
        // Capture the mode ONCE at gesture start. refresh() must not re-read
        // the checkbox mid-hold: toggling Fixed during a gesture (the "d"/"f"
        // hotkey, or clicking the switch) would morph a continuous gesture
        // into a fixed one, so its release sends nudgeCancel instead of the
        // stop the motion needs — a permanent runaway.
        this.fixedGesture = $(".fixed-switch input").is(":checked");
        let activeArrowStr = second_axis
            ? diagSelector(axis, direction, second_axis, second_dir)
            : "#keyboardArrow_" + axis + (direction === 1 ? "_pos" : "_neg");
        if (this.fixedGesture) {
            $(activeArrowStr).addClass("drive-button-active-transient");
        } else {
            $(activeArrowStr).addClass("drive-button-active");
        }
        this.going = true;
        this.refresh();
    };

    Keyboard.prototype.stop = function () {
        console.log("Keyboard: Stop called"); 
        
        this.going = false;
        
        if (this.interval) {
            clearTimeout(this.interval);
            this.interval = null;
        }
        
        if (this.nudgeTimer && this.nudgeTimer !== 1) {
            clearTimeout(this.nudgeTimer);
            this.nudgeTimer = null;
        }

        this._endGesture();
        $(".drive-button").removeClass("drive-button-active");
        $(".drive-button").removeClass("drive-button-active-transient");
    };

    Keyboard.prototype.onClick = function (evt) {
        this.setEnabled(!this.enabled);
    };

    Keyboard.prototype.onFocus = function (evt) {};
    Keyboard.prototype.onMouseEnter = function (evt) {};

    Keyboard.prototype.onBlur = function (evt) {
        this.setEnabled(false);
    };

    Keyboard.prototype.onMouseMove = function (evt) {
        if (this.moves-- <= 0) {
            this.setEnabled(false);
        }
    };

    Keyboard.prototype.onKeyDown = function (evt) {
        // While keyboard jogging is enabled the jog keys belong to us — keep
        // the browser's defaults (stepping a focused speed slider, page
        // scroll, "/" quick-find) out of it. This runs before the
        // going/enabled early-out so held-key auto-repeat events are
        // swallowed too.
        if (this.enabled && isJogKey(evt.keyCode) && !isTextEntry(evt.target)) {
            evt.preventDefault();
        }
        // Track physically-held jog keys regardless of the early-outs below —
        // onKeyUp uses this to enforce "no jog key down, no live gesture".
        if (isJogKey(evt.keyCode)) {
            this.downJogKeys[evt.keyCode] = true;
        }
        if (this.going || !this.enabled) {
            return;
        }
        // Remember the modifier at press time: keyup decides nudge
        // direction, and Alt is often released a beat before the key.
        this.altAtPress = evt.altKey;
        var startForKey = function () {
            if (!this.going) {
                switch (evt.keyCode) {
                    case KEY_UP:
                        this.start("y", 1);
                        break;

                    case KEY_DOWN:
                        this.start("y", -1);
                        break;

                    case KEY_LEFT:
                        this.start("x", -1);
                        break;

                    case KEY_RIGHT:
                        this.start("x", 1);
                        break;

                    case KEY_PGUP:
                        this.start("z", 1);
                        break;

                    case KEY_PGDOWN:
                        this.start("z", -1);
                        break;

                    case KEY_SLASH:
                    case KEY_NUMPAD_DIVIDE:
                        if (evt.altKey) this.start("x", -1, "y", -1);
                        else this.start("x", 1, "y", 1);
                        break;

                    case KEY_BACKSLASH:
                        if (evt.altKey) this.start("x", -1, "y", 1);
                        else this.start("x", 1, "y", -1);
                        break;
                }
            }
        }.bind(this);

        if (this.nudgeTimeout === 0) {
            // No delay — start continuous motion immediately
            this.nudgeTimer = null;
            startForKey();
        } else {
            if (this.nudgeTimer && this.nudgeTimer !== 1) {
                if (evt.keyCode === this.nudgeTimerKey) {
                    // Auto-repeat of the key that owns the tap window —
                    // keep the original timer, or a held key would never
                    // graduate to continuous motion.
                    return;
                }
                // Rollover: a second jog key pressed inside the first key's
                // tap window. The overwrite used to ORPHAN the first timer —
                // it fired after both keys were released, started continuous
                // motion with no keyup left to stop it, and the machine ran
                // away (rapid Z up/down tapping in the field). The window
                // belongs to the newest key; the older press dies silently.
                clearTimeout(this.nudgeTimer);
            }
            this.nudgeTimerKey = evt.keyCode;
            this.nudgeTimer = setTimeout(
                function () {
                    // The fired handle must not stay truthy — onKeyUp routes
                    // on it, and a stale handle sent held-key releases down
                    // the nudge path instead of the stop path.
                    this.nudgeTimer = null;
                    this.nudgeTimerKey = null;
                    startForKey();
                }.bind(this),
                this.nudgeTimeout
            );
        }
    };

    Keyboard.prototype.onMouseLeave = function (evt) {
        this.setEnabled(false);
        if (this.going) {
            this.stop();
        }
    };

    Keyboard.prototype.onKeyUp = function (evt) {
        // Only a jog-key release may end or alter a gesture. The old guard
        // (keyCode >= 27) let any letter key fall through: a stray "d"/"f"
        // release consumed the nudge timer or landed in the stop branch —
        // clearing the button style and feedholding — and then the still-held
        // jog key's auto-repeat restarted motion, so the move never visibly
        // stopped but the server churned through stop/start cycles.
        if (!isJogKey(evt.keyCode)) {
            return;
        }
        delete this.downJogKeys[evt.keyCode];
        this._handleJogKeyUp(evt);
        // Safety net: with no jog key physically down, no pending start and
        // no continuous gesture may survive this event. This is the invariant
        // the rollover runaway violated; enforce it on every jog-key release.
        if (Object.keys(this.downJogKeys).length === 0) {
            if (this.nudgeTimer && this.nudgeTimer !== 1) {
                clearTimeout(this.nudgeTimer);
                this.nudgeTimer = null;
                this.nudgeTimerKey = null;
            }
            if (this.going || this.interval) {
                console.warn("Keyboard: all jog keys up with gesture still live - forcing stop");
                this.stop();
            }
        }
    };

    Keyboard.prototype._handleJogKeyUp = function (evt) {
        if (this.nudgeTimer) {
            // A pending tap window belongs to one specific key (rollover may
            // have cancelled an older key's window). The release of any OTHER
            // key must not consume it — let the owner's keyup decide.
            if (this.nudgeTimer !== 1 && evt.keyCode !== this.nudgeTimerKey) {
                return;
            }
            clearTimeout(this.nudgeTimer);
            this.nudgeTimer = null;
            this.nudgeTimerKey = null;
            if (!this.enabled) {
                return;
            }
            switch (evt.keyCode) {
                case KEY_UP:
                    this.nudge("y", 1);
                    break;

                case KEY_DOWN:
                    this.nudge("y", -1);
                    break;

                case KEY_LEFT:
                    this.nudge("x", -1);
                    break;

                case KEY_RIGHT:
                    this.nudge("x", 1);
                    break;

                case KEY_PGUP:
                    this.nudge("z", 1);
                    break;

                case KEY_PGDOWN:
                    this.nudge("z", -1);
                    break;

                case KEY_SLASH:
                case KEY_NUMPAD_DIVIDE:
                    if (this.altAtPress) this.nudge("x", -1, "y", -1);
                    else this.nudge("x", 1, "y", 1);
                    break;

                case KEY_BACKSLASH:
                    if (this.altAtPress) this.nudge("x", -1, "y", 1);
                    else this.nudge("x", 1, "y", -1);
                    break;
                default:
                    return;
            }
        } else {
            if (this.going || this.enabled) {
                this.stop();
            }
        }
    };

    Keyboard.prototype.nudge = function (axis, direction, second_axis, second_dir) {
        if (this.going) {
            this.going = false;
            return this.stop();
        }
        var nudge = { axis: axis, dir: direction };
        if (second_axis) {
            nudge.second_axis = second_axis;
            nudge.second_dir = second_dir;
        }
        if (this.enabled) {
            // A tap-nudge is a fixed-mode gesture — a later keyup/stop path
            // must not answer it with a feedhold-generating stop.
            this.fixedGesture = true;
            this.emit("nudge", nudge);
            let activeArrowStr = second_axis
                ? diagSelector(axis, direction, second_axis, second_dir)
                : "#keyboardArrow_" + axis + (direction === 1 ? "_pos" : "_neg");
            $(activeArrowStr).addClass("drive-button-active-transient");
            setTimeout(
                function () {
                    if (!this.going) {
                        $(activeArrowStr).removeClass(
                            "drive-button-active-transient"
                        );
                    }
                }.bind(this),
                200
            );
        }
    };

    return Keyboard;
});
