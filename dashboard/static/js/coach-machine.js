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

    var W = 224,
        H = 172,
        SCALE = 2;
    var HW = 10,
        HH = 5; // half tile width/height in px
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
        this.moving = false;
        this.spin = 0;
        this.carved = {}; // "i,j" -> true

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
        var status = this.engine.status || {};
        this._onStatus(status);
        this.draw.x = this.target.x;
        this.draw.y = this.target.y;
        this.draw.z = this.target.z;
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
        this.target.x = (status.posx || 0) * u;
        this.target.y = (status.posy || 0) * u;
        this.target.z = status.posz === undefined ? 0.8 : status.posz * u;
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
        var moved = Math.abs(this.draw.x - px) + Math.abs(this.draw.y - py) > 0.0005;
        this.moving = moved || Math.abs(this.target.z - this.draw.z) > 0.001;
        if (this.running || this.moving) this.spin += dt * 22;

        // below Z zero: carve every stock tile the bit passes over
        if (this.draw.z < -0.02) {
            var steps = Math.max(1, Math.ceil((Math.abs(this.draw.x - px) + Math.abs(this.draw.y - py)) / (this.tileIn / 4)));
            for (var s = 0; s <= steps; s++) {
                var ix = Math.floor((px + ((this.draw.x - px) * s) / steps) / this.tileIn);
                var iy = Math.floor((py + ((this.draw.y - py) * s) / steps) / this.tileIn);
                if (ix >= 0 && iy >= 0 && ix < this.TW && iy < this.TH) this.carved[ix + "," + iy] = true;
            }
        }
    };

    // ------------------------------------------------------------ drawing

    CoachMachine.prototype._render = function () {
        var buf = this._buf;
        buf.fill(BG);
        var TW = this.TW,
            TH = this.TH;

        // projection: machine (0,0) is the slab's left corner; +X runs along
        // the front edge toward the viewer's right, +Y recedes up-right.
        var ox = Math.round(W / 2 - ((TW - TH) * HW) / 2);
        var oy = Math.round((H - (TW + TH) * HH) / 2) + 14;
        function proj(x, y, z) {
            return [ox + (x - (TH - y)) * HW, oy + (x + (TH - y)) * HH - z * ZS];
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
            if (i < 0 || j < 0 || i >= TW || j >= TH) return SLAB_BOT;
            return self.carved[i + "," + j] ? CARVE_Z : 0;
        }

        // spoilboard under/around the slab
        for (var si = -1; si <= TW; si++)
            for (var sj = -1; sj <= TH; sj++) tileTop(si, sj, SLAB_BOT, SPOIL[(si + sj) & 1]);

        // slab tiles, back to front (screen order: high x+(TH-y) last)
        for (var sum = 0; sum <= TW - 1 + TH - 1; sum++) {
            for (var i = 0; i <= sum; i++) {
                var j = TH - 1 - (sum - i); // j descending with sum
                if (i >= TW || j < 0 || j >= TH) continue;
                var z = topZ(i, j);
                var carvedHere = z < 0;
                tileTop(i, j, z, carvedHere ? CUT[(i + j) & 1] : STOCK[(i + j) & 1]);
                // front walls: +x face and -y face (both face the viewer)
                var zx = topZ(i + 1, j);
                if (zx < z) {
                    fillPoly([proj(i + 1, j, z), proj(i + 1, j + 1, z), proj(i + 1, j + 1, zx), proj(i + 1, j, zx)], carvedHere ? CUT_WALL : STOCK_WALL);
                }
                var zy = topZ(i, j - 1);
                if (zy < z) {
                    fillPoly([proj(i, j, z), proj(i + 1, j, z), proj(i + 1, j, zy), proj(i, j, zy)], carvedHere ? CUT_WALL : shade(STOCK_WALL, 0.8));
                }
            }
        }

        // ---- the spindle, straight from the Ball Mill ----
        var tx = this.draw.x / this.tileIn,
            ty = this.draw.y / this.tileIn;
        var groundZ = topZ(Math.floor(tx), Math.floor(ty));
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
        // aluminum body: two faces meeting at a front edge, off the top
        fillPoly([[cx + 0.5, bodyBot + 0.5], [cx - BW + 0.5, bodyBot - BW / 2 + 0.5], [cx - BW + 0.5, -2], [cx + 0.5, -2]], TOOL.alL);
        fillPoly([[cx + 0.5, bodyBot + 0.5], [cx + BW + 0.5, bodyBot - BW / 2 + 0.5], [cx + BW + 0.5, -2], [cx + 0.5, -2]], TOOL.alR);
        for (var ey3 = -1; ey3 <= bodyBot; ey3++) pset(cx, ey3, TOOL.alEdge);
        for (var bx = 0; bx <= BW; bx++) {
            var bdy = Math.round(bx / 2);
            pset(cx - bx, bodyBot - bdy, TOOL.alOut);
            pset(cx + bx, bodyBot - bdy, TOOL.alOut);
            pset(cx + bx, bodyBot - bdy - 13, TOOL.alSeam);
        }
        // the maker's mark, left face (vertical, sheared to follow the face)
        for (var li = 0; li < LOGO_PX.length; li++) {
            var lu = 20 - LOGO_PX[li][1];
            var ly = bodyBot - Math.round(lu / 2) - 3 - LOGO_PX[li][0];
            pset(cx - lu, ly, LOGO_INK);
        }
        for (var oy2 = -1; oy2 <= bodyBot - BW / 2; oy2++) {
            pset(cx - BW, oy2, TOOL.alOut);
            pset(cx + BW, oy2, TOOL.alOut);
        }
        for (var vk = 0; vk < 3; vk++)
            for (var vx = 5; vx <= 16; vx++) pset(cx + vx, bodyBot - Math.round(vx / 2) - 24 - vk * 4, TOOL.alSeam);

        this._ctx.putImageData(this._img, 0, 0);
    };

    return CoachMachine;
});
