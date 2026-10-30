/*
 * coach-machine.js is the Training Mode machine stage: a small isometric
 * view of the simulated machine, rendered from the same live status stream
 * the DRO follows. The spindle rides over a slab of plywood; moves below
 * Z zero carve it, so a trainee can watch the effect of every jog, homing
 * creep, and plunge as it happens.
 *
 * The renderer (software-rasterized framebuffer, isometric projection,
 * spindle stack with spinning flutes, pixel ShopBot logo) is borrowed from
 * Brian's Ball Mill game at labs.shopbottools.com/apps/ball_mill/.
 */
define(function () {
    "use strict";

    var W = 256,
        H = 160,
        SCALE = 2;
    // Trimetric table axes, screen px per tile. The origin corner faces the
    // viewer: +X climbs up-right, long and shallow (the table reads WIDE),
    // +Y climbs up-left, shorter and steeper. The squashed height keeps the
    // stage usable when the run footer eats the arena.
    var XX = 14,
        XY = 4; // machine +X: right 14, up 4
    var YX = -7,
        YY = 6; // machine +Y: left 7, up 6
    var ZS = 9; // px per inch of Z
    var BR = 4; // bit tip radius
    var BW = 20; // spindle body half-width

    // ---- palette helpers (ABGR little-endian, as in the game) ----
    function rgb(r, g, b) {
        return (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
    }
    function hex(s) {
        return rgb(parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16));
    }
    function shade(c, k) {
        var r = Math.min(255, Math.round((c & 255) * k)),
            g = Math.min(255, Math.round(((c >>> 8) & 255) * k)),
            b = Math.min(255, Math.round(((c >>> 16) & 255) * k));
        return rgb(r, g, b);
    }

    var BG = hex("#101424");
    var STOCK = [hex("#d2a86a"), hex("#c49a5c")]; // plywood checker
    var STOCK_WALL = hex("#8a6a38");
    var CUT = [hex("#a06a30"), hex("#935f29")]; // carved trench floor
    var CUT_WALL = hex("#6a4a1e");
    var SPOIL = [hex("#5a4228"), hex("#50391f")]; // spoilboard under the stock
    var ORIGIN = hex("#e02020"); // XY origin marker at machine (0,0)
    // tiny 3x5 axis labels for the origin marker
    var GLYPH_X = ["X.X", "X.X", ".X.", "X.X", "X.X"];
    var GLYPH_Y = ["X.X", "X.X", ".X.", ".X.", ".X."];
    // the Z-zero plate and its grounding clip (zeroz theater)
    var PLATE = { top: hex("#d8dee4"), hi: hex("#eef2f6"), side: hex("#9aa2aa"), side2: hex("#7c848c"), wire: hex("#202228") };
    var CLIP = { cu: hex("#c87a3a"), cuHi: hex("#e09a56"), grip: hex("#16181e"), gripHi: hex("#343842") };
    var PAT = [hex("#3e6ce2"), hex("#3560cf")]; // practice-path painted cells (checkered blues)
    var TOOL = {
        bit: [hex("#242a34"), hex("#6c7480"), hex("#a8b0bc"), hex("#d8dee6"), hex("#c0c6d0")],
        flute: hex("#3a4250"),
        nut: [hex("#06060a"), hex("#141418"), hex("#26262c"), hex("#42424c"), hex("#383840")],
        shaft: [hex("#303840"), hex("#8c949e"), hex("#c4ccd4"), hex("#eef2f6"), hex("#dce2e8")],
        hub: [hex("#000000"), hex("#101014"), hex("#1e2026"), hex("#3c3e48"), hex("#2a2c34")],
        alL: hex("#c2c6ca"),
        alR: hex("#8e9298"),
        alEdge: hex("#eaeef2"),
        alOut: hex("#3a3e44"),
        alSeam: hex("#6a6e74"),
    };

    // ---- the ShopBot logo: 68x15 pixel mark, stored as a bitmask ----
    var LOGO_ROWS = [
        "......######....#....................#####...........#..............",
        ".....########..##...................#######.........##..............",
        ".....##.....#..##...................##....#.........##..............",
        ".....######....#####....##....####..##..###....##..#####............",
        "......#######..##.###..####..######.##.####...####..##..............",
        "...........###.##..##.##..##.##..##.##...###.##..##.##..............",
        "............##.##..##.##..##.##..##.##....##.##..##.##..............",
        "...........###.##..##.##..##.##..##.##....##.##..##.##..............",
        "#############..##..##..####..#####..#######...####..###############.",
        ".###########....#...#........##......#.###...........#############..",
        ".............................##.............#..##.#.................",
        "..............................#................#....................",
        ".##########################..................#.#..#################.",
        "############################.....................###################",
        ".##################################################################.",
    ];
    var LOGO_PX = [];
    LOGO_ROWS.forEach(function (row, y) {
        for (var x = 0; x < row.length; x++) if (row[x] === "#") LOGO_PX.push([x, y]);
    });
    var LOGO_INK = hex("#202228");

    var rimY = function (hw, x) {
        return Math.round(Math.sqrt(Math.max(0, hw * hw - x * x)) / 2);
    };

    function CoachMachine(engine, options) {
        options = options || {};
        this.engine = engine;
        this.sizeX = options.sizeX || 24; // table envelope, inches
        this.sizeY = options.sizeY || 18;
        this.TW = 12;
        this.TH = Math.max(4, Math.round((this.TW * this.sizeY) / this.sizeX));
        this.tileIn = this.sizeX / this.TW;

        this.visible = false;
        this.el = null;
        this._cv = null;
        this._ctx = null;
        this._img = null;
        this._buf = null;
        this._raf = null;
        this._last = 0;

        this.target = { x: 0, y: 0, z: 0.8 };
        this.draw = { x: 0, y: 0, z: 0.8 };
        this.plateT = 0; // Z-zero plate / grounding clip props (0..1),
        this.plateD = 0; //   target from status, draw value chases
        this.clipT = 0;
        this.clipD = 0;
        this.moving = false;
        this.spin = 0;
        this.carved = {}; // "i,j" -> true (cells CENTERED on the tile grid)
        this.pattern = null; // practice-path cells, "i,j" -> true

        // Registered once, inert while hidden (FabMoAPI has no off()).
        var self = this;
        engine.on("status", function (status) {
            if (self.visible) self._onStatus(status);
        });
    }

    // ---------------------------------------------------------- lifecycle

    CoachMachine.prototype.show = function (options) {
        options = options || {};
        if (options.sizeX) {
            this.sizeX = options.sizeX;
            this.sizeY = options.sizeY || this.sizeY;
            this.TH = Math.max(4, Math.round((this.TW * this.sizeY) / this.sizeX));
            this.tileIn = this.sizeX / this.TW;
        }
        if (!this.el) this._build();
        // Docked in the arena (options.parent): a static panel whose canvas
        // fitTo sizes. Otherwise a floating, draggable panel. The parent is
        // reapplied even when already visible, so a lesson can re-home the
        // stage mid-run without losing its carving.
        this._docked = !!options.parent;
        this.el.classList.toggle("arena", this._docked);
        if (this._docked) {
            this.el.style.left = "";
            this.el.style.top = "";
            this.el.style.right = "";
        } else {
            // undo any arena fitTo sizing
            this._cv.style.width = W * SCALE + "px";
            this._cv.style.height = H * SCALE + "px";
        }
        var parent = options.parent || document.body;
        if (this.el.parentNode !== parent) parent.appendChild(this.el);
        if (this.visible) return;
        this.visible = true;
        this.carved = {};
        this._cx = undefined; // no carve segment across a fresh show
        this._cy = undefined;
        var status = this.engine.status || {};
        this._onStatus(status);
        this.draw.x = this.target.x;
        this.draw.y = this.target.y;
        this.draw.z = this.target.z;
        this.plateD = this.plateT;
        this.clipD = this.clipT;
        var self = this;
        this._last = 0;
        var loop = function (ts) {
            if (!self.visible) return;
            if (!self._last) self._last = ts;
            var dt = Math.min(0.1, (ts - self._last) / 1000);
            self._last = ts;
            self._step(dt);
            self._render();
            self._raf = requestAnimationFrame(loop);
        };
        this._raf = requestAnimationFrame(loop);
    };

    // The keypad lesson paints a path of colored cells on the sheet
    // (array of "i,j" cell keys). Carving a painted cell clears it -- the
    // trench replaces the tint, so progress is visible square by square.
    CoachMachine.prototype.setPattern = function (cells) {
        if (!cells || !cells.length) {
            this.pattern = null;
            return;
        }
        var map = {};
        for (var i = 0; i < cells.length; i++) map[cells[i]] = true;
        this.pattern = map;
    };

    // Arena mode: size the canvas to the largest half-integer multiple of
    // the framebuffer that fits the given box (minus the plate's header and
    // border/shadow ring). Whole scales keep the pixel art perfectly crisp;
    // the half steps are a worthwhile trade when the run footer is eating
    // the arena's height and the next whole scale down would look tiny.
    CoachMachine.prototype.fitTo = function (availW, availH) {
        if (!this.el || !this._cv) return;
        var head = this.el.firstChild ? this.el.firstChild.offsetHeight : 0;
        var frame = 12; // 3px border + 3px shadow ring, both sides
        var s = Math.floor(Math.min((availW - frame) / W, (availH - head - frame) / H) * 2) / 2;
        s = Math.max(1, s);
        var w = Math.round(W * s) + "px";
        if (this._cv.style.width !== w) {
            this._cv.style.width = w;
            this._cv.style.height = Math.round(H * s) + "px";
        }
    };

    CoachMachine.prototype.hide = function () {
        if (!this.visible) return;
        this.visible = false;
        if (this._raf) cancelAnimationFrame(this._raf);
        if (this.el && this.el.parentNode) this.el.parentNode.removeChild(this.el);
    };

    CoachMachine.prototype._build = function () {
        var el = document.createElement("div");
        el.id = "coach-stage";
        var head = document.createElement("div");
        head.className = "coach-stage-head";
        head.textContent = "SIM MACHINE";
        var cv = document.createElement("canvas");
        cv.width = W;
        cv.height = H;
        cv.style.width = W * SCALE + "px";
        cv.style.height = H * SCALE + "px";
        el.appendChild(head);
        el.appendChild(cv);
        this.el = el;
        this._cv = cv;
        this._ctx = cv.getContext("2d");
        this._img = this._ctx.createImageData(W, H);
        this._buf = new Uint32Array(this._img.data.buffer);

        // drag by the header (floating mode only)
        var self2 = this;
        var drag = null;
        head.addEventListener("mousedown", function (e) {
            if (self2._docked) return;
            var r = el.getBoundingClientRect();
            drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
            e.preventDefault();
        });
        document.addEventListener("mousemove", function (e) {
            if (!drag) return;
            el.style.left = Math.max(0, e.clientX - drag.dx) + "px";
            el.style.top = Math.max(0, e.clientY - drag.dy) + "px";
            el.style.right = "auto";
        });
        document.addEventListener("mouseup", function () {
            drag = null;
        });
    };

    // ------------------------------------------------------------- status

    CoachMachine.prototype._onStatus = function (status) {
        var u = status.unit === "mm" ? 1 / 25.4 : 1;
        var nx = (status.posx || 0) * u;
        var ny = (status.posy || 0) * u;
        var nz = status.posz === undefined ? 0.8 : status.posz * u;
        // Carve on the authoritative status stream: the sim advances a
        // fixed dt per tick so these positions never jump, while the
        // cosmetic draw position can teleport diagonally when a
        // main-thread stall starves the RAF loop -- carving from draw
        // missed whole path edges under load.
        if (this._cx !== undefined && nz < -0.02) {
            var steps = Math.max(1, Math.ceil((Math.abs(nx - this._cx) + Math.abs(ny - this._cy)) / (this.tileIn / 4)));
            for (var s = 0; s <= steps; s++) {
                var ix = Math.round((this._cx + ((nx - this._cx) * s) / steps) / this.tileIn);
                var iy = Math.round((this._cy + ((ny - this._cy) * s) / steps) / this.tileIn);
                if (ix >= 0 && iy >= 0 && ix <= this.TW && iy <= this.TH) this.carved[ix + "," + iy] = true;
            }
        }
        this._cx = nx;
        this._cy = ny;
        this.target.x = nx;
        this.target.y = ny;
        this.target.z = nz;
        this.plateT = status.zplate || 0;
        this.clipT = status.zclip || 0;
        this.running = status.state === "running" || status.state === "manual";
    };

    CoachMachine.prototype._step = function (dt) {
        // chase the 250ms status ticks smoothly
        var k = Math.min(1, dt * 9);
        var px = this.draw.x,
            py = this.draw.y;
        this.draw.x += (this.target.x - this.draw.x) * k;
        this.draw.y += (this.target.y - this.draw.y) * k;
        this.draw.z += (this.target.z - this.draw.z) * k;
        this.plateD += (this.plateT - this.plateD) * k;
        this.clipD += (this.clipT - this.clipD) * k;
        var moved = Math.abs(this.draw.x - px) + Math.abs(this.draw.y - py) > 0.0005;
        this.moving = moved || Math.abs(this.target.z - this.draw.z) > 0.001;
        if (this.running || this.moving) this.spin += dt * 22;

        // (carving happens in _onStatus, off the authoritative positions)
    };

    // ------------------------------------------------------------ drawing

    CoachMachine.prototype._render = function () {
        var buf = this._buf;
        buf.fill(BG);
        var TW = this.TW,
            TH = this.TH;

        // projection: machine (0,0) is the slab corner NEAREST the viewer,
        // parked at the bottom of the frame; +X climbs up-right, +Y up-left.
        // Center the slab's screen extent: px spans [TH*YX, TW*XX] around ox.
        var ox = Math.round((W - (TW * XX - TH * YX)) / 2 - TH * YX);
        var oy = H - 18; // room below for the slab wall + spoilboard ring
        function proj(x, y, z) {
            return [ox + x * XX + y * YX, oy - x * XY - y * YY - z * ZS];
        }
        function pset(x, y, c) {
            if (x >= 0 && y >= 0 && x < W && y < H) buf[y * W + x] = c;
        }
        function fillPoly(pts, col) {
            var ymin = Infinity,
                ymax = -Infinity,
                n = pts.length,
                i;
            for (i = 0; i < n; i++) {
                if (pts[i][1] < ymin) ymin = pts[i][1];
                if (pts[i][1] > ymax) ymax = pts[i][1];
            }
            var y0 = Math.max(0, Math.ceil(ymin - 0.5)),
                y1 = Math.min(H - 1, Math.floor(ymax - 0.5));
            for (var y = y0; y <= y1; y++) {
                var yc = y + 0.5,
                    xl = Infinity,
                    xr = -Infinity;
                for (var k = 0; k < n; k++) {
                    var a = pts[k],
                        b = pts[(k + 1) % n];
                    if ((a[1] <= yc && b[1] > yc) || (b[1] <= yc && a[1] > yc)) {
                        var x = a[0] + ((yc - a[1]) / (b[1] - a[1])) * (b[0] - a[0]);
                        if (x < xl) xl = x;
                        if (x > xr) xr = x;
                    }
                }
                if (xl > xr) continue;
                var xa = Math.max(0, Math.ceil(xl - 0.5)),
                    xb = Math.min(W - 1, Math.floor(xr - 0.5));
                for (var xx = xa; xx <= xb; xx++) buf[y * W + xx] = col;
            }
        }
        function tileTop(i, j, z, col) {
            fillPoly([proj(i, j, z), proj(i + 1, j, z), proj(i + 1, j + 1, z), proj(i, j + 1, z)], col);
        }

        var CARVE_Z = -0.35; // visual trench depth, inches
        var SLAB_BOT = -0.75;
        var self = this;
        function topZ(i, j) {
            if (i < 0 || j < 0 || i > TW || j > TH) return SLAB_BOT;
            return self.carved[i + "," + j] ? CARVE_Z : 0;
        }

        // spoilboard under/around the slab
        for (var si = -1; si <= TW; si++)
            for (var sj = -1; sj <= TH; sj++) tileTop(si, sj, SLAB_BOT, SPOIL[(si + sj) & 1]);

        // Slab cells, back to front (both axes climb away from the viewer,
        // so high i+j is far -- paint it first). The cell grid is offset
        // HALF a tile: cell centers, not corners, sit on the machine's tile
        // grid, so the bit rides checker centerlines and carves a centered
        // trench. Edge cells clamp to the slab boundary (half-width).
        var loX = function (i) {
            return Math.max(0, i - 0.5);
        };
        var hiX = function (i) {
            return Math.min(TW, i + 0.5);
        };
        var loY = function (j) {
            return Math.max(0, j - 0.5);
        };
        var hiY = function (j) {
            return Math.min(TH, j + 0.5);
        };
        for (var sum = TW + TH; sum >= 0; sum--) {
            for (var i = 0; i <= sum; i++) {
                var j = sum - i;
                if (i > TW || j > TH) continue;
                var z = topZ(i, j);
                var carvedHere = z < 0;
                var patHere = !carvedHere && self.pattern && self.pattern[i + "," + j];
                fillPoly(
                    [proj(loX(i), loY(j), z), proj(hiX(i), loY(j), z), proj(hiX(i), hiY(j), z), proj(loX(i), hiY(j), z)],
                    carvedHere ? CUT[(i + j) & 1] : patHere ? PAT[(i + j) & 1] : STOCK[(i + j) & 1]
                );
                // near walls: the -x and -y faces (both face the viewer)
                var zx = topZ(i - 1, j);
                if (zx < z) {
                    fillPoly([proj(loX(i), loY(j), z), proj(loX(i), hiY(j), z), proj(loX(i), hiY(j), zx), proj(loX(i), loY(j), zx)], carvedHere ? CUT_WALL : STOCK_WALL);
                }
                var zy = topZ(i, j - 1);
                if (zy < z) {
                    fillPoly([proj(loX(i), loY(j), z), proj(hiX(i), loY(j), z), proj(hiX(i), loY(j), zy), proj(loX(i), loY(j), zy)], carvedHere ? CUT_WALL : shade(STOCK_WALL, 0.8));
                }
            }
        }

        // XY origin marker: a red corner dot at machine (0,0) with short
        // rays up the +X and +Y table edges, anchoring the DRO numbers to a
        // physical corner. Rides the tile top, so it drops if (0,0) carves.
        var oz = topZ(0, 0);
        var og = proj(0, 0, oz);
        for (var mk = 1; mk <= 14; mk++) {
            var mX = proj(mk / 16, 0, oz);
            pset(Math.round(mX[0]), Math.round(mX[1]), ORIGIN);
            var mY = proj(0, mk / 16, oz);
            pset(Math.round(mY[0]), Math.round(mY[1]), ORIGIN);
        }
        for (var mdx = -1; mdx <= 0; mdx++)
            for (var mdy = -1; mdy <= 0; mdy++) pset(Math.round(og[0]) + mdx, Math.round(og[1]) + mdy, ORIGIN);
        // axis letters beside their rays
        function glyph(rows, gx, gy) {
            for (var gr = 0; gr < rows.length; gr++)
                for (var gc = 0; gc < 3; gc++) if (rows[gr][gc] === "X") pset(gx + gc, gy + gr, ORIGIN);
        }
        glyph(GLYPH_X, Math.round(og[0]) + 15, Math.round(og[1]) - 2);
        glyph(GLYPH_Y, Math.round(og[0]) - 14, Math.round(og[1]) - 9);

        // ---- the Z-zero plate: slides in under the bit during the zeroz
        // theater. Flat aluminum bar, ~2x10 inches, with a 30-degree bend
        // at the far end where the wire connects. ----
        if (this.plateD > 0.01) {
            var ti2 = this.tileIn;
            var bitTx = this.draw.x / ti2,
                bitTy = this.draw.y / ti2;
            var slide = ((1 - this.plateD) * 14) / ti2; // rolls in from +X
            var plx0 = bitTx - 2 / ti2 + slide,
                plx1 = bitTx + 8 / ti2 + slide;
            var ply0 = bitTy - 1 / ti2,
                ply1 = bitTy + 1 / ti2;
            var plz = 0.45; // drawn surface height; the bit stops just above
            fillPoly([proj(plx0, ply0, plz), proj(plx1, ply0, plz), proj(plx1, ply1, plz), proj(plx0, ply1, plz)], PLATE.top);
            fillPoly([proj(plx0, ply0, plz), proj(plx0, ply1, plz), proj(plx0, ply1, 0), proj(plx0, ply0, 0)], PLATE.side);
            fillPoly([proj(plx0, ply0, plz), proj(plx1, ply0, plz), proj(plx1, ply0, 0), proj(plx0, ply0, 0)], PLATE.side2);
            // the 30-degree bend tab, wire post on top
            fillPoly(
                [proj(plx1, ply0, plz), proj(plx1, ply1, plz), proj(plx1 + 0.9 / ti2, ply1, plz + 0.55), proj(plx1 + 0.9 / ti2, ply0, plz + 0.55)],
                PLATE.hi
            );
            var plyMid = (ply0 + ply1) / 2;
            var wA = proj(plx1 + 0.9 / ti2, plyMid, plz + 0.55);
            for (var wt = 0; wt <= 22; wt++) {
                var wP = proj(plx1 + (0.9 + wt * 0.2) / ti2, plyMid, (plz + 0.55) * Math.max(0, 1 - wt / 13));
                pset(Math.round(wP[0]), Math.round(wP[1]), PLATE.wire);
            }
            pset(Math.round(wA[0]), Math.round(wA[1]) - 1, PLATE.wire);
        }

        // ---- the spindle, straight from the Ball Mill ----
        var tx = this.draw.x / this.tileIn,
            ty = this.draw.y / this.tileIn;
        var groundZ = topZ(Math.round(tx), Math.round(ty)); // nearest-center cell grid
        var g = proj(tx, ty, groundZ);
        // shadow ellipse on whatever is below
        for (var dy = -2; dy <= 2; dy++) {
            var hw = Math.round(Math.sqrt(Math.max(0, 1 - Math.pow(dy / 2.6, 2))) * 6);
            var yy = Math.round(g[1]) + dy;
            if (yy < 0 || yy >= H) continue;
            for (var dx = -hw; dx <= hw; dx++) {
                var xx2 = Math.round(g[0]) + dx;
                if (xx2 < 0 || xx2 >= W) continue;
                var c0 = buf[yy * W + xx2];
                buf[yy * W + xx2] = (0xff000000 | ((c0 >>> 1) & 0x7f7f7f)) >>> 0;
            }
        }

        var p = proj(tx, ty, Math.max(this.draw.z, groundZ));
        var cx = Math.round(p[0]),
            cy = Math.round(p[1]) - BR;
        var spin = this.spin;

        function cyl(cxx, yTop, yBot, hw, cols, topFace) {
            var out = cols[0],
                dark = cols[1],
                mid = cols[2],
                light = cols[3],
                back = cols[4];
            if (topFace) {
                for (var x = -hw + 1; x < hw; x++) {
                    var ey = rimY(hw, x);
                    for (var y = yTop - ey; y <= yTop + ey; y++) pset(cxx + x, y, back);
                }
            }
            for (var x2 = -hw; x2 <= hw; x2++) {
                var ey2 = rimY(hw, x2);
                var c = mid;
                if (x2 === -hw || x2 === hw) c = out;
                else if (x2 === -hw + 1 || x2 >= hw - 1) c = dark;
                else if (x2 >= -hw + 3 && x2 <= -hw + 4) c = light;
                for (var y2 = yTop + ey2 + (topFace ? 1 : 0); y2 < yBot + ey2; y2++) pset(cxx + x2, y2, c);
                if (topFace) pset(cxx + x2, yTop + ey2, out);
                pset(cxx + x2, yBot + ey2, out);
            }
        }
        function drawBit(cxx, top, cyy, r) {
            var B = TOOL.bit;
            for (var x = -r; x <= r; x++) {
                var ey = rimY(r, x),
                    yb = cyy + Math.round(Math.sqrt(r * r - x * x) - 0.2);
                var c = B[2];
                if (x === -r || x === r) c = B[0];
                else if (x === -r + 1 || x >= r - 1) c = B[1];
                else if (x >= -r + 3 && x <= -r + 4) c = B[3];
                for (var y = top + ey; y < yb; y++) pset(cxx + x, y, y >= cyy + 3 && c === B[3] ? B[2] : c);
                pset(cxx + x, yb, B[0]);
            }
            for (var fy = cyy - 12; fy < cyy + r; fy++) {
                var rowR = fy < cyy ? r : Math.sqrt(Math.max(0, r * r - (fy - cyy) * (fy - cyy)));
                for (var k = 0; k < 2; k++) {
                    var a = spin + k * Math.PI + fy * 0.5;
                    if (Math.sin(a) <= 0.15) continue;
                    var fx = Math.round(Math.cos(a) * (rowR - 0.6));
                    pset(cxx + fx, fy, TOOL.flute);
                    pset(cxx + fx + 1, fy, TOOL.flute);
                }
            }
        }

        var bitTop = cy - 18,
            nutTop = bitTop - 8,
            shaftTop = nutTop - 9,
            hubTop = shaftTop - 11,
            bodyBot = hubTop + 3;
        drawBit(cx, bitTop, cy, BR);
        cyl(cx, nutTop, bitTop, 7, TOOL.nut, true);
        for (var wx = -6; wx <= 6; wx += 4) {
            var wey = rimY(7, wx);
            for (var wy = bitTop + wey - 3; wy < bitTop + wey; wy++) {
                pset(cx + wx, wy, TOOL.nut[0]);
                pset(cx + wx + 1, wy, TOOL.nut[0]);
            }
        }
        cyl(cx, shaftTop, nutTop, 5, TOOL.shaft, false);
        cyl(cx, hubTop - 11, shaftTop, 12, TOOL.hub, false);
        // aluminum body: two faces meeting at a front edge, off the top.
        // Face bottom slopes follow the table's trimetric axes -- the left
        // face recedes along +Y, the right face along +X -- so the spindle
        // sits in the same projection as the slab under it.
        var SLs = YY / -YX; // left-face slope, px up per px left
        var SRs = XY / XX; // right-face slope, px up per px right
        fillPoly([[cx + 0.5, bodyBot + 0.5], [cx - BW + 0.5, bodyBot - BW * SLs + 0.5], [cx - BW + 0.5, -2], [cx + 0.5, -2]], TOOL.alL);
        fillPoly([[cx + 0.5, bodyBot + 0.5], [cx + BW + 0.5, bodyBot - BW * SRs + 0.5], [cx + BW + 0.5, -2], [cx + 0.5, -2]], TOOL.alR);
        for (var ey3 = -1; ey3 <= bodyBot; ey3++) pset(cx, ey3, TOOL.alEdge);
        for (var bx = 0; bx <= BW; bx++) {
            pset(cx - bx, bodyBot - Math.round(bx * SLs), TOOL.alOut);
            pset(cx + bx, bodyBot - Math.round(bx * SRs), TOOL.alOut);
            pset(cx + bx, bodyBot - Math.round(bx * SRs) - 13, TOOL.alSeam);
        }
        // the maker's mark, left face (vertical, sheared to follow the face)
        for (var li = 0; li < LOGO_PX.length; li++) {
            var lu = 20 - LOGO_PX[li][1];
            var ly = bodyBot - Math.round(lu * SLs) - 3 - LOGO_PX[li][0];
            pset(cx - lu, ly, LOGO_INK);
        }
        for (var oyL = -1; oyL <= bodyBot - Math.round(BW * SLs); oyL++) pset(cx - BW, oyL, TOOL.alOut);
        for (var oyR = -1; oyR <= bodyBot - Math.round(BW * SRs); oyR++) pset(cx + BW, oyR, TOOL.alOut);
        for (var vk = 0; vk < 3; vk++)
            for (var vx = 5; vx <= 16; vx++) pset(cx + vx, bodyBot - Math.round(vx * SRs) - 24 - vk * 4, TOOL.alSeam);

        // ---- the grounding clip: copper jaw with black handles, slides in
        // from the right and grips the bit (drawn over the spindle). ----
        if (this.clipD > 0.01) {
            var co = Math.round((1 - this.clipD) * 22); // slide-in offset
            var jawY = cy - 4;
            for (var jx = -BR - 2; jx <= BR + 1; jx++) {
                pset(cx + jx + co, jawY, CLIP.cuHi);
                pset(cx + jx + co, jawY + 1, CLIP.cu);
            }
            pset(cx - BR - 2 + co, jawY - 1, CLIP.cu); // front jaw tooth
            pset(cx - BR - 2 + co, jawY + 2, CLIP.cu);
            for (var hx = 2; hx <= 8; hx++) {
                pset(cx + BR + hx + co, jawY - 1, CLIP.grip);
                pset(cx + BR + hx + co, jawY, CLIP.gripHi); // seam between the two handles
                pset(cx + BR + hx + co, jawY + 1, CLIP.grip);
                pset(cx + BR + hx + co, jawY + 2, CLIP.grip);
            }
            // clip wire drops toward the plate's bend end
            for (var cw = 1; cw <= 7; cw++) pset(cx + BR + 8 + co + Math.round(cw * 0.7), jawY + 2 + cw, PLATE.wire);
        }

        this._ctx.putImageData(this._img, 0, 0);
    };

    return CoachMachine;
});
