/*
 * coach-keypad.js is the Training Mode practice keypad: a simplified
 * direction pad (XY arrows plus Z up/down) that sits beside the sim-machine
 * stage in the coach arena. It drives the simulated tool through the same
 * manual-runtime commands the real motion keypad sends (enter / start /
 * maint heartbeat / stop), so lesson watches can't tell the difference --
 * and the trainee makes the connection when they meet the real keypad.
 */
define(function (require) {
    "use strict";

    var $ = require("jquery");

    var XY_IPS = 2.0; // practice jog speeds, inches/sec (the sim table is inches)
    var Z_IPS = 0.5;
    var BEAT_MS = 330; // the manual runtime's deadman is 1s; stream maint like the real keypad

    function CoachKeypad(engine) {
        this.engine = engine;
        this.el = null;
        this.visible = false;
        this._entered = false; // sent manualEnter, owes a manualExit
        this._beat = null;
        this._exitTimer = null;
    }

    CoachKeypad.prototype.attach = function (parent) {
        var el = $(
            '<div id="coach-keypad">' +
                '<div class="coach-keypad-head">KEYPAD</div>' +
                '<div class="ck-pads">' +
                '<div class="ck-dpad">' +
                '<button class="ck-btn ck-y-pos" data-axis="y" data-dir="1">&#9650;</button>' +
                '<button class="ck-btn ck-x-neg" data-axis="x" data-dir="-1">&#9664;</button>' +
                '<div class="ck-mid">X&nbsp;Y</div>' +
                '<button class="ck-btn ck-x-pos" data-axis="x" data-dir="1">&#9654;</button>' +
                '<button class="ck-btn ck-y-neg" data-axis="y" data-dir="-1">&#9660;</button>' +
                "</div>" +
                '<div class="ck-zpad">' +
                '<button class="ck-btn ck-z-pos" data-axis="z" data-dir="1">&#9650;</button>' +
                '<div class="ck-mid">Z</div>' +
                '<button class="ck-btn ck-z-neg" data-axis="z" data-dir="-1">&#9660;</button>' +
                "</div></div></div>"
        );
        var self = this;
        el.find(".ck-btn").each(function () {
            var btn = this;
            var axis = btn.getAttribute("data-axis");
            var dir = parseInt(btn.getAttribute("data-dir"), 10);
            btn.addEventListener("pointerdown", function (e) {
                e.preventDefault(); // no focus steal, no synthesized mouse events
                try {
                    btn.setPointerCapture(e.pointerId); // keep the hold if the pointer drifts off
                } catch (err) {
                    /* capture unsupported: mouseup elsewhere still releases below */
                }
                btn.classList.add("ck-active");
                self._press(axis, dir);
            });
            var up = function () {
                btn.classList.remove("ck-active");
                self._release();
            };
            btn.addEventListener("pointerup", up);
            btn.addEventListener("pointercancel", up);
        });
        el.on("contextmenu", function (e) {
            e.preventDefault(); // press-and-hold on touch must not open a menu
        });
        this.el = el[0];
        parent.appendChild(this.el);
        this.hide();
    };

    CoachKeypad.prototype.show = function () {
        this.visible = true;
        if (this.el) this.el.style.display = "";
    };

    CoachKeypad.prototype.hide = function () {
        this.visible = false;
        if (this.el) this.el.style.display = "none";
        this._release();
        clearTimeout(this._exitTimer); // exit NOW, not on a timer that could
        this._exitTimer = null; //        fire after the sim shim is gone
        if (this._entered) {
            this.engine.manualExit();
            this._entered = false;
        }
    };

    CoachKeypad.prototype.destroy = function () {
        this.hide();
        if (this.el && this.el.parentNode) this.el.parentNode.removeChild(this.el);
        this.el = null;
    };

    CoachKeypad.prototype._press = function (axis, dir) {
        clearTimeout(this._exitTimer);
        this._exitTimer = null;
        if (!this._entered) {
            this.engine.manualEnter({ hideKeypad: true });
            this._entered = true;
        }
        var ips = axis === "z" ? Z_IPS : XY_IPS;
        this.engine.manualStart(axis, dir * 60.0 * ips); // speed in units/min, as main.js sends
        clearInterval(this._beat);
        var self = this;
        this._beat = setInterval(function () {
            self.engine.manualHeartbeat();
        }, BEAT_MS);
    };

    CoachKeypad.prototype._release = function () {
        if (!this._beat) return;
        clearInterval(this._beat);
        this._beat = null;
        this.engine.manualStop();
        // Drop back to idle after a short lull, like stepping away from the
        // real keypad -- the dashboard re-shows its keypad button (lessons
        // point at it), and the DRO stops reading "manual" between jogs.
        var self = this;
        this._exitTimer = setTimeout(function () {
            self._exitTimer = null;
            if (self._entered) {
                self.engine.manualExit();
                self._entered = false;
            }
        }, 1200);
    };

    return CoachKeypad;
});
