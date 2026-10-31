/* eslint-disable no-undef */
/* eslint-disable no-unused-vars */

/*
 * On-screen keypad jog adapter.
 *
 * Like keyboard.js, this module used to own a full private gesture
 * implementation (going/target/typematic/refresh-loop, ~21 state fields) —
 * the second of two diverging copies whose edge-case differences kept
 * becoming runaway bugs. All gesture state now lives in ONE place,
 * libs/jogintent.js; this file only:
 *
 *   - binds the pointer plumbing per drive button (Hammer tap/press/pan +
 *     raw touch events for slide-off detection) and maps each button's
 *     direction classes to a move
 *   - guards against the exit/goto/zero controls that share the modal
 *   - paints button styling, driven by what was actually commanded
 *   - forwards scroll / window blur / visibility / pagehide as hard ends
 *
 * Tap-vs-hold is classified by the Hammer recognizers here (unlike the
 * keyboard, which uses JogIntent's tap window), so the intent machine runs
 * with tapWindow 0: a press IS continuous motion, a tap is delivered as a
 * one-shot fixed gesture. Mode is per-BUTTON (.drive-button-fixed), passed
 * as the per-press override.
 *
 * The outward surface main.js uses is unchanged: "go"/"stop"/"nudge"/
 * "nudgeCancel"/"exit"/"enter" events, `going`, `target`, `forceStop()`,
 * `setEnabled()`.
 */

(function (root, factory) {
    /* CommonJS */
    if (typeof module == "object" && module.exports) module.exports = factory();
    /* AMD module */
    /* Browser global */ else root.WheelControl = factory(Hammer, $);
})(this, function (Hammer) {
    "use strict";

    var JogIntent;
    if (typeof module == "object" && module.exports) {
        JogIntent = require("./jogintent");
    } else if (typeof window !== "undefined") {
        JogIntent = window.JogIntent;
    }

    var idCounter = 0;

    var Keypad = function (id, options) {
        this.id = id;
        this.elem = $(id);
        this.listeners = { go: [], stop: [], nudge: [], nudgeCancel: [], exit: [], enter: [] };
        this.pressThreshold = 50;
        this.pressTime = 150;
        this.tapInterval = 150;
        this.enabled = false;
        this.target = null; // DOM element of the live gesture (main.js reads this)
        this.targetId = null; // its JogIntent source id
        this.touchStartTime = null;
        this.currentTouchElement = null;
        this.slideOffDetected = false;
        this.nudgeExecuted = false; // dedupe between Hammer press and tap for one gesture

        // The one gesture state machine. tapWindow 0: Hammer already decided
        // tap vs hold by the time we call press().
        this.intent = new JogIntent({ tapWindow: 0 });
        this.setOptions(options);

        // Gesture events come from the intent machine; re-emit them on this
        // object so main.js wiring is unchanged. Styling for gesture END is
        // driven here too, so the buttons can never stay lit after a stop.
        this.intent.on(
            "go",
            function (move) {
                this.emit("go", move);
            }.bind(this)
        );
        this.intent.on(
            "stop",
            function () {
                this._styleClear();
                this.emit("stop", null);
            }.bind(this)
        );
        this.intent.on(
            "nudge",
            function (move) {
                this.emit("nudge", move);
            }.bind(this)
        );
        this.intent.on(
            "nudgeCancel",
            function () {
                this.emit("nudgeCancel", null);
            }.bind(this)
        );

        this.init();
    };

    Keypad.prototype.init = function () {
        var e = this.elem;
        var Hammer = require("./hammer.min.js");

        var drive_buttons = e.find(".drive-button");
        drive_buttons.each(
            function (index, element) {
                var hammer = new Hammer.Manager(element);

                hammer.add(
                    new Hammer.Tap({
                        time: 300,
                        interval: this.tapInterval,
                        threshold: 20,
                        taps: 1,
                    })
                );

                hammer.add(
                    new Hammer.Press({
                        time: Math.max(1, this.pressTime),
                        threshold: this.pressThreshold,
                    })
                );

                hammer.add(new Hammer.Pan({ threshold: this.pressThreshold }));

                hammer.on(
                    "tap",
                    function (evt) {
                        if (this.isExitButtonEvent(evt)) return;
                        // When press_delay is 0, tap also starts continuous motion
                        if (this.pressTime === 0) {
                            this.onDrivePress(evt);
                        } else {
                            this.onDriveTap(evt);
                        }
                    }.bind(this)
                );

                hammer.on(
                    "press",
                    function (evt) {
                        if (this.isExitButtonEvent(evt)) return;
                        this.onDrivePress(evt);
                    }.bind(this)
                );

                hammer.on(
                    "pressup",
                    function (evt) {
                        if (this.isExitButtonEvent(evt)) return;
                        this.nudgeExecuted = false; // Reset for next gesture
                        this.end();
                    }.bind(this)
                );

                hammer.on(
                    "panstart",
                    function (evt) {
                        if (this.isExitButtonEvent(evt)) return;
                        // A press that slid into a pan: no release event is
                        // coming to this element, so end the gesture here —
                        // continuous or fixed hold alike.
                        if (this.going || this.target) {
                            this.forceStop();
                        }
                    }.bind(this)
                );

                $(element).on(
                    "touchstart",
                    function (evt) {
                        if (this.isExitButtonEvent(evt)) return;
                        this.touchStartTime = Date.now();
                        this.currentTouchElement = element;
                    }.bind(this)
                );

                $(element).on(
                    "touchmove",
                    function (evt) {
                        if (this.isExitButtonEvent(evt)) return;
                        if (!this.touchStartTime) return;

                        var touch = evt.originalEvent.touches[0];
                        if (touch) {
                            var elementRect = element.getBoundingClientRect();
                            var isInside =
                                touch.clientX >= elementRect.left &&
                                touch.clientX <= elementRect.right &&
                                touch.clientY >= elementRect.top &&
                                touch.clientY <= elementRect.bottom;

                            if (!isInside) {
                                this.end();
                            }
                        }
                    }.bind(this)
                );

                $(element).on(
                    "touchend",
                    function (evt) {
                        if (this.isExitButtonEvent(evt)) return;
                        this.nudgeExecuted = false; // Reset for next gesture

                        // Only call end if we haven't already handled slide-off
                        if ((this.going || this.target) && !this.slideOffDetected) {
                            this.end();
                        }

                        setTimeout(() => {
                            this.touchStartTime = null;
                            this.currentTouchElement = null;
                            this.slideOffDetected = false;
                        }, 50);
                    }.bind(this)
                );

                $(element).on("blur", this.end.bind(this));
                $(element).on("mouseleave", this.onDriveMouseleave.bind(this));
                $(element).on(
                    "touchcancel",
                    function (evt) {
                        if (this.isExitButtonEvent(evt)) return;
                        this.nudgeExecuted = false; // Reset for next gesture
                        if ((this.going || this.target) && !this.slideOffDetected) {
                            this.forceStop();
                        }
                        this.slideOffDetected = false;
                    }.bind(this)
                );

                element.addEventListener("contextmenu", function (evt) {
                    evt.preventDefault();
                });
            }.bind(this)
        );

        // Bind scroll handler once (outside the .each loop) to avoid duplicate stop commands
        $(document).on("scroll", this.end.bind(this));

        // A pressup/touchend is never delivered to a blurred window (alt-tab,
        // OS dialog) — a held button would leave the gesture loops firing
        // forever from a backgrounded tab. Losing the window or tab is a hard
        // gesture end; forceStop (not end) because the guardAgainstExitButton
        // swallow must not apply to focus loss.
        $(window).on("blur", this.forceStop.bind(this));
        document.addEventListener(
            "visibilitychange",
            function () {
                if (document.hidden) this.forceStop();
            }.bind(this)
        );
        // Window/tab closing (alt+F4, ctrl+W): fire the stop while the
        // socket can still flush it. The server's motion lease is the
        // backstop if this send doesn't make it out.
        window.addEventListener("pagehide", this.forceStop.bind(this));
    };

    // Unconditional gesture end for focus-loss and exit paths. Unlike end(),
    // never swallowed by guardAgainstExitButton() and emits nothing when no
    // gesture is live (window blur happens constantly in normal use). The
    // intent machine emits the stop (continuous) or nudgeCancel (fixed hold
    // with repeats) the live gesture needs.
    Keypad.prototype.forceStop = function () {
        this.target = null;
        this.targetId = null;
        this.enabled = false;
        this.nudgeExecuted = false;
        this.intent.cancelAll();
        this._styleClear();
    };

    // Legacy hard-stop entry point (main.js exit/quit paths). Contract: ends
    // any live gesture AND always emits one "stop" — the callers use it as
    // "make sure the server is not moving", even from idle.
    Keypad.prototype.stop = function () {
        var wasContinuous = this.intent.isContinuous();
        this.forceStop();
        if (!wasContinuous) {
            this.emit("stop", null);
        }
    };

    Keypad.prototype.isExitButtonEvent = function (evt) {
        if (!evt || !evt.target) return false;

        var target = evt.target;
        var $target = $(target);

        // Check multiple ways buttons/controls might be identified
        return (
            // Direct exit button
            $target.hasClass("manual-drive-exit") ||
            $target.closest(".manual-drive-exit").length > 0 ||
            target.id === "manual-drive-exit" ||
            // Action buttons (C2, C3, JH, etc.)
            $target.hasClass("action-button") ||
            $target.closest(".action-button").length > 0 ||
            target.id === "action-1" ||
            target.id === "action-2" ||
            target.id === "action-3" ||
            target.id === "action-4" ||
            target.id === "action-5" ||
            // Go To, Set Coordinates, Manual Stop buttons
            $target.hasClass("go-to") ||
            $target.closest(".go-to").length > 0 ||
            $target.hasClass("set-coordinates") ||
            $target.closest(".set-coordinates").length > 0 ||
            $target.hasClass("manual-stop") ||
            $target.closest(".manual-stop").length > 0 ||
            // Zero buttons
            $target.hasClass("zero-button") ||
            $target.closest(".zero-button").length > 0 ||
            (target.className && target.className.includes("zero-")) ||
            // Speed slider and fixed distance controls
            target.id === "manual-move-speed" ||
            $target.hasClass("slider") ||
            $target.closest(".slidecontainer").length > 0 ||
            $target.hasClass("fixed-switch") ||
            $target.closest(".fixed-switch").length > 0 ||
            $target.hasClass("fixed-step-value") ||
            $target.closest(".fixed-input-container").length > 0 ||
            // Axis input boxes that trigger goto
            $target.hasClass("axi") ||
            $target.hasClass("modal-axi") ||
            target.id === "X" ||
            target.id === "Y" ||
            target.id === "Z" ||
            target.id === "A" ||
            target.id === "B" ||
            target.id === "C" ||
            // Any button or input in the go-to container
            $target.closest(".go-to-container").length > 0 ||
            $target.closest(".read-out-container").length > 0 ||
            // General exit-related text detection
            (target.textContent && target.textContent.toLowerCase().includes("exit")) ||
            (target.textContent && target.textContent.toLowerCase().includes("goto")) ||
            (target.textContent && target.textContent.toLowerCase().includes("zero")) ||
            (target.alt && target.alt.toLowerCase().includes("exit")) ||
            (target.title && target.title.toLowerCase().includes("exit"))
        );
    };

    Keypad.prototype.setOptions = function (options) {
        options = options || {};
        this.refreshInterval = options.refreshInterval || this.refreshInterval || 50;
        this.pressTime = options.pressTime || this.pressTime || 250;
        this.pressThreshold = options.pressThreshold || this.pressThreshold || 10;
        this.tapInterval = options.tapInterval || this.tapInterval || 250;
        // Typematic repeat for fixed mode: hold a direction button past
        // repeatDelay and fixed moves keep coming every repeatInterval.
        // Interval 0 (or negative) disables repeating.
        this.repeatDelay = options.nudgeRepeatDelay != null ? options.nudgeRepeatDelay : 600;
        this.repeatInterval = options.nudgeRepeatInterval != null ? options.nudgeRepeatInterval : 250;
        if (this.intent) {
            this.intent.setOptions({
                tapWindow: 0,
                refreshInterval: this.refreshInterval,
                repeatDelay: this.repeatDelay,
                repeatInterval: this.repeatInterval,
            });
        }
    };

    Keypad.prototype.emit = function (evt, data) {
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

    Keypad.prototype.on = function (evt, func) {
        if (evt in this.listeners) {
            this.listeners[evt].push(func);
        }
    };

    Keypad.prototype.guardAgainstExitButton = function () {
        // Check for any recent button clicks that should disable keypad events
        const now = Date.now();
        const timeout = 500; // ms

        if (
            (window._exitButtonClicked && now - window._exitButtonClicked < timeout) ||
            (window._actionButtonClicked && now - window._actionButtonClicked < timeout) ||
            (window._gotoButtonClicked && now - window._gotoButtonClicked < timeout) ||
            (window._setButtonClicked && now - window._setButtonClicked < timeout) ||
            (window._zeroButtonClicked && now - window._zeroButtonClicked < timeout)
        ) {
            console.log("Ignoring keypad event - control button recently clicked");
            return true;
        }
        return false;
    };

    Keypad.prototype.setEnabled = function (enabled) {
        this.enabled = enabled;
        if (!enabled) {
            this.elem
                .find(".drive-button")
                .addClass("drive-button-inactive")
                .removeClass("drive-button-active");
        }
    };

    Keypad.prototype.enter = function () {
        this.emit("enter", null);
    };

    Keypad.prototype.exit = function () {
        this.emit("exit", null);
    };

    Keypad.prototype.onExitTap = function (evt) {
        this.exit();
    };

    Keypad.prototype.onEnterTap = function (evt) {
        this.enter();
    };

    // A press means a gesture starts NOW: continuous motion for a plain
    // drive button, step + typematic for a fixed-mode one.
    Keypad.prototype.onDrivePress = function (evt) {
        if (this.guardAgainstExitButton()) return;
        var e = $(evt.target);

        // A press landing while another gesture is live (second finger,
        // button-to-button roll) switches to the new button: end the old
        // gesture properly first.
        if (this.intent.isActive()) {
            this.intent.cancelAll();
            this._styleClear();
        }

        var fixed = e.hasClass("drive-button-fixed");
        var move = fixed ? this.nudgeMoveFor(e) : this.startMoveFor(e);
        if (!move) return;

        this.target = evt.target;
        this.targetId = this._idFor(evt.target);
        this.setEnabled(true);

        if (fixed) {
            // Dedupe against the Hammer "tap" that can also fire for a short
            // hold — the press already stepped.
            this.nudgeExecuted = true;
            e.addClass("drive-button-active-transient").removeClass("drive-button-inactive");
        } else {
            e.addClass("drive-button-active").removeClass("drive-button-inactive");
        }

        this.intent.press(this.targetId, move, fixed);
    };

    // A completed quick tap (Hammer classified it): one fixed step, on any
    // drive button — tapping a continuous button nudges, same as it always
    // has. If a gesture is somehow still live, the tap acts as its release.
    Keypad.prototype.onDriveTap = function (evt) {
        if (this.guardAgainstExitButton()) return;
        var e = $(evt.target);

        if (this.intent.isActive()) {
            this.end();
            return;
        }
        if (this.nudgeExecuted) {
            return; // Already executed by press event
        }
        this.nudgeExecuted = true;

        var move = this.nudgeMoveFor(e);
        if (!move) {
            return;
        }
        var id = this._idFor(evt.target);
        this.intent.press(id, move, true); // one-shot fixed gesture
        this.intent.release(id);

        e.addClass("drive-button-active-transient").removeClass("drive-button-inactive");
        setTimeout(
            function () {
                if (!this.going) {
                    e.removeClass("drive-button-active-transient").addClass("drive-button-inactive");
                }
                // Reset flag for next gesture (important for quick taps that don't trigger pressup)
                this.nudgeExecuted = false;
            }.bind(this),
            200
        );
    };

    // Normal release path (pressup / touchend / slide-off). Swallowed when a
    // control button was just clicked — forceStop covers the paths that must
    // never be swallowed.
    Keypad.prototype.end = function () {
        if (this.guardAgainstExitButton()) return;

        var id = this.targetId;
        this.target = null;
        this.targetId = null;
        this.enabled = false;

        if (id != null) {
            // Releasing the owning source ends the gesture with the right
            // server command (stop for continuous, nudgeCancel for a fixed
            // hold whose repeats queued a backlog).
            this.intent.release(id);
        } else {
            this.intent.cancelAll();
        }
        this._styleClear();
    };

    Keypad.prototype.onDriveMouseleave = function (evt) {
        // Don't process mouseleave for exit button
        if ($(evt.target).closest(".manual-drive-exit").length > 0) {
            return;
        }

        // Don't process mouseleave during active touch interactions
        if (this.touchStartTime || this.currentTouchElement) {
            return;
        }

        // End whatever gesture is live — continuous or a fixed-mode hold.
        // Sliding off a button mid-gesture means no release event is coming
        // to this element.
        if (this.going || this.target) {
            console.log("Keypad: Mouse left button mid-gesture - forcing stop");
            this.forceStop();
        } else {
            this.nudgeExecuted = false; // Reset for next gesture
        }
    };

    // Map a drive button's classes to the CONTINUOUS move vocabulary main.js
    // expects on "go": the axis field carries the speed variant (z_fast,
    // a_slow, ...) for the split-speed button columns.
    Keypad.prototype.startMoveFor = function (e) {
        if (e.hasClass("x_pos") && e.hasClass("y_pos")) {
            return { axis: "x", dir: 1, second_axis: "y", second_dir: 1 };
        } else if (e.hasClass("x_neg") && e.hasClass("y_pos")) {
            return { axis: "x", dir: -1, second_axis: "y", second_dir: 1 };
        } else if (e.hasClass("x_neg") && e.hasClass("y_neg")) {
            return { axis: "x", dir: -1, second_axis: "y", second_dir: -1 };
        } else if (e.hasClass("x_pos") && e.hasClass("y_neg")) {
            return { axis: "x", dir: 1, second_axis: "y", second_dir: -1 };
        } else if (e.hasClass("x_pos")) {
            return { axis: "x", dir: 1 };
        } else if (e.hasClass("x_neg")) {
            return { axis: "x", dir: -1 };
        } else if (e.hasClass("y_pos")) {
            return { axis: "y", dir: 1 };
        } else if (e.hasClass("y_neg")) {
            return { axis: "y", dir: -1 };
        } else if (e.hasClass("z_pos_fast")) {
            return { axis: "z_fast", dir: 1 };
        } else if (e.hasClass("z_pos_slow")) {
            return { axis: "z_slow", dir: 1 };
        } else if (e.hasClass("z_neg_fast")) {
            return { axis: "z_fast", dir: -1 };
        } else if (e.hasClass("z_neg_slow")) {
            return { axis: "z_slow", dir: -1 };
        } else if (e.hasClass("a_pos_fast")) {
            return { axis: "a_fast", dir: 1 };
        } else if (e.hasClass("a_pos_slow")) {
            return { axis: "a_slow", dir: 1 };
        } else if (e.hasClass("a_neg_fast")) {
            return { axis: "a_fast", dir: -1 };
        } else if (e.hasClass("a_neg_slow")) {
            return { axis: "a_slow", dir: -1 };
        } else if (e.hasClass("b_pos_fast")) {
            return { axis: "b_fast", dir: 1 };
        } else if (e.hasClass("b_pos_slow")) {
            return { axis: "b_slow", dir: 1 };
        } else if (e.hasClass("b_neg_fast")) {
            return { axis: "b_fast", dir: -1 };
        } else if (e.hasClass("b_neg_slow")) {
            return { axis: "b_slow", dir: -1 };
        } else if (e.hasClass("c_pos")) {
            return { axis: "c", dir: 1 };
        } else if (e.hasClass("c_neg")) {
            return { axis: "c", dir: -1 };
        }
        return null;
    };

    // Map a drive button's direction classes to the NUDGE move vocabulary
    // (plain axis letters — fixed moves don't have speed variants).
    Keypad.prototype.nudgeMoveFor = function (e) {
        if (e.hasClass("x_pos") && e.hasClass("y_pos")) {
            return { axis: "x", dir: 1, second_axis: "y", second_dir: 1 };
        } else if (e.hasClass("x_neg") && e.hasClass("y_pos")) {
            return { axis: "x", dir: -1, second_axis: "y", second_dir: 1 };
        } else if (e.hasClass("x_neg") && e.hasClass("y_neg")) {
            return { axis: "x", dir: -1, second_axis: "y", second_dir: -1 };
        } else if (e.hasClass("x_pos") && e.hasClass("y_neg")) {
            return { axis: "x", dir: 1, second_axis: "y", second_dir: -1 };
        } else if (e.hasClass("x_pos")) {
            return { axis: "x", dir: 1 };
        } else if (e.hasClass("x_neg")) {
            return { axis: "x", dir: -1 };
        } else if (e.hasClass("y_pos")) {
            return { axis: "y", dir: 1 };
        } else if (e.hasClass("y_neg")) {
            return { axis: "y", dir: -1 };
        } else if (e.hasClass("z_pos_fast") || e.hasClass("z_pos_slow")) {
            return { axis: "z", dir: 1 };
        } else if (e.hasClass("z_neg_fast") || e.hasClass("z_neg_slow")) {
            return { axis: "z", dir: -1 };
        } else if (e.hasClass("a_pos_fast") || e.hasClass("a_pos_slow")) {
            return { axis: "a", dir: 1 };
        } else if (e.hasClass("a_neg_fast") || e.hasClass("a_neg_slow")) {
            return { axis: "a", dir: -1 };
        } else if (e.hasClass("b_pos_fast") || e.hasClass("b_pos_slow")) {
            return { axis: "b", dir: 1 };
        } else if (e.hasClass("b_neg_fast") || e.hasClass("b_neg_slow")) {
            return { axis: "b", dir: -1 };
        } else if (e.hasClass("c_pos")) {
            return { axis: "c", dir: 1 };
        } else if (e.hasClass("c_neg")) {
            return { axis: "c", dir: -1 };
        }
        return null;
    };

    Keypad.prototype._styleClear = function () {
        this.elem
            .find(".drive-button")
            .removeClass("drive-button-active")
            .removeClass("drive-button-active-transient")
            .addClass("drive-button-inactive");
    };

    Keypad.prototype._idFor = function (element) {
        if (element.id) return element.id;
        if (!element.__kpid) {
            idCounter += 1;
            element.__kpid = "kpbtn" + idCounter;
        }
        return element.__kpid;
    };

    // ---- host compatibility ---------------------------------------------
    // main.js reads keypad.going (and keypad.target) to ask "is a gesture
    // live"; mirror the intent machine's state.
    Object.defineProperty(Keypad.prototype, "going", {
        get: function () {
            return this.intent ? this.intent.isContinuous() : false;
        },
    });
    Object.defineProperty(Keypad.prototype, "interval", {
        get: function () {
            return this.intent ? this.intent.heartbeat : null;
        },
    });

    return Keypad;
});
