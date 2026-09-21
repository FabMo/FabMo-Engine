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
        this.listeners = { go: [], stop: [], nudge: [] };
        this.setOptions(options);
        this.nudgeTimer = null;
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
    };

    Keyboard.prototype.setOptions = function (options) {
        options = options || {};
        this.refreshInterval =
            options.refreshInterval || this.refreshInterval || 50; // from 100 to make more responsive like pad
        this.nudgeTimeout = options.nudgeTimeout != null ? options.nudgeTimeout : DEFAULT_NUDGE_TIMEOUT;
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

    // Keep pumping
    Keyboard.prototype.refresh = function () {
        // Defensive state checks
        if (this.enabled !== true || this.going !== true) {
            console.log("Keyboard: Stopping due to state check", {enabled: this.enabled, going: this.going});
            this.emit("stop", null);
            this.going = false;  // Ensure clean state
            return;
        }
        
        if ($(".fixed-switch input").is(":checked")) {
            this.nudgeTimer = 1;
            this.going = true;
            if (this.enabled === true) {
                $(".drive-button").removeClass("drive-button-active");
                this.emit("nudge", this.move);
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
        let activeArrowStr = second_axis
            ? diagSelector(axis, direction, second_axis, second_dir)
            : "#keyboardArrow_" + axis + (direction === 1 ? "_pos" : "_neg");
        if ($(".fixed-switch input").is(":checked")) {
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
        
        this.emit("stop", null);
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
            this.nudgeTimer = setTimeout(startForKey, this.nudgeTimeout);
        }
    };

    Keyboard.prototype.onMouseLeave = function (evt) {
        this.setEnabled(false);
        if (this.going) {
            this.stop();
        }
    };

    Keyboard.prototype.onKeyUp = function (evt) {
        if (evt.keyCode < 27) {
            return;
        } // prevents un-needed kills to shift and ctl release
        if (this.nudgeTimer) {
            clearTimeout(this.nudgeTimer);
            this.nudgeTimer = null;
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
