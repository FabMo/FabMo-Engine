/*
 * Pecan — a tongue-in-cheek industrial CNC console for FabMo.
 *
 * Everything here goes through the normal app API (fabmo.js): status events
 * for the readout, runSBP / runGCode for MDI and steps, runNext / pause /
 * resume / stop for the cycle keys. Nothing polls.
 *
 * Jogging, stepping and ZERO use the manual runtime, the same one behind
 * the FabMo keypad: no file is created and nothing is queued. The page takes
 * manual control (keypad hidden) on the first press and gives it back after
 * a few idle seconds, when it loses focus, or when another key needs READY.
 *
 * Hold-to-move re-sends manualStart every TICK_MS for as long as the pointer
 * is down. That stream is the deadman: the engine's lease stops the motion
 * if the stream stops for any reason (page closed, hung, throttled).
 */
(function () {
    "use strict";

    var fabmo = new FabMoDashboard();
    var LIVE = fabmo.isPresent();
    var $ = function (id) {
        return document.getElementById(id);
    };

    var INCREMENTS = { in: [0.001, 0.01, 0.1, 1], mm: [0.01, 0.1, 1, 10] };
    var DECIMALS = { in: 3, mm: 2 };
    var TICK_MS = 50; // hold-to-move keep-alive, same cadence as the keypad
    var LINGER_MS = 5000; // give manual control back after this long without a jog

    var S = {
        status: { state: LIVE ? "" : "idle", posx: 0, posy: 0, posz: 0, unit: "in", feed: 0, fro: 1, out1: 0 },
        pending: [], // queued jobs, next first
        inc: 1, // index into INCREMENTS, or "cont" for hold-to-move
        manual: null, // machine.manual settings (speeds), same ones the keypad uses
        ours: false, // this page asked for the current manual session
        entering: false,
        enterTimer: null,
        lingerTimer: null,
        onManual: [], // waiting for manual control
        onIdle: [], // waiting for READY
        idleTimer: null,
        hold: null, // live hold-to-move gesture
        lastLimit: "",
        // Work offsets. FabMo keeps one work zero (stored in the controller as
        // G55); the six slots here are saved copies of it, in machine
        // coordinates. The active slot always mirrors the live zero.
        wcs: { loaded: false, active: "G54", slots: {}, live: null, pending: null },
        history: [],
        histPos: 0,
        lastState: null,
    };

    // ------------------------------------------------------------- softkeys
    // Original line-art glyphs, 24x24, drawn with currentColor.
    var G = {
        home: '<path d="M3 12 L12 4 L21 12 M6 10 V20 H18 V10 M10 20 V14 H14 V20"/>',
        plate: '<path d="M12 3 V13 M9 10 L12 13 L15 10 M4 17 H20 V20 H4 Z"/>',
        jobs: '<path d="M5 4 H15 L19 8 V20 H5 Z M15 4 V8 H19 M8 12 H16 M8 16 H16"/>',
        mdi: '<path d="M3 6 H21 V18 H3 Z M6 10 H8 M11 10 H13 M16 10 H18 M7 14 H17"/>',
        park: '<path d="M12 3 A9 9 0 1 0 12 21 A9 9 0 1 0 12 3 M9 17 V7 H13 A3 3 0 0 1 13 13 H9"/>',
        tools: '<path d="M9 3 H15 V9 L13 12 V17 L12 21 L11 17 V12 L9 9 Z"/>',
        keypad: '<path d="M12 3 L15 7 H9 Z M12 21 L9 17 H15 Z M3 12 L7 9 V15 Z M21 12 L17 15 V9 Z M10 10 H14 V14 H10 Z"/>',
        preview: '<path d="M2 12 C6 5 18 5 22 12 C18 19 6 19 2 12 Z M12 9 A3 3 0 1 0 12 15 A3 3 0 1 0 12 9"/>',
        setup: '<path d="M4 7 H20 M4 12 H20 M4 17 H20 M8 5 V9 M15 10 V14 M10 15 V19"/>',
        nut: '<path d="M12 2 C7 6 7 18 12 22 C17 18 17 6 12 2 M12 2 C10.500 9 13.500 15 12 22"/>',
    };

    var FKEYS = [
        { label: "Home", glyph: "home", needIdle: true, run: function () { macro(3, "Home", "Run the homing routine (macro 3)? The machine will move to find its switches."); } },
        { label: "Z Plate", glyph: "plate", needIdle: true, run: function () { macro(2, "Z Plate", "Run Z zeroing with the plate (macro 2)? Put the plate under the bit and attach the clip first."); } },
        { label: "Jobs", glyph: "jobs", run: function () { fabmo.launchApp("job-manager"); } },
        { label: "MDI", glyph: "mdi", run: function () { $("mdi").focus(); } },
        { label: "Park", glyph: "park", needIdle: true, run: function () { macro(79, "Park", "Move the tool to its parking location (macro 79)?"); } },
        { label: "Tools", glyph: "tools", run: function () { fabmo.launchApp("tool_status"); } },
        { label: "Keypad", glyph: "keypad", needIdle: true, run: function () { whenIdle(function () { fabmo.manualEnter({ mode: "normal" }, function () {}); }); } },
        { label: "Preview", glyph: "preview", run: preview },
        { label: "Setup", glyph: "setup", run: function () { fabmo.launchApp("config"); } },
        { label: "Servos", glyph: "nut", nutty: true, run: servoUpgrade },
    ];

    function buildFkeys() {
        $("fkeys").innerHTML = FKEYS.map(function (k, i) {
            return (
                '<button class="pc-key pc-fkey' + (k.nutty ? " nutty" : "") + '" data-f="' + i + '">' +
                '<span class="fn">F' + (i + 1) + "</span>" +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" ' +
                'stroke-linecap="round" aria-hidden="true">' + G[k.glyph] + "</svg>" +
                '<span class="lb">' + k.label + "</span></button>"
            );
        }).join("");
        $("fkeys").addEventListener("click", function (e) {
            var b = e.target.closest("[data-f]");
            if (b && !b.disabled) FKEYS[Number(b.dataset.f)].run();
        });
    }

    // ------------------------------------------------------------------ log

    function log(msg, cls) {
        var el = $("log");
        var line = document.createElement("div");
        if (cls) line.className = cls;
        var t = document.createElement("span");
        t.className = "t";
        t.textContent = new Date().toTimeString().slice(0, 8);
        line.appendChild(t);
        line.appendChild(document.createTextNode(msg));
        el.appendChild(line);
        while (el.childNodes.length > 200) el.removeChild(el.firstChild);
        el.scrollTop = el.scrollHeight;
    }

    function errText(err) {
        return (err && (err.message || err)) || "unknown error";
    }

    // Callback for anything sent to the machine
    function sent(what) {
        return function (err) {
            if (err) log(what + ": " + errText(err), "err");
        };
    }

    // --------------------------------------------------------------- dialog

    var dialogOk = null;

    function dialog(title, body, onOk, okLabel) {
        $("dialog-title").textContent = title;
        $("dialog-body").textContent = body;
        $("dialog-ok").textContent = okLabel || "OK";
        $("dialog-cancel").hidden = !onOk;
        dialogOk = onOk || null;
        $("dialog").hidden = false;
        $("dialog-ok").focus();
    }

    function closeDialog(ok) {
        $("dialog").hidden = true;
        var f = dialogOk;
        dialogOk = null;
        if (ok && f) f();
    }

    // --------------------------------------------------------------- status

    var STATES = {
        idle: ["READY", "ready"],
        running: ["RUNNING", "run"],
        probing: ["PROBING", "run"],
        homing: ["HOMING", "run"],
        manual: ["JOG", "run"],
        paused: ["FEED HOLD", "hold"],
        passthrough: ["PASSTHRU", "hold"],
        armed: ["ARMED", "hold"],
        stopped: ["STOPPED", "hold"],
        interlock: ["INTERLOCK", "fault"],
        limit: ["LIMIT", "fault"],
        dead: ["FAULT", "fault"],
        not_ready: ["NOT READY", "fault"],
        disconnected: ["NO LINK", "fault"],
    };

    function idle() {
        return S.status.state === "idle";
    }

    // In manual mode because this page asked for it (keypad hidden)
    function inManual() {
        return S.status.state === "manual" && S.ours && !!S.status.hideKeypad;
    }

    function canJog() {
        return LIVE && (idle() || inManual());
    }

    function unit() {
        return S.status.unit === "mm" ? "mm" : "in";
    }

    function fmt(v) {
        var n = typeof v === "number" && isFinite(v) ? v : 0;
        var s = n.toFixed(DECIMALS[unit()]);
        if (/^-0\.0*$/.test(s)) s = s.slice(1);
        return (s.charAt(0) === "-" ? "" : " ") + s; // keep the digits from shifting on sign change
    }

    function render() {
        var st = S.status;
        var info = STATES[st.state] || [(st.state || "—").toUpperCase(), ""];
        if (inManual()) info = ["JOG", "run"];
        $("state").textContent = LIVE ? info[0] : "DEMO";
        $("lamp").className = "pc-lamp " + info[1];

        $("pos-x").textContent = fmt(st.posx);
        $("pos-y").textContent = fmt(st.posy);
        $("pos-z").textContent = fmt(st.posz);
        $("unit").textContent = unit() === "mm" ? "millimeters" : "inches";
        renderWcs();

        var running = st.job && st.state !== "idle";
        var next = S.pending[0];
        $("job-name").textContent = running ? st.job.name || "job" : next ? next.name + "  (ready)" : "none loaded — F3 Jobs";
        if (running && st.nb_lines) {
            $("job-line").textContent = (st.line || 0) + " / " + st.nb_lines;
            $("job-bar").style.width = Math.min(100, (100 * (st.line || 0)) / st.nb_lines) + "%";
        } else {
            $("job-line").textContent = "—";
            $("job-bar").style.width = "0";
        }
        $("feed").textContent = (st.feed || 0).toFixed(unit() === "mm" ? 0 : 1) + " " + unit() + "/min";
        $("fro").textContent = Math.round((typeof st.fro === "number" ? st.fro : 1) * 100) + "%";
        $("spindle").textContent = st.out1 ? "ON" : "OFF";
        $("spindle").className = "pc-data" + (st.out1 ? " on" : "");

        var isIdle = idle();
        var paused = st.state === "paused";
        var busy = !isIdle && !paused;
        var ready = isIdle || inManual(); // keys that need READY hand manual control back first
        $("btn-start").disabled = !LIVE || !(paused || (ready && next));
        $("btn-hold").disabled = !LIVE || !busy || st.state === "manual";
        $("btn-cancel").disabled = !LIVE || isIdle;
        document.querySelectorAll("[data-jog], [data-zero]").forEach(function (b) {
            b.disabled = !canJog();
        });
        document.querySelectorAll("[data-f]").forEach(function (b) {
            var k = FKEYS[Number(b.dataset.f)];
            b.disabled = (!LIVE && !k.nutty && k.glyph !== "mdi") || (k.needIdle && !ready);
        });
    }

    function onStatus(status) {
        if (!status) return;
        var incsStale = status.unit && status.unit !== S.status.unit;
        var wasBusy = S.status.state !== "idle";
        S.status = status;
        if (incsStale) {
            buildIncs();
            loadManualSettings(); // speeds are stored in the current units
            readOffsets(); // so are the offsets
        }
        if (status.state !== S.lastState) {
            if (S.lastState !== null) {
                var info = STATES[status.state];
                log(info ? info[0] : String(status.state), info && info[1] === "fault" ? "err" : info && info[1] === "hold" ? "warn" : "");
            }
            S.lastState = status.state;
        }
        sessionStatus();
        if (status.state === "idle" && wasBusy) readOffsets(); // a job, macro or the keypad may have moved the zero
        var lim = status.softLimit ? status.softLimit.axis + status.softLimit.dir : "";
        if (lim && lim !== S.lastLimit) log("Soft limit reached: " + lim + ". To go past it use F7 Keypad.", "warn");
        S.lastLimit = lim;
        render();
    }

    function refreshJobs() {
        if (!LIVE) return;
        fabmo.getJobsInQueue(function (err, jobs) {
            if (err || !jobs) return;
            S.pending = (jobs.pending || []).slice().sort(function (a, b) {
                return (a.order || 0) - (b.order || 0);
            });
            render();
        });
    }

    // -------------------------------------------------------------- actions

    function macro(n, title, question) {
        dialog(title, question, function () {
            whenIdle(function () {
                log("Macro " + n + " (" + title + ")");
                fabmo.runMacro(n, sent("Macro " + n));
            });
        });
    }

    function preview() {
        if (!S.pending[0]) return log("Nothing to preview. Load a job with F3.", "warn");
        fabmo.launchApp("previewer", { job: S.pending[0]._id });
    }

    function servoUpgrade() {
        dialog(
            "Servo upgrade",
            "Checked the drive train: closed-loop AlphaStep motors already installed, and they are not losing steps. " +
                "Upgrade status: not required. Suggested use of the budget: plywood.",
            null,
            "CRACKING"
        );
        log("Servo upgrade evaluated: not required.");
    }

    // ------------------------------------------------- manual-mode session

    function loadManualSettings() {
        if (!LIVE) return;
        fabmo.getConfig(function (err, cfg) {
            if (!err && cfg && cfg.machine && cfg.machine.manual) S.manual = cfg.machine.manual;
        });
    }

    // Units per second, from the same settings the keypad uses
    function speedFor(axis, continuous) {
        var m = S.manual || {};
        var v = axis === "Z" ? (continuous ? m.z_fast_speed : m.z_slow_speed) : m.xy_speed;
        return Number(v) > 0 ? Number(v) : 0;
    }

    function touchSession() {
        clearTimeout(S.lingerTimer);
        S.lingerTimer = setTimeout(function () {
            if (S.hold) return touchSession();
            endSession();
        }, LINGER_MS);
    }

    // Run fn once this page has manual control (taking it if the machine is READY)
    function ensureManual(fn) {
        if (inManual()) {
            touchSession();
            return fn();
        }
        if (!LIVE || !idle()) return;
        S.onManual.push(fn);
        if (S.entering) return;
        S.entering = true;
        S.ours = true;
        fabmo.manualEnter({ hideKeypad: true, mode: "normal" }, function () {});
        S.enterTimer = setTimeout(function () {
            if (!S.entering) return;
            S.entering = false;
            S.onManual = [];
            stopHold();
            log("Could not take manual control (machine is " + (S.status.state || "not responding") + ").", "err");
            if (S.status.state === "manual") fabmo.manualExit();
        }, 3000);
    }

    function endSession() {
        stopHold();
        clearTimeout(S.lingerTimer);
        S.onManual = [];
        if (LIVE && (inManual() || S.entering)) fabmo.manualExit();
    }

    // Run fn at READY, handing manual control back first if this page holds it
    function whenIdle(fn) {
        if (idle()) return fn();
        if (!inManual()) return log("That needs the machine at READY.", "warn");
        S.onIdle.push(fn);
        endSession();
        clearTimeout(S.idleTimer);
        S.idleTimer = setTimeout(function () {
            if (!S.onIdle.length) return;
            S.onIdle = [];
            log("The machine did not return to READY.", "err");
        }, 5000);
    }

    // Called on every status report
    function sessionStatus() {
        var list;
        if (S.status.state === "manual") {
            if (S.entering) {
                S.entering = false;
                clearTimeout(S.enterTimer);
                list = S.onManual;
                S.onManual = [];
                if (inManual()) {
                    touchSession();
                    list.forEach(function (f) { f(); });
                } else {
                    S.ours = false; // someone else opened the keypad first
                    stopHold();
                }
            }
            return;
        }
        if (!S.entering) {
            S.ours = false;
            stopHold();
        }
        if (idle() && S.onIdle.length) {
            clearTimeout(S.idleTimer);
            list = S.onIdle;
            S.onIdle = [];
            list.forEach(function (f) { f(); });
        }
    }

    // ------------------------------------------------------ jog, step, zero

    function zeroAxis(axis) {
        dialog("Zero " + axis, "Set the current " + axis + " position as " + axis + " zero?", function () {
            if (!canJog()) return log("Zero needs the machine at READY.", "warn");
            ensureManual(function () {
                var move = {};
                move[axis] = 0;
                log("Zero " + axis + " (" + S.wcs.active + ")");
                fabmo.manualSet(move, sent("Zero " + axis));
                setTimeout(readOffsets, 700); // the active slot follows the new zero
            });
        });
    }

    function step(axis, dir) {
        if (S.inc === "cont" || !canJog()) return;
        var speed = speedFor(axis, false);
        if (!speed) return log("Jog speeds have not loaded yet.", "warn");
        var inc = INCREMENTS[unit()][S.inc];
        ensureManual(function () {
            log("Step " + axis + (dir > 0 ? " +" : " −") + inc);
            fabmo.manualMoveFixed(axis, 60 * speed, dir * inc, sent("Step " + axis));
        });
    }

    function holdStart(btn, e) {
        if (S.inc !== "cont" || e.button || btn.disabled || !canJog()) return;
        e.preventDefault();
        stopHold();
        var axis = btn.dataset.jog;
        var speed = speedFor(axis, true);
        if (!speed) return log("Jog speeds have not loaded yet.", "warn");
        var h = { btn: btn, moving: false, timer: null };
        S.hold = h;
        btn.classList.add("down");
        try {
            btn.setPointerCapture(e.pointerId);
        } catch (err) { /* capture is a nicety; the window listeners below still end the hold */ }
        var send = function () {
            if (S.hold !== h) return;
            if (!inManual() || document.hidden) return stopHold();
            h.moving = true;
            fabmo.manualStart(axis, Number(btn.dataset.dir) * 60 * speed);
        };
        ensureManual(function () {
            if (S.hold !== h) return; // released before manual control arrived
            send();
            h.timer = setInterval(send, TICK_MS);
        });
    }

    function stopHold() {
        var h = S.hold;
        if (!h) return;
        S.hold = null;
        clearInterval(h.timer);
        h.btn.classList.remove("down");
        if (h.moving && LIVE) fabmo.manualStop();
        touchSession();
    }

    // --------------------------------------------------------- work offsets

    var WCS = ["G54", "G55", "G56", "G57", "G58", "G59"];
    var AXES = ["x", "y", "z"];

    function toUnit(slot) {
        var k = slot.unit === unit() ? 1 : unit() === "mm" ? 25.4 : 1 / 25.4;
        return { x: slot.x * k, y: slot.y * k, z: slot.z * k };
    }

    function sameOffset(a, b) {
        var tol = unit() === "mm" ? 0.002 : 0.0001;
        return AXES.every(function (ax) {
            return Math.abs(a[ax] - b[ax]) <= tol;
        });
    }

    function offsetText(o) {
        var d = DECIMALS[unit()];
        return "X " + o.x.toFixed(d) + "  Y " + o.y.toFixed(d) + "  Z " + o.z.toFixed(d);
    }

    function saveWcs() {
        fabmo.setAppConfig({ wcs: { active: S.wcs.active, slots: S.wcs.slots } }, sent("Saving work offsets"));
    }

    function buildWcs() {
        $("wcs").innerHTML = WCS.map(function (name) {
            return '<button class="pc-key pc-small" data-wcs="' + name + '">' + name + "</button>";
        }).join("");
    }

    function renderWcs() {
        var w = S.wcs;
        var ok = LIVE && w.loaded && !!w.live && !w.pending && (idle() || inManual());
        document.querySelectorAll("[data-wcs]").forEach(function (b) {
            var name = b.dataset.wcs;
            b.disabled = !ok;
            b.className = "pc-key pc-small" + (name === w.active ? " sel" : w.slots[name] ? "" : " empty");
            b.title = w.slots[name] ? "Work zero at machine " + offsetText(toUnit(w.slots[name])) : "Not set yet";
        });
        $("wcs-name").textContent = w.active + " position";
        $("wcs-offset").textContent = w.live ? "zero at machine " + offsetText(w.live) : "";
    }

    // Read the live work zero. The active slot mirrors it, so a zero set
    // anywhere (ZERO keys, the keypad, a macro) lands in the active slot.
    function readOffsets(done) {
        if (!LIVE) return;
        fabmo.getConfig(function (err, cfg) {
            var d = !err && cfg && cfg.driver;
            if (!d) return;
            var w = S.wcs;
            var live = { x: Number(d.g55x) || 0, y: Number(d.g55y) || 0, z: Number(d.g55z) || 0 };
            w.live = live;
            if (w.pending) {
                if (sameOffset(live, w.pending.target)) {
                    w.pending = null;
                } else if (Date.now() < w.pending.until) {
                    setTimeout(readOffsets, 300);
                    return render();
                } else {
                    w.pending = null;
                    log("The work offset did not take. " + w.active + " now holds the zero the machine is actually using.", "err");
                }
            }
            if (w.loaded) {
                var cur = w.slots[w.active];
                if (!cur || !sameOffset(toUnit(cur), live)) {
                    w.slots[w.active] = { x: live.x, y: live.y, z: live.z, unit: unit() };
                    saveWcs();
                }
            }
            render();
            if (typeof done === "function") done();
        });
    }

    function loadWcs() {
        fabmo.getAppConfig(function (err, cfg) {
            var saved = !err && cfg && cfg.wcs;
            if (saved && WCS.indexOf(saved.active) >= 0) S.wcs.active = saved.active;
            if (saved && saved.slots) {
                WCS.forEach(function (name) {
                    var v = saved.slots[name];
                    if (v && AXES.every(function (ax) { return isFinite(Number(v[ax])); })) {
                        S.wcs.slots[name] = { x: Number(v.x), y: Number(v.y), z: Number(v.z), unit: v.unit === "mm" ? "mm" : "in" };
                    }
                });
            }
            S.wcs.loaded = true;
            readOffsets();
        });
    }

    function selectWcs(name) {
        var w = S.wcs;
        if (name === w.active || !w.loaded || !w.live || w.pending) return;
        var slot = w.slots[name];
        if (!slot) {
            // Nothing saved here yet: it starts as a copy of the current zero.
            w.active = name;
            w.slots[name] = { x: w.live.x, y: w.live.y, z: w.live.z, unit: unit() };
            saveWcs();
            log(name + " selected. It starts as a copy of " + "the current zero; use the ZERO keys to set it.");
            return render();
        }
        var target = toUnit(slot);
        dialog(
            "Switch to " + name,
            "Work zero moves to machine " + offsetText(target) + " (" + unit() + "). Nothing moves, but the readout and every " +
                "job after this use the new zero. Stored zeros are only right if the machine has been homed since power-up, " +
                "and Z only if the same bit is in.",
            function () {
                whenIdle(function () {
                    ensureManual(function () {
                        applyWcs(name, target);
                    });
                });
            }
        );
    }

    // Put the work zero at `target` (machine coordinates) by telling the
    // manual runtime what the current position reads in the new system —
    // the keypad's "set coordinates" path, so no file runs.
    function applyWcs(name, target) {
        var w = S.wcs;
        readOffsets(function () {
            if (!inManual()) return log("Could not switch work offset: lost manual control.", "err");
            var move = {};
            AXES.forEach(function (ax) {
                var pos = Number(S.status["pos" + ax]) || 0;
                move[ax.toUpperCase()] = Number((pos + w.live[ax] - target[ax]).toFixed(5));
            });
            w.active = name;
            w.pending = { target: target, until: Date.now() + 4000 };
            saveWcs();
            log("Work offset " + name + ": zero at machine " + offsetText(target));
            fabmo.manualSet(move, sent("Work offset " + name));
            render();
            setTimeout(readOffsets, 700);
        });
    }

    function buildIncs() {
        var list = INCREMENTS[unit()];
        $("incs").innerHTML =
            '<button class="pc-key' + (S.inc === "cont" ? " sel" : "") + '" data-inc="cont">CONT</button>' +
            list
                .map(function (v, i) {
                    return '<button class="pc-key' + (i === S.inc ? " sel" : "") + '" data-inc="' + i + '">' + v + "</button>";
                })
                .join("");
        $("jog-hint").textContent =
            S.inc === "cont" ? "Hold a key to move; release to stop." : "One press, one step of " + list[S.inc] + " " + unit() + ".";
    }

    function cycleStart() {
        if (S.status.state === "paused") {
            log("Cycle start (resume)");
            return fabmo.resume(sent("Resume"));
        }
        if (!S.pending[0]) return log("No job loaded. F3 Jobs.", "warn");
        whenIdle(function () {
            log("Cycle start: " + S.pending[0].name);
            fabmo.runNext(sent("Cycle start"));
        });
    }

    // ------------------------------------------------------------------ MDI

    // OpenSBP lines are a two-letter mnemonic (or a C# macro call, an
    // assignment, or anything with commas); the rest is treated as G-code.
    function kindOf(text) {
        var s = text.trim();
        if (!s) return "";
        if (/^[&$]/.test(s) || /^[A-Za-z]{2}(\b|,|$)/.test(s) || /^[Cc]\d+\s*$/.test(s) || s.indexOf(",") >= 0) return "sbp";
        return "gcode";
    }

    function mdiSubmit() {
        var text = $("mdi").value.trim();
        if (!text) return;
        if (!LIVE) return log("Demo mode — not connected to a machine.", "warn");
        if (!idle() && !inManual()) return log("MDI needs the machine at READY.", "warn");
        var kind = kindOf(text);
        whenIdle(function () {
            log("MDI> " + text.toUpperCase());
            if (kind === "sbp") fabmo.runSBP(text, sent("MDI"));
            else fabmo.runGCode(text, sent("MDI"));
        });
        if (S.history[S.history.length - 1] !== text) S.history.push(text);
        if (S.history.length > 50) S.history.shift();
        S.histPos = S.history.length;
        $("mdi").value = "";
        $("mdi-kind").textContent = "";
    }

    // ----------------------------------------------------------------- wire

    function wire() {
        $("dialog-ok").addEventListener("click", function () { closeDialog(true); });
        $("dialog-cancel").addEventListener("click", function () { closeDialog(false); });
        $("dialog").addEventListener("click", function (e) {
            if (e.target === $("dialog")) closeDialog(false);
        });
        document.addEventListener("keydown", function (e) {
            if (e.key === "Escape" && !$("dialog").hidden) closeDialog(false);
        });

        $("dro").addEventListener("click", function (e) {
            var b = e.target.closest("[data-zero]");
            if (b && !b.disabled) zeroAxis(b.dataset.zero);
        });
        $("wcs").addEventListener("click", function (e) {
            var b = e.target.closest("[data-wcs]");
            if (b && !b.disabled) selectWcs(b.dataset.wcs);
        });
        $("incs").addEventListener("click", function (e) {
            var b = e.target.closest("[data-inc]");
            if (!b) return;
            stopHold();
            S.inc = b.dataset.inc === "cont" ? "cont" : Number(b.dataset.inc);
            buildIncs();
        });
        var jog = document.querySelector(".pc-jog");
        jog.addEventListener("click", function (e) {
            var b = e.target.closest("[data-jog]");
            if (b && !b.disabled) step(b.dataset.jog, Number(b.dataset.dir));
        });
        jog.addEventListener("pointerdown", function (e) {
            var b = e.target.closest("[data-jog]");
            if (b) holdStart(b, e);
        });
        jog.addEventListener("contextmenu", function (e) {
            e.preventDefault();
        });
        // Every way a press can end, including the ones that never deliver
        // a pointerup to the key itself.
        ["pointerup", "pointercancel"].forEach(function (name) {
            window.addEventListener(name, stopHold, true);
        });
        jog.addEventListener("lostpointercapture", stopHold);
        window.addEventListener("blur", endSession);
        window.addEventListener("pagehide", endSession);
        document.addEventListener("visibilitychange", function () {
            if (document.hidden) endSession();
        });

        $("btn-start").addEventListener("click", cycleStart);
        $("btn-hold").addEventListener("click", function () {
            log("Feed hold");
            fabmo.pause(sent("Feed hold"));
        });
        $("btn-cancel").addEventListener("click", function () {
            if (inManual()) return endSession(); // just hand manual control back
            log("Cycle cancel", "warn");
            fabmo.stop(sent("Cycle cancel"));
        });

        $("mdi-form").addEventListener("submit", function (e) {
            e.preventDefault();
            mdiSubmit();
        });
        $("mdi").addEventListener("input", function () {
            var k = kindOf($("mdi").value);
            $("mdi-kind").textContent = k === "sbp" ? "OpenSBP" : k === "gcode" ? "G-code" : "";
        });
        $("mdi").addEventListener("keydown", function (e) {
            if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
            e.preventDefault();
            S.histPos = Math.max(0, Math.min(S.history.length, S.histPos + (e.key === "ArrowUp" ? -1 : 1)));
            $("mdi").value = S.history[S.histPos] || "";
            $("mdi").dispatchEvent(new Event("input"));
        });
    }

    buildFkeys();
    buildIncs();
    buildWcs();
    wire();
    render();
    log("Pecan ready. Shell intact.");

    if (LIVE) {
        fabmo.on("status", onStatus);
        fabmo.on("job_start", refreshJobs);
        fabmo.on("job_end", refreshJobs);
        fabmo.on("change", function (topic) {
            if (topic === "jobs") refreshJobs();
            if (topic === "offsets") readOffsets();
        });
        fabmo.requestStatus(function (err, status) {
            if (!err) onStatus(status);
        });
        refreshJobs();
        loadManualSettings();
        loadWcs();
        window.addEventListener("focus", function () { readOffsets(); });
    } else {
        log("Demo mode — open Pecan from the FabMo dashboard to drive a machine.", "warn");
    }
})();
