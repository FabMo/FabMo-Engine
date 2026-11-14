/*
 * Print Registration — app logic.
 *
 * Three ways to find the printed marks:
 *   sim     a virtual sheet + virtual camera (no hardware; never moves the tool)
 *   manual  operator jogs the bit over each mark and presses Capture
 *   camera  a plumb, downward camera beside the spindle (camera-server :3142)
 *
 * The result is a fit (RegCore) written to the engine's opensbp `transforms`,
 * then the job is queued with its Regmarks toolpath stripped.
 */
(function () {
    "use strict";

    var core = window.RegCore;
    var fabmo = new FabMoDashboard();
    var LIVE = fabmo.isPresent();
    var $ = function (id) {
        return document.getElementById(id);
    };

    var DEFAULTS = { source: "sim", pxPerUnit: 400, camRotDeg: 0, offX: 0, offY: 0, markDia: 0.25, maxResidual: 0.01 };
    var SIM_W = 640,
        SIM_H = 480;

    var S = {
        set: Object.assign({}, DEFAULTS),
        job: null, // { name, parsed }
        found: [], // by mark index: {x, y} on the table
        order: [],
        fit: null,
        res: null,
        sim: { truth: null, tool: { x: 0, y: 0 } },
        status: { state: LIVE ? "" : "offline", posx: 0, posy: 0, unit: "in" },
        busy: false,
        abort: false,
        activeCorrection: false,
        pendingJob: null, // { name, started }
        frame: { w: SIM_W, h: SIM_H },
        calHole: null,
    };

    // ------------------------------------------------------------------ utils

    function sleep(ms) {
        return new Promise(function (r) {
            setTimeout(r, ms);
        });
    }
    function fmt(v, n) {
        return (v === undefined || v === null || isNaN(v) ? "—" : Number(v).toFixed(n === undefined ? 3 : n));
    }
    function progress(msg, err) {
        var el = $("progress");
        el.textContent = msg || "";
        el.className = "rg-progress" + (err ? " err" : "");
    }
    function cam() {
        return { pxPerUnit: S.set.pxPerUnit, rotDeg: S.set.camRotDeg, width: S.frame.w, height: S.frame.h };
    }
    function toolPos() {
        return S.set.source === "sim" ? S.sim.tool : { x: S.status.posx, y: S.status.posy };
    }
    function camPos() {
        var t = toolPos();
        return { x: t.x + S.set.offX, y: t.y + S.set.offY };
    }
    function marks() {
        return S.job ? S.job.parsed.marks : [];
    }
    function foundPairs() {
        var src = [],
            dst = [];
        marks().forEach(function (m, i) {
            if (S.found[i]) {
                src.push(m);
                dst.push(S.found[i]);
            }
        });
        return { src: src, dst: dst };
    }
    function nextIndex() {
        for (var n = 0; n < S.order.length; n++) if (!S.found[S.order[n]]) return S.order[n];
        return -1;
    }

    // ---------------------------------------------------------------- machine

    function moveTool(x, y) {
        return new Promise(function (resolve, reject) {
            if (!LIVE) return reject(new Error("Not connected to a machine"));
            fabmo.runSBP("J2," + x.toFixed(4) + "," + y.toFixed(4), function (err) {
                if (err) return reject(new Error(err.message || String(err)));
                var t0 = Date.now();
                (function poll() {
                    if (S.abort) return reject(new Error("Stopped"));
                    var st = S.status;
                    var there = Math.abs(st.posx - x) < 0.003 && Math.abs(st.posy - y) < 0.003;
                    if (there && st.state === "idle") return setTimeout(resolve, 400); // let the camera settle
                    if (Date.now() - t0 > 90000) return reject(new Error("Move did not finish"));
                    if (Date.now() - t0 > 1500 && st.state !== "running" && st.state !== "idle") {
                        return reject(new Error("Machine is " + st.state + " — move not completed"));
                    }
                    fabmo.requestStatus();
                    setTimeout(poll, 150);
                })();
            });
        });
    }

    // Put the CAMERA over a table point
    function moveCam(p) {
        var x = p.x - S.set.offX,
            y = p.y - S.set.offY;
        if (S.set.source === "sim") {
            S.sim.tool = { x: x, y: y };
            drawTable();
            return sleep(300);
        }
        return moveTool(x, y);
    }

    // ----------------------------------------------------------------- frames

    function simDesignToPixel() {
        // pixel = centre + s * F * R(-rot) * (table - camera), composed with truth
        var c = cam(),
            r = (c.rotDeg * Math.PI) / 180,
            s = c.pxPerUnit,
            C = camPos(),
            T = S.sim.truth;
        var m00 = s * Math.cos(r),
            m01 = s * Math.sin(r),
            m10 = s * Math.sin(r),
            m11 = -s * Math.cos(r);
        var tx = SIM_W / 2 - (m00 * C.x + m01 * C.y),
            ty = SIM_H / 2 - (m10 * C.x + m11 * C.y);
        return {
            a: m00 * T.a + m01 * T.c,
            b: m00 * T.b + m01 * T.d,
            c: m10 * T.a + m11 * T.c,
            d: m10 * T.b + m11 * T.d,
            tx: m00 * T.tx + m01 * T.ty + tx,
            ty: m10 * T.tx + m11 * T.ty + ty,
        };
    }

    function sheetRect() {
        var ms = marks();
        var pad = 2.4 * S.set.markDia;
        var xs = ms.map(function (m) {
                return m.x;
            }),
            ys = ms.map(function (m) {
                return m.y;
            });
        return {
            x0: Math.min.apply(null, xs) - pad,
            y0: Math.min.apply(null, ys) - pad,
            x1: Math.max.apply(null, xs) + pad,
            y1: Math.max.apply(null, ys) + pad,
        };
    }

    // The printed sheet in design coordinates (ctx already transformed)
    function paintSheet(ctx) {
        var r = sheetRect();
        ctx.fillStyle = "#f4f2ec";
        ctx.fillRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
        var colors = ["#1f6fb2", "#e2731c", "#7a3fa0", "#2a9d8f"];
        S.job.parsed.paths.forEach(function (p, i) {
            ctx.beginPath();
            p.forEach(function (q, k) {
                if (k) ctx.lineTo(q.x, q.y);
                else ctx.moveTo(q.x, q.y);
            });
            ctx.fillStyle = colors[i % colors.length];
            ctx.fill();
        });
        ctx.fillStyle = "#101010";
        marks().forEach(function (m) {
            ctx.beginPath();
            ctx.arc(m.x, m.y, S.set.markDia / 2, 0, 2 * Math.PI);
            ctx.fill();
        });
    }

    function simFrame() {
        var cv = $("cam-view");
        cv.width = SIM_W;
        cv.height = SIM_H;
        S.frame = { w: SIM_W, h: SIM_H };
        var ctx = cv.getContext("2d", { willReadFrequently: true });
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = "#9c8a6c"; // spoilboard
        ctx.fillRect(0, 0, SIM_W, SIM_H);
        var P = simDesignToPixel();
        ctx.setTransform(P.a, P.c, P.b, P.d, P.tx, P.ty);
        paintSheet(ctx);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        var img = ctx.getImageData(0, 0, SIM_W, SIM_H);
        var d = img.data;
        for (var i = 0; i < d.length; i += 4) {
            var nz = (Math.random() - 0.5) * 22; // sensor noise
            d[i] += nz;
            d[i + 1] += nz;
            d[i + 2] += nz;
        }
        ctx.putImageData(img, 0, 0);
        return img;
    }

    function cameraFrame() {
        return new Promise(function (resolve, reject) {
            var im = $("cam-stream");
            var grab = function () {
                try {
                    var cv = $("cam-view");
                    cv.width = im.naturalWidth;
                    cv.height = im.naturalHeight;
                    S.frame = { w: cv.width, h: cv.height };
                    var ctx = cv.getContext("2d", { willReadFrequently: true });
                    ctx.drawImage(im, 0, 0);
                    resolve(ctx.getImageData(0, 0, cv.width, cv.height));
                } catch (e) {
                    reject(new Error("Could not read the camera image (" + e.message + ")"));
                }
            };
            if (im.dataset.on && im.naturalWidth) return grab();
            im.dataset.on = "1";
            var timer = setTimeout(function () {
                reject(new Error("No picture from the camera (camera server on port 3142)"));
            }, 5000);
            im.onload = function () {
                clearTimeout(timer);
                im.onload = null;
                setTimeout(grab, 150);
            };
            im.onerror = function () {
                clearTimeout(timer);
                delete im.dataset.on;
                reject(new Error("Camera server not reachable on port 3142"));
            };
            im.src = "http://" + location.hostname + ":3142/?" + Math.random();
        });
    }

    function overlay(det) {
        var cv = $("cam-view"),
            ctx = cv.getContext("2d");
        var w = cv.width,
            h = cv.height;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.strokeStyle = "rgba(255,255,255,0.75)";
        ctx.lineWidth = Math.max(1, w / 640);
        ctx.beginPath();
        ctx.moveTo(w / 2, 0);
        ctx.lineTo(w / 2, h);
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
        ctx.stroke();
        if (det && det.found) {
            ctx.strokeStyle = "#27e07a";
            ctx.lineWidth = Math.max(2, w / 320);
            ctx.beginPath();
            ctx.arc(det.x, det.y, det.diaPx / 2 + 4, 0, 2 * Math.PI);
            ctx.moveTo(det.x - 8, det.y);
            ctx.lineTo(det.x + 8, det.y);
            ctx.moveTo(det.x, det.y - 8);
            ctx.lineTo(det.x, det.y + 8);
            ctx.stroke();
        }
        var fov = w / S.set.pxPerUnit;
        $("cam-info").textContent =
            w + "×" + h + " · sees " + fmt(fov, 2) + " × " + fmt(h / S.set.pxPerUnit, 2) + " " + S.status.unit +
            (det ? (det.found ? " · dot found" : " · no dot in view") : "");
    }

    // Take a picture and look for a dot. expectSize=false for calibration holes.
    function locate(expectSize) {
        var get = S.set.source === "sim" ? Promise.resolve().then(simFrame) : cameraFrame();
        return get.then(function (img) {
            var det = core.detectDot(img, expectSize === false ? {} : { expectedDiaPx: S.set.markDia * S.set.pxPerUnit });
            overlay(det);
            if (det.found) {
                var off = core.pixelToOffset(det.u, det.v, cam());
                var c = camPos();
                det.pos = { x: c.x + off.x, y: c.y + off.y };
            }
            return det;
        });
    }

    // ------------------------------------------------------------ find marks

    function searchAround(centre) {
        var c = cam();
        var step = (0.55 * Math.min(c.width, c.height)) / c.pxPerUnit;
        var ring = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
        var i = 0;
        var next = function () {
            if (i >= ring.length) return Promise.resolve({ found: false });
            if (S.abort) return Promise.reject(new Error("Stopped"));
            var o = ring[i++];
            return moveCam({ x: centre.x + o[0] * step, y: centre.y + o[1] * step })
                .then(function () {
                    return locate();
                })
                .then(function (det) {
                    return det.found ? det : next();
                });
        };
        return next();
    }

    async function findAll() {
        if (!S.job || S.busy) return;
        if (S.set.source !== "sim" && S.activeCorrection) {
            return progress("Clear the active correction first — it would bend these moves.", true);
        }
        setBusy(true);
        S.found = [];
        S.fit = null;
        refresh();
        try {
            for (var n = 0; n < S.order.length; n++) {
                if (S.abort) throw new Error("Stopped");
                var idx = S.order[n];
                progress("Mark " + (idx + 1) + ": looking…");
                var det;
                if (n > 0) {
                    var pr = foundPairs();
                    var est = n === 1 ? core.fitTranslation(pr.src, pr.dst) : core.fitSimilarity(pr.src, pr.dst);
                    var guess = core.apply(est, marks()[idx]);
                    await moveCam(guess);
                    det = await locate();
                    if (!det.found) {
                        progress("Mark " + (idx + 1) + ": not where expected, searching around…");
                        det = await searchAround(guess);
                    }
                } else {
                    det = await locate();
                }
                if (!det.found) {
                    throw new Error(
                        n === 0
                            ? "Mark 1 is not in the camera view. Jog closer and try again."
                            : "Mark " + (idx + 1) + " was not found near its expected place."
                    );
                }
                // centre on it and measure again: at the image centre lens
                // distortion and scale error drop out
                await moveCam(det.pos);
                var again = await locate();
                if (again.found) det = again;
                S.found[idx] = det.pos;
                computeFit();
                refresh();
            }
            progress("All " + S.order.length + " marks found.");
        } catch (e) {
            progress(e.message, true);
        }
        setBusy(false);
        refresh();
    }

    function computeFit() {
        var pr = foundPairs();
        S.fit = pr.src.length ? core.fit(pr.src, pr.dst) : null;
        S.res = S.fit ? core.residuals(S.fit, pr.src, pr.dst) : null;
    }

    // -------------------------------------------------------------- manual

    function capture() {
        var idx = nextIndex();
        if (idx < 0 || !LIVE) return;
        S.found[idx] = { x: S.status.posx, y: S.status.posy };
        computeFit();
        progress("Mark " + (idx + 1) + " captured at " + fmt(S.status.posx) + ", " + fmt(S.status.posy) + ".");
        refresh();
    }

    function gotoEstimate() {
        var idx = nextIndex();
        if (idx < 0 || !S.fit || S.busy) return;
        if (S.activeCorrection) return progress("Clear the active correction first — it would bend this move.", true);
        var p = core.apply(S.fit, marks()[idx]);
        setBusy(true);
        progress("Moving near mark " + (idx + 1) + "…");
        moveTool(p.x, p.y)
            .then(function () {
                progress("Near mark " + (idx + 1) + ". Fine-tune with the keypad, then Capture.");
            })
            .catch(function (e) {
                progress(e.message, true);
            })
            .then(function () {
                setBusy(false);
                refresh();
            });
    }

    // --------------------------------------------------------- calibration

    async function calScale() {
        if (S.busy || !LIVE) return;
        if (S.activeCorrection) return progress("Clear the active correction first.", true);
        var d = S.status.unit === "mm" ? 6 : 0.25;
        var home = { x: S.status.posx, y: S.status.posy };
        setBusy(true);
        try {
            var p0 = await locate(false);
            if (!p0.found) throw new Error("No dot in view to calibrate on.");
            await moveTool(home.x + d, home.y);
            var p1 = await locate(false);
            await moveTool(home.x, home.y + d);
            var p2 = await locate(false);
            await moveTool(home.x, home.y);
            if (!p1.found || !p2.found) throw new Error("Lost the dot during the calibration moves. Start with it nearer the centre.");
            var du = p1.u - p0.u,
                dv = p1.v - p0.v;
            var s = Math.hypot(du, dv) / d;
            var rot = Math.atan2(-dv, -du);
            // a +Y move should shift the dot by d*s*(-sin, +cos)
            var ex = -d * s * Math.sin(rot),
                ey = d * s * Math.cos(rot);
            if (Math.hypot(p2.u - p0.u - ex, p2.v - p0.v - ey) > 0.25 * d * s) {
                throw new Error("X and Y moves disagree — the camera image looks mirrored, which is not supported.");
            }
            S.set.pxPerUnit = Math.round(s * 10) / 10;
            S.set.camRotDeg = Math.round(((rot * 180) / Math.PI) * 100) / 100;
            saveSettings();
            showSettings();
            progress("Camera: " + S.set.pxPerUnit + " px per " + S.status.unit + ", rotated " + S.set.camRotDeg + "°.");
        } catch (e) {
            progress(e.message, true);
        }
        setBusy(false);
        refresh();
    }

    function calHole() {
        S.calHole = { x: S.status.posx, y: S.status.posy };
        $("btn-cal-see").disabled = false;
        progress("Hole position saved. Now jog until the camera sees the hole.");
    }

    function calSee() {
        if (!S.calHole) return;
        var keep = { x: S.set.offX, y: S.set.offY };
        S.set.offX = 0;
        S.set.offY = 0;
        locate(false)
            .then(function (det) {
                if (!det.found) {
                    S.set.offX = keep.x;
                    S.set.offY = keep.y;
                    return progress("The camera does not see the hole.", true);
                }
                // with the offset zeroed, det.pos is tool + pixel offset
                S.set.offX = Math.round((S.calHole.x - det.pos.x) * 10000) / 10000;
                S.set.offY = Math.round((S.calHole.y - det.pos.y) * 10000) / 10000;
                saveSettings();
                showSettings();
                progress("Camera offset from the bit: X " + fmt(S.set.offX, 4) + ", Y " + fmt(S.set.offY, 4) + ".");
            })
            .catch(function (e) {
                S.set.offX = keep.x;
                S.set.offY = keep.y;
                progress(e.message, true);
            });
    }

    // ------------------------------------------------------------ rendering

    function bboxAdd(b, p) {
        if (p.x < b.x0) b.x0 = p.x;
        if (p.x > b.x1) b.x1 = p.x;
        if (p.y < b.y0) b.y0 = p.y;
        if (p.y > b.y1) b.y1 = p.y;
    }

    function drawTable() {
        var cv = $("table-view"),
            ctx = cv.getContext("2d");
        var W = cv.width,
            H = cv.height;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = "#cfc4b0";
        ctx.fillRect(0, 0, W, H);
        if (!S.job) {
            ctx.fillStyle = "#6b6252";
            ctx.font = "16px sans-serif";
            ctx.textAlign = "center";
            ctx.fillText("Load a job to begin", W / 2, H / 2);
            return;
        }
        var P = S.job.parsed;
        var sim = S.set.source === "sim" && S.sim.truth;
        var b = { x0: 0, y0: 0, x1: 0, y1: 0 };
        var each = function (fn) {
            P.marks.forEach(fn);
            P.paths.forEach(function (p) {
                p.forEach(fn);
            });
        };
        each(function (p) {
            bboxAdd(b, p);
        });
        if (S.fit) {
            each(function (p) {
                bboxAdd(b, core.apply(S.fit, p));
            });
        }
        if (sim) {
            var r = sheetRect();
            [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]].forEach(function (c) {
                bboxAdd(b, core.apply(S.sim.truth, { x: c[0], y: c[1] }));
            });
        }
        S.found.forEach(function (p) {
            if (p) bboxAdd(b, p);
        });
        if (S.set.source !== "manual" || LIVE) bboxAdd(b, S.set.source === "manual" ? toolPos() : camPos());
        var pad = 0.06 * Math.max(b.x1 - b.x0, b.y1 - b.y0) + 0.3;
        b.x0 -= pad;
        b.y0 -= pad;
        b.x1 += pad;
        b.y1 += pad;
        var k = Math.min(W / (b.x1 - b.x0), H / (b.y1 - b.y0));
        var ox = (W - k * (b.x1 - b.x0)) / 2 - k * b.x0,
            oy = H - (H - k * (b.y1 - b.y0)) / 2 + k * b.y0;
        var world = function () {
            ctx.setTransform(k, 0, 0, -k, ox, oy);
        };
        var px = 1 / k;

        // grid
        world();
        var span = Math.max(b.x1 - b.x0, b.y1 - b.y0);
        var step = [0.5, 1, 2, 5, 10, 25, 50, 100, 250].filter(function (s) {
            return span / s <= 30;
        })[0] || 500;
        ctx.strokeStyle = "rgba(0,0,0,0.10)";
        ctx.lineWidth = px;
        ctx.beginPath();
        for (var gx = Math.ceil(b.x0 / step) * step; gx <= b.x1; gx += step) {
            ctx.moveTo(gx, b.y0);
            ctx.lineTo(gx, b.y1);
        }
        for (var gy = Math.ceil(b.y0 / step) * step; gy <= b.y1; gy += step) {
            ctx.moveTo(b.x0, gy);
            ctx.lineTo(b.x1, gy);
        }
        ctx.stroke();
        ctx.strokeStyle = "rgba(0,0,0,0.45)";
        ctx.lineWidth = 1.5 * px;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(step, 0);
        ctx.moveTo(0, 0);
        ctx.lineTo(0, step);
        ctx.stroke();

        // the sheet as it really lies (simulation only — otherwise unknown)
        if (sim) {
            var T = S.sim.truth;
            ctx.transform(T.a, T.c, T.b, T.d, T.tx, T.ty);
            paintSheet(ctx);
        }

        var strokePaths = function (f) {
            ctx.beginPath();
            P.paths.forEach(function (p) {
                p.forEach(function (q, i) {
                    var t = f ? core.apply(f, q) : q;
                    if (i) ctx.lineTo(t.x, t.y);
                    else ctx.moveTo(t.x, t.y);
                });
            });
            ctx.stroke();
        };

        // as programmed
        world();
        ctx.strokeStyle = "#d23b3b";
        ctx.lineWidth = 1.6 * px;
        ctx.setLineDash([7 * px, 5 * px]);
        strokePaths(null);
        P.marks.forEach(function (m) {
            ctx.beginPath();
            ctx.arc(m.x, m.y, S.set.markDia / 2 + 2 * px, 0, 2 * Math.PI);
            ctx.stroke();
        });
        ctx.setLineDash([]);

        // registered
        if (S.fit) {
            ctx.strokeStyle = "#1d9a55";
            ctx.lineWidth = 2.4 * px;
            strokePaths(S.fit);
        }
        ctx.strokeStyle = "#0c7a3e";
        ctx.lineWidth = 2 * px;
        S.found.forEach(function (p) {
            if (!p) return;
            var a = Math.max(8 * px, S.set.markDia * 0.9);
            ctx.beginPath();
            ctx.moveTo(p.x - a, p.y);
            ctx.lineTo(p.x + a, p.y);
            ctx.moveTo(p.x, p.y - a);
            ctx.lineTo(p.x, p.y + a);
            ctx.stroke();
        });

        // camera field of view, or the bit
        ctx.strokeStyle = "#e2931c";
        ctx.lineWidth = 2 * px;
        if (S.set.source === "manual") {
            if (LIVE) {
                var t = toolPos();
                ctx.beginPath();
                ctx.arc(t.x, t.y, 6 * px, 0, 2 * Math.PI);
                ctx.moveTo(t.x - 12 * px, t.y);
                ctx.lineTo(t.x + 12 * px, t.y);
                ctx.moveTo(t.x, t.y - 12 * px);
                ctx.lineTo(t.x, t.y + 12 * px);
                ctx.stroke();
            }
        } else {
            var c = camPos(),
                cm = cam();
            var hw = cm.width / cm.pxPerUnit / 2,
                hh = cm.height / cm.pxPerUnit / 2;
            ctx.translate(c.x, c.y);
            ctx.rotate((cm.rotDeg * Math.PI) / 180);
            ctx.strokeRect(-hw, -hh, 2 * hw, 2 * hh);
        }

        // mark numbers
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.font = "bold 12px sans-serif";
        ctx.textAlign = "center";
        P.marks.forEach(function (m, i) {
            var q = S.found[i] || m;
            ctx.fillStyle = S.found[i] ? "#0c7a3e" : "#a12c2c";
            ctx.fillText(String(i + 1), ox + k * q.x, oy - k * q.y - (k * S.set.markDia) / 2 - 7);
        });
    }

    function drawMarkTable() {
        var tb = $("mark-table").querySelector("tbody");
        var nx = S.set.source === "manual" ? nextIndex() : -1;
        var k = 0;
        tb.innerHTML = marks()
            .map(function (m, i) {
                var f = S.found[i];
                var miss = f && S.res ? S.res.each[k++] : null;
                var bad = miss !== null && miss > S.set.maxResidual;
                return (
                    '<tr class="' + (i === nx ? "next" : "") + '"><td>' + (i + 1) + "</td><td>" + fmt(m.x) + ", " + fmt(m.y) + "</td><td>" +
                    (f ? fmt(f.x) + ", " + fmt(f.y) : "—") + '</td><td class="' + (bad ? "bad" : "") + '">' +
                    (miss === null ? "—" : fmt(miss, 4)) + "</td></tr>"
                );
            })
            .join("");
    }

    function drawReport() {
        var el = $("report");
        var u = S.status.unit;
        if (!S.fit) {
            S.fitOk = false;
            el.innerHTML = '<div class="rg-note">Find the marks to see how the sheet really lies.</div>';
            return;
        }
        var d = core.decompose(S.fit);
        var n = foundPairs().src.length,
            total = marks().length;
        var pct = function (s) {
            var p = (s - 1) * 100;
            return (p >= 0 ? "+" : "") + p.toFixed(3) + "%";
        };
        var rows = [
            ["Marks found", n + " of " + total],
            ["Sheet origin at", fmt(d.moveX) + ", " + fmt(d.moveY) + " " + u],
            ["Rotation", (n > 1 ? fmt(d.rotation, 3) : "—") + "°"],
        ];
        if (S.fit.kind === "affine") {
            rows.push(["Print size in X", pct(d.scaleX)], ["Print size in Y", pct(d.scaleY)], ["Skew", fmt(d.skew, 3) + "°"]);
        } else if (S.fit.kind === "similarity") {
            rows.push(["Print size", pct(d.scaleX)]);
        }
        rows.push(["Worst mark miss after fit", fmt(S.res.max, 4) + " " + u]);

        // what the correction is worth: compare with lining up mark 1 only
        var pr = foundPairs();
        var naive = core.fitTranslation(pr.src.slice(0, 1), pr.dst.slice(0, 1));
        var saved = 0,
            truthErr = 0;
        S.job.parsed.paths.forEach(function (p) {
            p.forEach(function (q) {
                var a = core.apply(S.fit, q),
                    c = core.apply(naive, q);
                saved = Math.max(saved, Math.hypot(a.x - c.x, a.y - c.y));
                if (S.set.source === "sim") {
                    var t = core.apply(S.sim.truth, q);
                    truthErr = Math.max(truthErr, Math.hypot(a.x - t.x, a.y - t.y));
                }
            });
        });

        var says = [];
        if (n > 1 && Math.abs(d.rotation) > 0.005) {
            says.push("Sheet is turned " + fmt(Math.abs(d.rotation), 2) + "° " + (d.rotation > 0 ? "counter-clockwise" : "clockwise") + ".");
        }
        if (S.fit.kind === "affine") {
            var r = sheetRect();
            [["X", d.scaleX, r.x1 - r.x0], ["Y", d.scaleY, r.y1 - r.y0]].forEach(function (a) {
                if (Math.abs(a[1] - 1) > 0.0002) {
                    says.push(
                        "Print is " + Math.abs((a[1] - 1) * 100).toFixed(2) + "% " + (a[1] > 1 ? "long" : "short") + " in " + a[0] +
                            " (" + fmt(Math.abs(a[1] - 1) * a[2], 3) + " " + u + " across the sheet)."
                    );
                }
            });
        }
        if (n > 1) says.push("Lining up on mark 1 alone would miss the print by up to " + fmt(saved, 3) + " " + u + ".");
        if (S.set.source === "sim" && n === total) {
            says.push("Simulation check: registered cut is within " + fmt(truthErr, 4) + " " + u + " of the true print edge.");
        }
        if (n >= 3 && n < 4 && S.fit.kind === "affine") says.push("With 3 marks there is no spare mark to cross-check the fit.");

        var done = n === total;
        var ok = done && !d.mirrored && S.res.max <= S.set.maxResidual;
        var verdict = !done
            ? '<div class="rg-verdict">' + (total - n) + " mark(s) still to find.</div>"
            : ok
              ? '<div class="rg-verdict ok">Fit is good — ready to cut to the print.</div>'
              : '<div class="rg-verdict bad">' +
                (d.mirrored
                    ? "The marks look mirrored — check the mark order."
                    : "A mark is off by more than " + S.set.maxResidual + " " + u + ". Re-check the marks before cutting.") +
                "</div>";
        el.innerHTML =
            "<table>" +
            rows
                .map(function (r) {
                    return "<tr><td>" + r[0] + "</td><td>" + r[1] + "</td></tr>";
                })
                .join("") +
            "</table>" + verdict + (says.length ? '<ul class="rg-says"><li>' + says.join("</li><li>") + "</li></ul>" : "");
        S.fitOk = ok;
    }

    function refresh() {
        var src = S.set.source;
        var has = !!S.job;
        document.querySelectorAll("[data-for]").forEach(function (el) {
            el.hidden = el.getAttribute("data-for") !== src;
        });
        document.querySelectorAll("#source-seg button").forEach(function (bt) {
            bt.className = bt.dataset.source === src ? "on" : "";
            bt.disabled = S.busy;
        });
        document.querySelectorAll(".unit").forEach(function (el) {
            el.textContent = S.status.unit;
        });
        var idle = S.status.state === "idle";
        $("btn-find-sim").disabled = !has || S.busy;
        $("btn-shuffle").disabled = !has || S.busy;
        $("btn-find-cam").disabled = !has || S.busy || !LIVE || !idle;
        $("btn-snap").disabled = S.busy;
        $("btn-cal-scale").disabled = S.busy || !LIVE || !idle;
        $("btn-cal-hole").disabled = S.busy || !LIVE;
        var nx = nextIndex();
        $("btn-capture").disabled = !has || S.busy || !LIVE || nx < 0;
        $("btn-goto-est").disabled = !has || S.busy || !LIVE || !idle || nx < 0 || !S.fit;
        $("btn-reset").disabled = !has || S.busy || !S.found.some(Boolean);
        $("btn-abort").hidden = !S.busy;
        if (src === "manual") {
            $("manual-prompt").innerHTML = !has
                ? "Load a job first."
                : !LIVE
                  ? "Not connected to a machine. Open this app from the FabMo dashboard."
                  : nx < 0
                    ? "All marks captured."
                    : "Jog the tip of the bit over <b>mark " + (nx + 1) + "</b> (" + fmt(marks()[nx].x, 2) + ", " + fmt(marks()[nx].y, 2) +
                      " in the file), then press Capture. A V-bit or a pointed pin works best.";
        }
        drawMarkTable();
        drawReport();
        drawTable();
        var canApply = has && !S.busy && S.fit && S.fitOk;
        $("btn-apply").disabled = !canApply || (src !== "sim" && (!LIVE || !idle));
        $("btn-apply").textContent = src === "sim" ? "Show the correction" : "Queue registered job";
        $("state-badge").textContent = S.status.state || "—";
        $("state-badge").className = "rg-badge rg-state " + (S.status.state || "");
        $("pos-badge").textContent = LIVE ? "X " + fmt(S.status.posx) + "  Y " + fmt(S.status.posy) + "  " + S.status.unit : "not connected";
        $("active-banner").hidden = !S.activeCorrection;
    }

    function setBusy(b) {
        S.busy = b;
        S.abort = false;
    }

    // --------------------------------------------------------------- job

    function loadJob(name, text) {
        var parsed = core.parseJob(text);
        S.found = [];
        S.fit = null;
        S.res = null;
        S.fitOk = false;
        $("apply-note").textContent = "";
        if (!parsed.marks.length) {
            S.job = null;
            $("job-info").innerHTML =
                "<b>" + esc(name) + "</b>: no registration marks found. Name the marks' drill toolpath <b>Regmarks</b>, " +
                "or add <code>' REGMARK n, x, y</code> comment lines.";
            return refresh();
        }
        S.job = { name: name, parsed: parsed };
        S.order = core.visitOrder(parsed.marks, 0);
        var notes = [parsed.marks.length + " marks (" + (parsed.source === "toolpath" ? "Regmarks toolpath" : "REGMARK comments") + ")",
            parsed.paths.length + " cut path" + (parsed.paths.length === 1 ? "" : "s")];
        if (parsed.marks.length < 3) notes.push("fewer than 3 marks: stretch and skew cannot be corrected");
        if (parsed.unsupported) notes.push("file uses jumps or macros: preview may be incomplete");
        $("job-info").innerHTML = "<b>" + esc(name) + "</b> — " + notes.join(" · ");
        if (S.set.source === "sim") shuffle();
        progress("");
        refresh();
    }

    function esc(s) {
        return String(s).replace(/[&<>"]/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
        });
    }

    // Lay the virtual sheet down: crooked, shifted, slightly stretched
    function shuffle() {
        if (!S.job) return;
        var rnd = function (lo, hi) {
            return lo + Math.random() * (hi - lo);
        };
        var sign = Math.random() < 0.5 ? -1 : 1;
        var rot = (sign * rnd(1.2, 4) * Math.PI) / 180;
        var sx = 1 + rnd(-0.004, 0.004),
            sy = 1 + rnd(-0.004, 0.004),
            k = rnd(-0.002, 0.002);
        var cos = Math.cos(rot),
            sin = Math.sin(rot);
        S.sim.truth = {
            a: sx * (cos + k * sin),
            b: sx * (-sin + k * cos),
            c: sy * sin,
            d: sy * cos,
            tx: rnd(2, 5),
            ty: rnd(1.5, 3.5),
        };
        var m1 = core.apply(S.sim.truth, marks()[0]);
        var j = 0.9 * S.set.markDia; // the operator's rough aim
        S.sim.tool = { x: m1.x + rnd(-j, j) - S.set.offX, y: m1.y + rnd(-j, j) - S.set.offY };
        S.found = [];
        S.fit = null;
        S.res = null;
        S.fitOk = false;
        $("apply-note").textContent = "";
        simFrame();
        overlay(null);
        progress("Sheet is down. The camera has been jogged roughly over mark 1.");
        refresh();
    }

    // ------------------------------------------------------------- apply

    function describe(d) {
        return "rot " + d.rotation.toFixed(3) + "deg, scale " + d.scaleX.toFixed(5) + "/" + d.scaleY.toFixed(5) +
            ", move " + d.moveX.toFixed(3) + "," + d.moveY.toFixed(3);
    }

    function applyFit() {
        if (!S.fit || !S.fitOk) return;
        var tr = core.toEngineTransforms(S.fit);
        var note = $("apply-note");
        if (S.set.source === "sim") {
            note.innerHTML =
                "Simulated sheet — nothing is sent to the machine. On a real sheet these values go into the OpenSBP transforms " +
                "and the job is queued without its Regmarks toolpath:<br><code>rotate " + tr.rotate.angle + "° · shear " + tr.shearx.angle +
                " · scale " + tr.scale.scalex + " / " + tr.scale.scaley + " · move " + tr.move.x + ", " + tr.move.y + "</code>";
            return;
        }
        var base = S.job.name.replace(/\.sbp$/i, "");
        var jobName = base + " (registered)";
        setBusy(true);
        fabmo.setConfig({ opensbp: { transforms: tr } }, function (err) {
            if (err) {
                setBusy(false);
                refresh();
                return progress("Could not set the correction: " + (err.message || err), true);
            }
            S.activeCorrection = true;
            fabmo.submitJob(
                {
                    file: S.job.parsed.text,
                    filename: base + "_registered.sbp",
                    name: jobName,
                    description: "Registered to print: " + describe(core.decompose(S.fit)),
                },
                { stayHere: true },
                function (err2) {
                    setBusy(false);
                    if (err2) {
                        progress("Correction set, but the job could not be queued: " + (err2.message || err2), true);
                    } else {
                        S.pendingJob = { name: jobName, started: false };
                        note.textContent =
                            "Job queued as “" + jobName + "”. The correction stays active until that job finishes, then clears itself.";
                        progress("");
                    }
                    refresh();
                }
            );
        });
    }

    function clearCorrection(why) {
        if (!LIVE) return;
        fabmo.setConfig({ opensbp: { transforms: core.clearedTransforms() } }, function (err) {
            if (err) return progress("Could not clear the correction: " + (err.message || err), true);
            S.activeCorrection = false;
            S.pendingJob = null;
            if (why) $("apply-note").textContent = why;
            refresh();
        });
    }

    function checkActive() {
        if (!LIVE) return;
        fabmo.getConfig(function (err, cfg) {
            if (err || !cfg || !cfg.opensbp || !cfg.opensbp.transforms) return;
            var t = cfg.opensbp.transforms;
            S.activeCorrection = ["rotate", "shearx", "sheary", "scale", "move"].some(function (k) {
                return t[k] && t[k].apply;
            });
            refresh();
        });
    }

    // ----------------------------------------------------------- settings

    function showSettings() {
        ["markDia", "pxPerUnit", "camRotDeg", "maxResidual", "offX", "offY"].forEach(function (k) {
            $("set-" + k).value = S.set[k];
        });
        $("cal-step").textContent = S.status.unit === "mm" ? "6" : "0.25";
    }

    function saveSettings() {
        if (LIVE) fabmo.setAppConfig({ settings: S.set }, function () {});
    }

    function wire() {
        $("btn-demo").onclick = function () {
            loadJob("regdemo.sbp", core.demoSBP());
        };
        $("btn-file").onclick = function () {
            $("file-input").click();
        };
        $("file-input").onchange = function (e) {
            var f = e.target.files[0];
            if (!f) return;
            var rd = new FileReader();
            rd.onload = function () {
                loadJob(f.name, rd.result);
            };
            rd.readAsText(f);
            e.target.value = "";
        };
        document.querySelectorAll("#source-seg button").forEach(function (bt) {
            bt.onclick = function () {
                if (S.busy) return;
                S.set.source = bt.dataset.source;
                S.found = [];
                S.fit = null;
                S.res = null;
                S.fitOk = false;
                $("apply-note").textContent = "";
                progress("");
                saveSettings();
                if (S.set.source === "sim" && S.job) shuffle();
                refresh();
            };
        });
        $("btn-shuffle").onclick = shuffle;
        $("btn-find-sim").onclick = findAll;
        $("btn-find-cam").onclick = findAll;
        $("btn-snap").onclick = function () {
            locate().catch(function (e) {
                progress(e.message, true);
            });
        };
        $("btn-capture").onclick = capture;
        $("btn-goto-est").onclick = gotoEstimate;
        $("btn-reset").onclick = function () {
            S.found = [];
            S.fit = null;
            S.res = null;
            S.fitOk = false;
            $("apply-note").textContent = "";
            progress("");
            refresh();
        };
        $("btn-abort").onclick = function () {
            S.abort = true;
            if (LIVE && S.set.source !== "sim") fabmo.stop(function () {});
        };
        $("btn-apply").onclick = applyFit;
        $("btn-clear-active").onclick = function () {
            clearCorrection("Correction cleared.");
        };
        $("btn-cal-scale").onclick = calScale;
        $("btn-cal-hole").onclick = calHole;
        $("btn-cal-see").onclick = calSee;
        ["markDia", "pxPerUnit", "camRotDeg", "maxResidual", "offX", "offY"].forEach(function (k) {
            $("set-" + k).onchange = function (e) {
                var v = parseFloat(e.target.value);
                if (isNaN(v) || ((k === "markDia" || k === "pxPerUnit" || k === "maxResidual") && v <= 0)) return showSettings();
                S.set[k] = v;
                saveSettings();
                computeFit();
                if (S.set.source === "sim" && S.job && !S.busy) {
                    simFrame();
                    overlay(null);
                }
                refresh();
            };
        });
    }

    function onStatus(st) {
        if (!st) return;
        S.status = {
            state: st.state,
            posx: Number(st.posx) || 0,
            posy: Number(st.posy) || 0,
            unit: st.unit || S.status.unit,
        };
        // the correction belongs to one job: drop it when that job is done
        if (S.pendingJob) {
            var running = st.job && st.job.name === S.pendingJob.name;
            if (running) S.pendingJob.started = true;
            else if (S.pendingJob.started && !st.job && st.state === "idle") {
                clearCorrection("Job finished — correction cleared.");
            }
        }
        if (!S.busy) refresh();
        else drawTable();
    }

    function init() {
        wire();
        showSettings();
        refresh();
        if (!LIVE) return;
        fabmo.getAppConfig(function (err, cfg) {
            if (!err && cfg && cfg.settings) {
                Object.keys(DEFAULTS).forEach(function (k) {
                    if (cfg.settings[k] !== undefined) S.set[k] = cfg.settings[k];
                });
            }
            showSettings();
            refresh();
        });
        fabmo.on("status", onStatus);
        fabmo.requestStatus(function (err, st) {
            if (!err) onStatus(st);
            showSettings();
        });
        checkActive();
    }

    // test hook (headless checks drive the app through this)
    window.RegApp = { state: S, loadJob: loadJob, findAll: findAll, shuffle: shuffle };

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
})();
