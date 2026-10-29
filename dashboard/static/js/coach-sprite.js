/*
 * coach-sprite.js is the Training Mode coach character: a little ShopBot
 * with a face, drawn to Brian's sketch (PRS profile): blue Y/Z carriage
 * behind a silver spindle riding the light rail lines of the gray beam,
 * leveler feet under the legs, yellow table edge over the open lower
 * frame, and the vacuum manifold between — five ball valves whose red
 * handles spin lazily while he idles or thinks. He hops — chunky,
 * low-framerate — when he loads in at the start of a lesson.
 *
 * His goggle eyes look around the screen (and at whatever the lesson
 * points at), and while an instruction prints the carriage zips across
 * the gantry like a typewriter head, pecking each character onto the
 * table edge. Pixel-art rendering in the style of the labs Ball Mill
 * game: low-res canvas, integer-upscaled with image-rendering: pixelated.
 */
define(function () {
    "use strict";

    var W = 60,
        H = 48,
        SCALE = 2;

    // Palette sampled from Brian's "ShopBot Tutorial Character.png"
    var BLUE = "#0d2aa6",
        BLUE_HI = "#2a48c8",
        BLUE_D = "#081d70",
        GRAY = "#b8b8b8",
        LIGHT = "#e3e3e3",
        DARK = "#6a6a6a",
        BLACK = "#000000",
        WHITE = "#ffffff",
        INK = "#10141c",
        RED = "#ff2020",
        RED_D = "#c01010",
        YEL = "#fad34d",
        YEL_D = "#d8b23a",
        STEEL = "#c8c8c8",
        GOLD = "#d9a420";

    var CONFETTI = [GOLD, BLUE_HI, WHITE, RED, "#7a9ad0"];

    // Carriage geometry: left-edge travel range, fixed sizes
    var CAR_W = 11,
        CAR_MIN = 5,
        CAR_MAX = 44;
    var TABLE_X0 = 7,
        TABLE_X1 = 53; // where typing marks may print (yellow table edge)
    var EYES = [11, 41]; // goggle left edges

    // Valve handles cycle vertical -> mid -> horizontal -> mid -> ...
    var VALVE_SEQ = [0, 1, 2, 1];

    function CoachSprite() {
        this.el = document.createElement("canvas");
        this.el.width = W;
        this.el.height = H;
        this.el.className = "coach-sprite";
        this.el.style.width = W * SCALE + "px";
        this.el.style.height = H * SCALE + "px";
        this._ctx = this.el.getContext("2d");

        this.carX = 24; // carriage left edge (float)
        this.carTarget = this.carX;
        this.carSpeed = 40; // px/s (idle drift)
        this.peck = 0; // frames of bit-peck remaining
        this.marks = []; // printed "text" pixel x positions on the table
        this.typing = false;

        // five manifold valves: seq index + pending spin steps
        this.valves = [];
        for (var i = 0; i < 5; i++) {
            this.valves.push({ x: 8 + i * 8, hy: [36, 35, 37, 36, 35][i], seq: [0, 2, 0, 1, 0][i], spin: 0, t: 0 });
        }

        this.pupil = { x: 0, y: 0 }; // current pupil offset (-2..2, -2..3)
        this.pupilTarget = { x: 0, y: 0 };
        this.lookHold = 0; // seconds an explicit lookAt stays in charge
        this.blink = 0; // seconds of blink remaining
        this._nextBlink = 2 + Math.random() * 3;
        this._nextWander = 1.5;

        this.celebrateT = 0;
        this.confetti = [];

        // load-in hop: timeline index into HOP_FRAMES, advanced on a slow
        // beat so it reads as chunky low-framerate animation
        this.hopT = -1;

        this._raf = null;
        this._last = 0;
        this._destroyed = false;
    }

    // whole-sprite y offsets, one per beat: crouch, leap, land, small bounce
    var HOP_FRAMES = [1, 1, -5, -9, -10, -9, -5, 0, 1, -3, 0];
    var HOP_BEAT = 0.09; // seconds per frame

    CoachSprite.prototype.hop = function () {
        this.hopT = 0;
    };

    CoachSprite.prototype.attach = function (parent) {
        parent.appendChild(this.el);
        this._last = 0;
        var self = this;
        // he hops when he loads in (lesson start builds a fresh sprite)
        setTimeout(function () {
            self.hop();
        }, 350);
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
    // line; newline means carriage-return (zip home, the line is wiped).
    CoachSprite.prototype.typeChar = function (frac, newline) {
        if (newline) {
            this.carTarget = CAR_MIN;
            this.carSpeed = 400;
            this.marks = []; // the work feeds up a line
            return;
        }
        this.carTarget = CAR_MIN + frac * (CAR_MAX - CAR_MIN);
        this.carSpeed = 120;
        this.peck = 2;
        // print where the bit actually is right now
        var bx = Math.round(this.carX + 3);
        if (bx >= TABLE_X0 && bx <= TABLE_X1) this.marks.push(bx);
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
        this.pupilTarget.y = Math.max(-2, Math.min(3, Math.round((vy - cy) / (window.innerHeight / 4))));
        this.lookHold = 4.5;
    };

    CoachSprite.prototype.celebrate = function () {
        this.celebrateT = 2.4;
        this.confetti = [];
        for (var i = 0; i < 22; i++) {
            this.confetti.push({
                x: 2 + Math.random() * (W - 4),
                y: -2 - Math.random() * 14,
                vy: 14 + Math.random() * 22,
                vx: (Math.random() - 0.5) * 8,
                c: CONFETTI[(Math.random() * CONFETTI.length) | 0],
            });
        }
        // every valve spins at once
        this.valves.forEach(function (v) {
            v.spin = 8 + ((Math.random() * 4) | 0);
        });
    };

    CoachSprite.prototype._step = function (dt) {
        // carriage chases its target
        var d = this.carTarget - this.carX;
        var maxStep = this.carSpeed * dt;
        if (Math.abs(d) <= maxStep) this.carX = this.carTarget;
        else this.carX += d > 0 ? maxStep : -maxStep;
        if (this.peck > 0) this.peck--;

        if (this.hopT >= 0) {
            this.hopT += dt;
            if (this.hopT >= HOP_FRAMES.length * HOP_BEAT) this.hopT = -1;
        }

        // valve spinning: pending steps advance the handle every beat
        for (var vi = 0; vi < this.valves.length; vi++) {
            var v = this.valves[vi];
            if (v.spin > 0) {
                v.t += dt;
                var beat = this.celebrateT > 0 ? 0.07 : 0.12;
                if (v.t >= beat) {
                    v.t = 0;
                    v.seq = (v.seq + 1) % VALVE_SEQ.length;
                    v.spin--;
                }
            }
        }

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
                if (f.y > 45) this.confetti.splice(i, 1);
            }
            if (this.celebrateT <= 0) {
                this.confetti = [];
                this.carSpeed = 40;
                this.carTarget = 24;
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
            var bitX = this.carX + 3;
            this.pupilTarget.x = Math.max(-2, Math.min(2, Math.round((bitX - W / 2) / 10)));
            this.pupilTarget.y = 3;
        } else if (this.lookHold > 0) {
            this.lookHold -= dt;
        } else {
            this._nextWander -= dt;
            if (this._nextWander <= 0) {
                this.pupilTarget.x = [-2, -1, 0, 0, 1, 2][(Math.random() * 6) | 0];
                this.pupilTarget.y = [-1, 0, 0, 1][(Math.random() * 4) | 0];
                this._nextWander = 1.4 + Math.random() * 2.4;
                if (this.celebrateT <= 0) {
                    // idle life: sometimes drift the carriage, sometimes
                    // lazily spin one of the manifold valves (Brian's note:
                    // the red knobs turn while he's thinking)
                    if (Math.random() < 0.3) {
                        this.carTarget = CAR_MIN + Math.random() * (CAR_MAX - CAR_MIN);
                        this.carSpeed = 30;
                    } else if (Math.random() < 0.45) {
                        var pick = this.valves[(Math.random() * this.valves.length) | 0];
                        if (pick.spin <= 0) pick.spin = 2 + ((Math.random() * 5) | 0);
                    }
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
        // the load-in hop lifts the whole machine by a stepped offset
        var hop = this.hopT >= 0 ? HOP_FRAMES[Math.min(HOP_FRAMES.length - 1, Math.floor(this.hopT / HOP_BEAT))] : 0;
        function R(x, y, w, h, c) {
            ctx.fillStyle = c;
            ctx.fillRect(x, y + hop, w, h);
        }
        function P(x, y, c) {
            R(x, y, 1, 1, c);
        }

        // --- beam: gray extrusion, light rails the carriage rides, blue caps ---
        R(3, 12, 54, 8, GRAY);
        R(3, 14, 54, 1, LIGHT);
        R(3, 18, 54, 1, LIGHT);
        R(0, 12, 3, 8, BLUE);
        R(0, 12, 1, 8, BLUE_HI);
        R(57, 12, 3, 8, BLUE);
        R(59, 12, 1, 8, BLUE_D);

        // --- table: yellow edge over the blue cross support ---
        R(5, 26, 50, 2, YEL);
        R(5, 27, 50, 1, YEL_D);
        R(2, 28, 56, 4, BLUE);
        R(2, 28, 56, 1, BLUE_HI);
        // printed "text" marks on the table edge
        for (var mi = 0; mi < this.marks.length; mi++) P(this.marks[mi], 26, INK);

        // --- lower frame: legs, gray panel, cross support, manifold ---
        R(2, 32, 3, 10, BLUE);
        R(55, 32, 3, 10, BLUE);
        R(50, 32, 4, 10, GRAY);
        R(50, 32, 1, 10, LIGHT);
        R(2, 42, 56, 3, BLUE);
        R(2, 42, 56, 1, BLUE_HI);
        // leveler feet: screw stem under each leg, wider pad on the floor
        [2, 55].forEach(function (lx) {
            P(lx + 1, 45, STEEL);
            R(lx - 1, 46, 5, 1, BLUE_D);
            R(lx - 1, 47, 5, 1, INK);
        });
        for (var vi = 0; vi < this.valves.length; vi++) {
            var v = this.valves[vi];
            R(v.x, 33, 4, 9, WHITE);
            P(v.x, 33, LIGHT);
            P(v.x + 3, 41, LIGHT);
            var st = VALVE_SEQ[v.seq];
            if (st === 0) {
                R(v.x + 1, v.hy - 3, 2, 8, RED);
                R(v.x, v.hy, 4, 2, RED_D);
            } else if (st === 1) {
                R(v.x + 1, v.hy - 1, 2, 4, RED);
                R(v.x, v.hy, 4, 2, RED);
            } else {
                R(v.x - 2, v.hy, 8, 2, RED);
                R(v.x + 1, v.hy - 1, 2, 4, RED_D);
            }
        }

        var cx = Math.round(this.carX);

        // --- face: goggle eyes perched on the beam ---
        var self = this;
        EYES.forEach(function (ex) {
            R(ex, 6, 8, 10, INK);
            R(ex + 1, 7, 6, 8, WHITE);
            if (self.blink > 0) {
                R(ex + 1, 7, 6, 8, GRAY);
                R(ex + 1, 10, 6, 1, INK); // closed lid
            } else if (happy) {
                // ∪-arc happy eyes
                R(ex + 1, 7, 6, 8, GRAY);
                R(ex + 1, 9, 1, 2, INK);
                R(ex + 6, 9, 1, 2, INK);
                R(ex + 2, 11, 4, 1, INK);
            } else {
                var px = ex + 3 + self.pupil.x;
                var py = 10 + self.pupil.y;
                px = Math.max(ex + 1, Math.min(ex + 5, px));
                py = Math.max(8, Math.min(13, py));
                R(px, py, 2, 2, INK);
            }
            // floating brow (raised when celebrating)
            R(ex, happy ? 2 : 3, 8, 1, DARK);
        });

        // --- Y/Z carriage in front of everything: blue tower + spindle ---
        var dip = this.peck > 0 ? 2 : 0;
        R(cx, 8, CAR_W, 2, BLUE); // cap above the beam
        R(cx, 8, CAR_W, 1, BLUE_HI);
        R(cx, 10, 1, 10, BLUE); // thin blue left cheek
        R(cx + 7, 10, 4, 10, BLUE); // wide blue right side
        R(cx + 10, 10, 1, 10, BLUE_D);
        R(cx + 1, 10, 6, 12 + dip, STEEL); // spindle front
        R(cx + 1, 10, 1, 12 + dip, LIGHT);
        R(cx + 6, 10, 1, 12 + dip, GRAY);
        R(cx + 2, 11, 4, 2, BLACK); // motor louvres
        R(cx + 1, 20, 1, 2, BLUE); // blue hips below the beam
        R(cx + 6, 20, 1, 2, BLUE);
        R(cx + 2, 22 + dip, 4, 2, BLACK); // collet nut
        R(cx + 3, 24 + dip, 2, 2, GRAY); // bit
        P(cx + 3, 24 + dip, LIGHT);

        // --- confetti over everything ---
        for (var k = 0; k < this.confetti.length; k++) {
            var f = this.confetti[k];
            R(Math.round(f.x), Math.round(f.y), 1, 2, f.c);
        }
    };

    return CoachSprite;
});
