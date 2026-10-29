/*
 * coach-sprite.js is the Training Mode coach character: a little ShopBot
 * gantry machine with a face. Its eyes look around the screen (and at
 * whatever the lesson is pointing at), and while an instruction prints the
 * router carriage zips back and forth across the gantry like a typewriter
 * head, pecking each character onto the sheet on its table. Pixel-art
 * rendering in the style of the labs Ball Mill game: low-res canvas,
 * integer-upscaled with image-rendering: pixelated.
 */
define(function () {
    "use strict";

    var W = 72,
        H = 48,
        SCALE = 2;

    // Palette (ball mill aluminum/steel + ShopBot blue)
    var AL = "#c2c6ca",
        AL_D = "#8e9298",
        AL_HI = "#eaeef2",
        OUT = "#3a3e44",
        SEAM = "#6a6e74",
        BLUE = "#22407a",
        BLUE_HI = "#3a5e9e",
        BLUE_D = "#16294e",
        WOOD = "#c89b63",
        WOOD_D = "#b2854f",
        SHEET = "#e8d5b0",
        SHEET_D = "#d4bd92",
        WHITE = "#ffffff",
        INK = "#10141c",
        STEEL = "#a8b0bc",
        NUT = "#26262c",
        GOLD = "#d9a420";

    var CONFETTI = [GOLD, BLUE_HI, WHITE, "#e8b63a", "#7a9ad0"];

    // Carriage geometry: left edge travel range and fixed sizes
    var CAR_W = 11,
        CAR_MIN = 12,
        CAR_MAX = 49;
    var SHEET_X0 = 12,
        SHEET_X1 = 59;

    function CoachSprite() {
        this.el = document.createElement("canvas");
        this.el.width = W;
        this.el.height = H;
        this.el.className = "coach-sprite";
        this.el.style.width = W * SCALE + "px";
        this.el.style.height = H * SCALE + "px";
        this._ctx = this.el.getContext("2d");

        this.carX = (CAR_MIN + CAR_MAX) / 2; // carriage left edge (float)
        this.carTarget = this.carX;
        this.carSpeed = 40; // px/s (idle drift)
        this.peck = 0; // frames of bit-peck remaining
        this.marks = []; // printed "text" pixel x positions on the sheet
        this.typing = false;

        this.pupil = { x: 0, y: 0 }; // current pupil offset (-2..2, -2..2)
        this.pupilTarget = { x: 0, y: 0 };
        this.lookHold = 0; // seconds an explicit lookAt stays in charge
        this.blink = 0; // seconds of blink remaining
        this._nextBlink = 2 + Math.random() * 3;
        this._nextWander = 1.5;

        this.celebrateT = 0;
        this.confetti = [];

        this._raf = null;
        this._last = 0;
        this._destroyed = false;
    }

    CoachSprite.prototype.attach = function (parent) {
        parent.appendChild(this.el);
        this._last = 0;
        var self = this;
        var loop = function (ts) {
            if (self._destroyed) return;
            if (!self._last) self._last = ts;
            var dt = Math.min(0.1, (ts - self._last) / 1000);
            self._last = ts;
            self._step(dt);
            self._draw();
            self._raf = requestAnimationFrame(loop);
        };
        this._raf = requestAnimationFrame(loop);
    };

    CoachSprite.prototype.destroy = function () {
        this._destroyed = true;
        if (this._raf) cancelAnimationFrame(this._raf);
        if (this.el.parentNode) this.el.parentNode.removeChild(this.el);
    };

    // ------------------------------------------------------------ behavior

    CoachSprite.prototype.startTyping = function () {
        this.typing = true;
        this.marks = [];
        this.carTarget = CAR_MIN;
        this.carSpeed = 400; // zip to the margin first
    };

    // One character printed. frac 0..1 is the position along the current
    // line; newline means carriage-return (zip home, fresh sheet row).
    CoachSprite.prototype.typeChar = function (frac, newline) {
        if (newline) {
            this.carTarget = CAR_MIN;
            this.carSpeed = 400;
            this.marks = []; // the sheet feeds up a line
            return;
        }
        this.carTarget = CAR_MIN + frac * (CAR_MAX - CAR_MIN);
        this.carSpeed = 120;
        this.peck = 2;
        // print where the bit actually is right now
        var bx = Math.round(this.carX + CAR_W / 2);
        if (bx >= SHEET_X0 + 1 && bx <= SHEET_X1 - 1) this.marks.push(bx);
    };

    CoachSprite.prototype.endTyping = function () {
        this.typing = false;
        this.carSpeed = 40;
    };

    // Aim the eyes at a viewport coordinate (e.g. the highlight target).
    CoachSprite.prototype.lookAt = function (vx, vy) {
        var r = this.el.getBoundingClientRect();
        if (!r.width) return;
        var cx = r.left + r.width / 2,
            cy = r.top + r.height / 2;
        this.pupilTarget.x = Math.max(-2, Math.min(2, Math.round((vx - cx) / (window.innerWidth / 5))));
        this.pupilTarget.y = Math.max(-2, Math.min(2, Math.round((vy - cy) / (window.innerHeight / 4))));
        this.lookHold = 4.5;
    };

    CoachSprite.prototype.celebrate = function () {
        this.celebrateT = 2.4;
        this.confetti = [];
        for (var i = 0; i < 22; i++) {
            this.confetti.push({
                x: 4 + Math.random() * (W - 8),
                y: -2 - Math.random() * 14,
                vy: 14 + Math.random() * 22,
                vx: (Math.random() - 0.5) * 8,
                c: CONFETTI[(Math.random() * CONFETTI.length) | 0],
            });
        }
    };

    CoachSprite.prototype._step = function (dt) {
        // carriage chases its target
        var d = this.carTarget - this.carX;
        var maxStep = this.carSpeed * dt;
        if (Math.abs(d) <= maxStep) this.carX = this.carTarget;
        else this.carX += d > 0 ? maxStep : -maxStep;
        if (this.peck > 0) this.peck--;

        // celebrate: zip end to end, rain confetti
        if (this.celebrateT > 0) {
            this.celebrateT -= dt;
            this.carSpeed = 260;
            if (this.carX <= CAR_MIN + 1) this.carTarget = CAR_MAX;
            else if (this.carX >= CAR_MAX - 1) this.carTarget = CAR_MIN;
            for (var i = this.confetti.length - 1; i >= 0; i--) {
                var f = this.confetti[i];
                f.y += f.vy * dt;
                f.x += f.vx * dt;
                if (f.y > 44) this.confetti.splice(i, 1);
            }
            if (this.celebrateT <= 0) {
                this.confetti = [];
                this.carSpeed = 40;
                this.carTarget = (CAR_MIN + CAR_MAX) / 2;
            }
        }

        // eyes
        if (this.blink > 0) this.blink -= dt;
        this._nextBlink -= dt;
        if (this._nextBlink <= 0) {
            this.blink = 0.14;
            this._nextBlink = 2.5 + Math.random() * 3.5;
        }
        if (this.typing) {
            // watch the carriage work
            var bitX = this.carX + CAR_W / 2;
            this.pupilTarget.x = Math.max(-2, Math.min(2, Math.round((bitX - W / 2) / 12)));
            this.pupilTarget.y = 2;
        } else if (this.lookHold > 0) {
            this.lookHold -= dt;
        } else {
            this._nextWander -= dt;
            if (this._nextWander <= 0) {
                this.pupilTarget.x = [-2, -1, 0, 0, 1, 2][(Math.random() * 6) | 0];
                this.pupilTarget.y = [-1, 0, 0, 1][(Math.random() * 4) | 0];
                this._nextWander = 1.4 + Math.random() * 2.4;
                // the occasional idle carriage drift keeps him alive
                if (this.celebrateT <= 0 && Math.random() < 0.3) {
                    this.carTarget = CAR_MIN + Math.random() * (CAR_MAX - CAR_MIN);
                    this.carSpeed = 30;
                }
            }
        }
        // pupils step one pixel at a time (reads as a saccade, not a slide)
        if (this.pupil.x < this.pupilTarget.x) this.pupil.x++;
        else if (this.pupil.x > this.pupilTarget.x) this.pupil.x--;
        if (this.pupil.y < this.pupilTarget.y) this.pupil.y++;
        else if (this.pupil.y > this.pupilTarget.y) this.pupil.y--;
    };

    // ------------------------------------------------------------- drawing

    CoachSprite.prototype._draw = function () {
        var ctx = this._ctx;
        var happy = this.celebrateT > 0;
        ctx.clearRect(0, 0, W, H);
        function R(x, y, w, h, c) {
            ctx.fillStyle = c;
            ctx.fillRect(x, y, w, h);
        }

        // --- end plates (ShopBot blue uprights, down to the feet) ---
        [3, 61].forEach(function (x) {
            R(x, 5, 8, 39, BLUE);
            R(x, 5, 2, 39, BLUE_HI); // lit left edge
            R(x + 7, 5, 1, 39, BLUE_D);
            R(x - 1, 44, 10, 2, OUT); // foot
        });

        // --- table + sheet of material ---
        R(1, 36, 70, 4, WOOD);
        R(1, 36, 70, 1, WOOD_D);
        R(1, 40, 70, 1, OUT);
        R(SHEET_X0, 32, SHEET_X1 - SHEET_X0, 4, SHEET);
        R(SHEET_X0, 35, SHEET_X1 - SHEET_X0, 1, SHEET_D);
        R(SHEET_X0, 32, 1, 4, SHEET_D);
        // printed "text" marks
        for (var i = 0; i < this.marks.length; i++) R(this.marks[i], 33, 1, 1, INK);

        // --- gantry beam across the top ---
        R(2, 5, 68, 12, AL);
        R(2, 5, 68, 1, AL_HI);
        R(2, 16, 68, 1, AL_D);
        R(2, 4, 68, 1, OUT);
        R(2, 17, 68, 1, OUT);
        R(2, 11, 68, 1, SEAM); // extrusion groove

        // --- face: two goggle eyes on the beam ---
        var self = this;
        [21, 43].forEach(function (ex) {
            R(ex, 5, 8, 10, INK); // outline
            R(ex + 1, 6, 6, 8, WHITE);
            if (self.blink > 0) {
                R(ex + 1, 6, 6, 8, AL);
                R(ex + 1, 9, 6, 1, INK); // closed lid
            } else if (happy) {
                // ∪-arc happy eyes
                R(ex + 1, 6, 6, 8, AL);
                R(ex + 1, 8, 1, 2, INK);
                R(ex + 6, 8, 1, 2, INK);
                R(ex + 2, 10, 4, 1, INK);
            } else {
                var px = ex + 3 + self.pupil.x;
                var py = 9 + self.pupil.y;
                px = Math.max(ex + 1, Math.min(ex + 5, px));
                py = Math.max(7, Math.min(12, py));
                R(px, py, 2, 2, INK);
            }
        });
        // brows (raised when celebrating)
        R(21, happy ? 1 : 2, 8, 1, OUT);
        R(43, happy ? 1 : 2, 8, 1, OUT);

        // --- router carriage riding the beam ---
        var cx = Math.round(this.carX);
        var dip = this.peck > 0 ? 1 : 0;
        R(cx, 13 + dip, CAR_W, 9, AL);
        R(cx, 13 + dip, CAR_W, 1, AL_HI);
        R(cx, 21 + dip, CAR_W, 1, OUT);
        R(cx, 13 + dip, 1, 9, OUT);
        R(cx + CAR_W - 1, 13 + dip, 1, 9, OUT);
        R(cx + 2, 15 + dip, CAR_W - 4, 2, BLUE); // blue badge stripe
        // spindle: hub, collet nut, bit
        var sx = cx + Math.floor(CAR_W / 2) - 2;
        R(sx, 22 + dip, 5, 3, NUT);
        R(sx + 1, 25 + dip, 3, 1, OUT);
        var peckDrop = this.peck > 0 ? 2 : 0;
        R(sx + 1, 26 + dip, 2, 4 + peckDrop, STEEL);
        R(sx + 1, 26 + dip, 1, 4 + peckDrop, AL_HI);

        // --- confetti over everything ---
        for (var k = 0; k < this.confetti.length; k++) {
            var f = this.confetti[k];
            R(Math.round(f.x), Math.round(f.y), 1, 2, f.c);
        }
    };

    return CoachSprite;
});
