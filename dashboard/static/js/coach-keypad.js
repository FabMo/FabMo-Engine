/*
 * coach-keypad.js is the Training Mode practice keypad: the real motion
 * keypad's direction pad (same markup classes and SVG arrow glyphs as
 * #keypad in index.html, which are styled by class in style.css), minus
 * everything that isn't an arrow -- no position readout, speed slider,
 * fixed-step inputs, or command buttons. It sits beside the sim-machine
 * stage in the coach arena and drives the simulated tool through the same
 * manual-runtime commands the real keypad sends (enter / start / maint
 * heartbeat / stop), so lesson watches can't tell the difference -- and
 * the real keypad looks like an old friend afterward.
 */
define(function (require) {
    "use strict";

    var $ = require("jquery");

    var XY_IPS = 2.0; // practice jog speeds, inches/sec (the sim table is inches)
    var Z_SLOW_IPS = 0.5;
    var Z_FAST_IPS = 1.0;
    var BEAT_MS = 330; // the manual runtime's deadman is 1s; stream maint like the real keypad
    var DIAG = Math.SQRT1_2; // diagonal squares split the speed across both axes

    // The real keypad's arrow glyphs (index.html #keypad), verbatim.
    var ARROW =
        "M55.2 13.7 L83.8 39.3 Q89 44 89 51 L89 83 Q89 90 82 90 L18 90 Q11 90 11 83 " +
        "L11 51 Q11 44 16.2 39.3 L44.8 13.7 Q50 9 55.2 13.7 Z";
    var ARROW_DIAG =
        "M54.6 14.3 L75.4 38.7 Q80 44 80 51 L80 83 Q80 90 73 90 L27 90 Q20 90 20 83 " +
        "L20 51 Q20 44 24.6 38.7 L45.4 14.3 Q50 9 54.6 14.3 Z";
    var ARROW_TALL =
        "M55.2 13.7 L83.8 39.3 Q89 44 89 51 L89 101 Q89 108 82 108 L18 108 Q11 108 11 101 " +
        "L11 51 Q11 44 16.2 39.3 L44.8 13.7 Q50 9 55.2 13.7 Z";
    var CHEVRONS = "M20 26 L50 6 L80 26 M20 58 L50 38 L80 58";

    function squareSvg(rot, label) {
        return (
            '<svg class="dir-glyph" viewBox="0 0 100 100" aria-hidden="true">' +
            "<g" + (rot ? ' transform="rotate(' + rot + ' 50 50)"' : "") + ">" +
            '<path class="glyph-shape" d="' + ARROW + '"></path>' +
            '<text class="glyph-label" x="50" y="58" text-anchor="middle"' +
            (rot ? ' transform="rotate(' + -rot + ' 50 58)"' : "") + ">" + label + "</text>" +
            "</g></svg>"
        );
    }
    function diagSvg(rot) {
        return (
            '<svg class="dir-glyph diag" viewBox="0 0 100 100" aria-hidden="true">' +
            '<g transform="rotate(' + rot + ' 50 50) translate(16 16) scale(0.68)">' +
            '<path class="glyph-shape" d="' + ARROW_DIAG + '"></path></g></svg>'
        );
    }
    function zSlowSvg(dir) {
        return (
            '<svg class="dir-glyph" viewBox="0 0 100 120" aria-hidden="true">' +
            "<g" + (dir < 0 ? ' transform="rotate(180 50 60)"' : "") + ">" +
            '<path class="glyph-shape" d="' + ARROW_TALL + '"></path>' +
            '<text class="glyph-label" x="50" y="67" text-anchor="middle"' +
            (dir < 0 ? ' transform="rotate(-180 50 67)"' : "") + ">" +
            (dir < 0 ? "Z -" : "Z +") + "</text></g></svg>"
        );
    }
    function zFastSvg(dir) {
        return (
            '<svg class="dir-glyph fastz" viewBox="0 0 100 64" aria-hidden="true">' +
            '<g class="glyph-stroke"' + (dir < 0 ? ' transform="rotate(180 50 32)"' : "") + ">" +
            '<path d="' + CHEVRONS + '"></path></g></svg>'
        );
    }

    // 3x3 XY pad, reading order; null = the center cell (the real keypad
    // parks its joystick indicator there; ours stays empty).
    var SQUARES = [
        { cls: "x_neg y_pos", svg: diagSvg(-45), dx: -1, dy: 1 },
        { cls: "y_pos", svg: squareSvg(0, "Y +"), dx: 0, dy: 1 },
        { cls: "x_pos y_pos", svg: diagSvg(45), dx: 1, dy: 1 },
        { cls: "x_neg", svg: squareSvg(-90, "X -"), dx: -1, dy: 0 },
        null,
        { cls: "x_pos", svg: squareSvg(90, "X +"), dx: 1, dy: 0 },
        { cls: "x_neg y_neg", svg: diagSvg(-135), dx: -1, dy: -1 },
        { cls: "y_neg", svg: squareSvg(180, "Y -"), dx: 0, dy: -1 },
        { cls: "x_pos y_neg", svg: diagSvg(135), dx: 1, dy: -1 },
    ];
    var Z_BARS = [
        { cls: "z_pos_fast", bar: "keypad-bar-small top", svg: zFastSvg(1), dz: 1, fast: true },
        { cls: "z_pos_slow", bar: "keypad-bar top", svg: zSlowSvg(1), dz: 1 },
        { cls: "z_neg_slow", bar: "keypad-bar bottom", svg: zSlowSvg(-1), dz: -1 },
        { cls: "z_neg_fast", bar: "keypad-bar-small bottom", svg: zFastSvg(-1), dz: -1, fast: true },
    ];

    function CoachKeypad(engine) {
        this.engine = engine;
        this.el = null;
        this.visible = false;
        this._entered = false; // sent manualEnter, owes a manualExit
        this._beat = null;
        this._exitTimer = null;
    }

    CoachKeypad.prototype.attach = function (parent) {
        var html = '<div id="coach-keypad"><div class="coach-keypad-head">KEYPAD</div><div class="pad-container">';
        html += '<div class="keypad-table">';
        SQUARES.forEach(function (sq) {
            html += '<div class="keypad-cell">';
            if (sq) html += '<div class="' + sq.cls + ' keypad-button drive-button square">' + sq.svg + "</div>";
            html += "</div>";
        });
        html += '</div><div class="z-pad">';
        Z_BARS.forEach(function (zb) {
            html += '<div class="' + zb.bar + '"><div class="' + zb.cls + ' keypad-button drive-button bar">' + zb.svg + "</div></div>";
        });
        html += "</div></div></div>";
        var el = $(html);

        var moves = SQUARES.filter(Boolean).concat(Z_BARS);
        var self = this;
        el.find(".drive-button").each(function (i) {
            var btn = this;
            var move = moves[i];
            btn.addEventListener("pointerdown", function (e) {
                e.preventDefault(); // no focus steal, no synthesized mouse events
                try {
                    btn.setPointerCapture(e.pointerId); // keep the hold if the pointer drifts off
                } catch (err) {
                    /* capture unsupported: mouseup elsewhere still releases below */
                }
                btn.classList.add("drive-button-active"); // the real keypad's green driving state
                self._press(move);
            });
            var up = function () {
                btn.classList.remove("drive-button-active");
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

    CoachKeypad.prototype._press = function (move) {
        clearTimeout(this._exitTimer);
        this._exitTimer = null;
        if (!this._entered) {
            this.engine.manualEnter({ hideKeypad: true });
            this._entered = true;
        }
        // speed in units/min, as main.js sends
        if (move.dz) {
            this.engine.manualStart("z", move.dz * 60.0 * (move.fast ? Z_FAST_IPS : Z_SLOW_IPS));
        } else {
            var s = 60.0 * XY_IPS * (move.dx && move.dy ? DIAG : 1);
            if (move.dx && move.dy) this.engine.manualStart("x", move.dx * s, "y", move.dy * s);
            else if (move.dx) this.engine.manualStart("x", move.dx * s);
            else this.engine.manualStart("y", move.dy * s);
        }
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
