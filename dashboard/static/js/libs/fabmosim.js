/*
 * fabmosim.js is a simulated machine that sits behind FabMoAPI's transport
 * chokepoints (_get/_post/command/executeRuntimeCode) while Training Mode is
 * active. Apps and the dashboard run unmodified against it: status reports
 * flow through the same _setStatus/emit('status') path the websocket uses,
 * and every write/motion request is either simulated or refused -- nothing
 * reaches the engine, so the real machine can never move.
 */
define(function (require) {
    "use strict";

    var TICK_MS = 250;

    function clone(obj) {
        return JSON.parse(JSON.stringify(obj));
    }

    // The sim's practice sheet, in inches: a 24"-long-side table with the
    // REAL machine's proportions, so a PRS trainee sees a long table and a
    // Desktop trainee a squarer one, while lesson geometry (2"-tile practice
    // ring, Z-plate at (6,4)) stays valid. coach-machine.js computes the
    // SAME function from the same config, so the stage and the sim always
    // agree on the sheet. Falls back to 24x18 when config is unavailable.
    function sheetSize(engine) {
        var sx = 24,
            sy = 18;
        try {
            var m = engine && engine.config && engine.config.machine;
            var env = m && m.envelope;
            var xs = env && (env.xsize || env.xmax);
            var ys = env && (env.ysize || env.ymax);
            if (xs > 0 && ys > 0) {
                if (xs >= ys) {
                    sy = Math.max(6, Math.round((24 * ys) / xs));
                } else {
                    // portrait tables (e.g. Handibot): long side is Y
                    sx = Math.max(6, Math.round((24 * xs) / ys));
                    sy = 24;
                }
            }
        } catch (e) {
            /* fall through to the default sheet */
        }
        return { x: sx, y: sy };
    }

    function SimMachine(engine) {
        this.engine = engine;
        this.status = null;
        this._timer = null;
        this._seq = []; // queue of animation steps
        this._step = null; // step in progress: {kind, ...}
        this._vel = { x: 0, y: 0, z: 0 }; // manual continuous velocities (units/min)
        this._maintDeadline = 0;
        this._actionHandlers = [];
        this._seqName = null;
        this.active = false;
    }

    // ---------------------------------------------------------- lifecycle

    SimMachine.prototype.enter = function () {
        if (this.active) return null;
        var st = this.engine.status || {};
        if (st.state && st.state !== "idle") {
            return new Error("Training Mode requires an idle machine.");
        }
        this.status = clone(st);
        // A fresh trainee should see a believable un-homed position. The
        // clone above inherits the REAL machine's DRO position, which could
        // sit anywhere (or beyond the envelope after a wild zero) — the
        // stage spindle used to start offscreen and fly in during homing.
        // Park the sim head near the envelope's far corner instead: the
        // stage's logarithmic axis warp maps the whole envelope onto the
        // sheet, so this draws just inside the far edge and homing visibly
        // crosses the whole table. Units: envelope is in config units,
        // status stream in status units.
        var pu = st.unit === "mm" ? 25.4 : 1;
        var park = sheetSize(this.engine); // fallback: the 24" sheet itself
        try {
            var mc = this.engine && this.engine.config && this.engine.config.machine;
            var env = mc && mc.envelope;
            var uc = mc && mc.units === "mm" ? 1 / 25.4 : 1;
            var xs = env && (env.xsize || env.xmax) * uc;
            var ys = env && (env.ysize || env.ymax) * uc;
            if (xs > 0 && ys > 0) park = { x: xs, y: ys };
        } catch (e) {
            /* keep the sheet fallback */
        }
        this.status.posx = Math.round(park.x * 0.8) * pu;
        this.status.posy = Math.round(park.y * 0.72) * pu;
        this.status.posz = 1.25 * pu;
        this.status.state = "idle";
        this.status.info = undefined;
        this.status.job = null;
        this.status.line = null;
        this.status.nb_lines = null;
        this.status.inFeedHold = false;
        this.status.hold = 0;
        this.status.resumeFlag = false;
        this._paused = false;
        this._lastTick = 0;
        this._gate = false;
        this.status.zplate = 0; // Z-zero plate theater props (0..1), drawn
        this.status.zclip = 0; //  by the coach stage renderer
        this.active = true;
        this.engine.sim = this;
        this._timer = setInterval(this._tick.bind(this), TICK_MS);
        this._emit();
        return null;
    };

    SimMachine.prototype.exit = function () {
        if (!this.active) return;
        clearInterval(this._timer);
        this._timer = null;
        this._seq = [];
        this._step = null;
        this.active = false;
        this.engine.sim = null;
        // Pull a real status so the dashboard snaps back to the live machine.
        this.engine.requestStatus();
        try {
            this.engine.getStatus();
        } catch (e) {
            /* socket refresh above is the primary path */
        }
    };

    // Coach (or anything else) can observe what the user did and what the
    // sim played out: {type:'code'|'macro'|'manual'|'blocked'|'sequence', ...}
    SimMachine.prototype.onAction = function (fn) {
        this._actionHandlers.push(fn);
    };

    SimMachine.prototype._action = function (evt) {
        this._actionHandlers.forEach(function (fn) {
            try {
                fn(evt);
            } catch (e) {
                console.error(e);
            }
        });
    };

    // ------------------------------------------------- transport handlers
    // Each returns true if the request was consumed by the sim.

    SimMachine.prototype.interceptGet = function (url, errback, callback) {
        if (!this.active) return false;
        if (url === "/status") {
            // Some callers poll getStatus() with no callback at all (e.g.
            // main.js on idle) -- consume the read without one, or the throw
            // unwinds through the synchronous status emit that triggered it.
            (callback || errback || function () {})(null, clone(this.status));
            return true;
        }
        return false; // all other reads pass through to the engine
    };

    SimMachine.prototype.interceptPost = function (url, data, errback, callback) {
        if (!this.active) return false;
        callback = callback || function () {};
        errback = errback || function () {};
        var m;
        if (url === "/code") {
            this._handleCode(data && data.cmd ? String(data.cmd) : "");
            callback(null, {});
            return true;
        }
        if ((m = url.match(/^\/macros\/(\d+)\/run$/))) {
            this._handleCode("C" + m[1]);
            callback(null, {});
            return true;
        }
        // Default-deny: no write may reach the engine from Training Mode.
        this._action({ type: "blocked", url: url });
        errback(new Error("Not available in Training Mode"));
        return true;
    };

    SimMachine.prototype.interceptCommand = function (name) {
        if (!this.active) return false;
        if (name === "pause") {
            // Feed-hold: stop advancing but keep the queue so resume can
            // continue. The footer shows RESUME/QUIT when state is "paused"
            // and treats inFeedHold+hold:10 as "fully stopped" (buttons active).
            if (this.status.state === "running") {
                this._paused = true;
                this._vel = { x: 0, y: 0, z: 0 };
                this.status.inFeedHold = true;
                this.status.hold = 10;
                this._setState("paused");
                this._action({ type: "command", cmd: "pause" });
            }
        } else if (name === "resume") {
            if (this.status.state === "paused") {
                this._paused = false;
                this.status.inFeedHold = false;
                this.status.hold = 0;
                this._setState("running");
                this._action({ type: "command", cmd: "resume" });
            }
        } else if (name === "quit" || name === "stop") {
            this._seq = [];
            this._step = null;
            this._paused = false;
            this._vel = { x: 0, y: 0, z: 0 };
            this.status.inFeedHold = false;
            this.status.hold = 0;
            this._setState("idle");
            this._action({ type: "command", cmd: name });
        }
        return true; // never forward commands while training
    };

    SimMachine.prototype.interceptRuntimeCode = function (runtime, code) {
        if (!this.active) return false;
        if (runtime === "manual" && code) this._handleManual(code);
        return true;
    };

    // ------------------------------------------------------------ manual

    SimMachine.prototype._handleManual = function (code) {
        var pos = this.status;
        switch (code.cmd) {
            case "enter":
                this._setState("manual");
                this.status.hideKeypad = !!code.hideKeypad;
                break;
            case "exit":
            case "quit":
                this._vel = { x: 0, y: 0, z: 0 };
                this._setState("idle");
                break;
            case "start":
                this._vel = { x: 0, y: 0, z: 0 };
                if (code.axis) this._vel[code.axis.toLowerCase()] = code.speed || 0;
                if (code.second_axis) this._vel[code.second_axis.toLowerCase()] = code.second_speed || 0;
                this._maintDeadline = Date.now() + 1000;
                break;
            case "maint":
                this._maintDeadline = Date.now() + 1000;
                break;
            case "stop":
                this._vel = { x: 0, y: 0, z: 0 };
                break;
            case "fixed": {
                var d = {};
                if (code.axis) d["pos" + code.axis.toLowerCase()] = (pos["pos" + code.axis.toLowerCase()] || 0) + (code.dist || 0);
                if (code.second_axis) d["pos" + code.second_axis.toLowerCase()] = (pos["pos" + code.second_axis.toLowerCase()] || 0) + (code.second_dist || 0);
                this._enqueueMove(d, 0.4, "manual");
                break;
            }
            case "goto": {
                var mv = code.move || {};
                var dest = {};
                ["x", "y", "z"].forEach(function (ax) {
                    if (mv[ax] !== undefined) dest["pos" + ax] = mv[ax];
                });
                this._enqueueMove(dest, 1.2, "manual");
                break;
            }
            default:
                break; // raw / nudge_cancel / softLimitOverride: no-op
        }
        this._action({ type: "manual", cmd: code.cmd, code: code });
    };

    // -------------------------------------------------------------- code

    // Recognize the commands the Console's workflow buttons and FP box send.
    // Anything we don't model still "runs": brief running state, then idle,
    // so the UI behaves believably.
    SimMachine.prototype._handleCode = function (text) {
        this._action({ type: "code", code: text });
        var u = this.status.unit === "mm" ? 25.4 : 1;
        var lines = text.split(/[\n\r]+/);
        var queued = false;
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (!line) continue;
            var cmd = line.split(",")[0].trim().toUpperCase().replace("#", "");
            var args = line
                .split(",")
                .slice(1)
                .map(function (s) {
                    var v = parseFloat(s);
                    return isNaN(v) ? undefined : v;
                });
            if (cmd === "C3" || cmd === "MH") {
                this._queueHoming(u);
                queued = true;
            } else if (cmd === "C2") {
                this._queueZeroZ(u);
                queued = true;
            } else if (cmd === "JH") {
                this._enqueue([
                    { kind: "state", state: "running" },
                    { kind: "move", to: { posz: 0.8 * u }, secs: 1 },
                    { kind: "move", to: { posx: 0, posy: 0 }, secs: 2.5 },
                    { kind: "state", state: "idle" },
                    { kind: "done", name: "JH" },
                ]);
                queued = true;
            } else if (cmd === "M2" || cmd === "J2") {
                this._enqueueMove({ posx: args[0], posy: args[1] }, cmd === "J2" ? 1.5 : 3, "running");
                queued = true;
            } else if (cmd === "MX" || cmd === "JX") {
                this._enqueueMove({ posx: args[0] }, 1.5, "running");
                queued = true;
            } else if (cmd === "MY" || cmd === "JY") {
                this._enqueueMove({ posy: args[0] }, 1.5, "running");
                queued = true;
            } else if (cmd === "MZ" || cmd === "JZ") {
                this._enqueueMove({ posz: args[0] }, 1, "running");
                queued = true;
            } else if (cmd === "M3" || cmd === "J3") {
                this._enqueueMove({ posx: args[0], posy: args[1], posz: args[2] }, 2, "running");
                queued = true;
            }
        }
        if (!queued) {
            this._enqueue([
                { kind: "state", state: "running" },
                { kind: "pause", secs: 0.8 },
                { kind: "state", state: "idle" },
                { kind: "done", name: "generic" },
            ]);
        }
    };

    // The scripted sequences are theater: they reproduce what an operator
    // SEES during a real C3/C2 (approach, switch trip, back-off, slow
    // re-approach), not the macros' actual logic. Motion HOLDS on every
    // switch trip (TRIP_HOLD) so a trainee has time to find the lit input.
    var TRIP_HOLD = 1.5;

    SimMachine.prototype._queueHoming = function (u) {
        var s = [{ kind: "state", state: "running" }];
        s.push({ kind: "move", to: { posz: 0.8 * u }, secs: 0.8 });
        // Y homes FIRST on a ShopBot: seek, trip prox (in3), back off, creep in
        s.push({ kind: "move", to: { posy: -0.1 * u }, secs: 2 });
        s.push({ kind: "input", name: "in3", value: 1 });
        s.push({ kind: "pause", secs: TRIP_HOLD });
        s.push({ kind: "move", to: { posy: 0.25 * u }, secs: 0.6 });
        s.push({ kind: "input", name: "in3", value: 0 });
        s.push({ kind: "move", to: { posy: -0.02 * u }, secs: 0.8 });
        s.push({ kind: "input", name: "in3", value: 1 });
        s.push({ kind: "pause", secs: TRIP_HOLD });
        s.push({ kind: "set", fields: { posy: 0 } });
        s.push({ kind: "input", name: "in3", value: 0 });
        // then X: same dance (in2)
        s.push({ kind: "move", to: { posx: -0.1 * u }, secs: 2 });
        s.push({ kind: "input", name: "in2", value: 1 });
        s.push({ kind: "pause", secs: TRIP_HOLD });
        s.push({ kind: "move", to: { posx: 0.25 * u }, secs: 0.6 });
        s.push({ kind: "input", name: "in2", value: 0 });
        s.push({ kind: "move", to: { posx: -0.02 * u }, secs: 0.8 });
        s.push({ kind: "input", name: "in2", value: 1 });
        s.push({ kind: "pause", secs: TRIP_HOLD });
        s.push({ kind: "set", fields: { posx: 0 } });
        s.push({ kind: "input", name: "in2", value: 0 });
        s.push({ kind: "state", state: "idle" });
        s.push({ kind: "done", name: "home" });
        this._enqueue(s);
    };

    // Hold queued sequence steps at the next boundary (the coach raises
    // this while instruction text is printing, drops it when done).
    SimMachine.prototype.gateSequences = function (on) {
        this._gate = !!on;
    };

    // True while sequence steps are parked behind the narration gate and
    // nothing is mid-flight — the coach turns this into a Continue button,
    // so the trainee finishes reading before the theater moves.
    SimMachine.prototype.hasGatedSequence = function () {
        return !!(this.active && this._gate && this._seq.length > 0 && !this._step);
    };

    SimMachine.prototype._queueZeroZ = function (u) {
        var plate = 0.472 * u; // typical ShopBot plate thickness, close enough for theater
        var s = [{ kind: "state", state: "running" }];
        // Setup ritual, the part the OPERATOR does on a real machine: slide
        // clear of the corner, the plate slips under the bit, the grounding
        // clip grabs the bit. zplate/zclip (0..1) drive the stage renderer.
        s.push({ kind: "move", to: { posz: Math.max(this.status.posz || 0, 1.0 * u) }, secs: 0.6 });
        s.push({ kind: "move", to: { posx: 6 * u, posy: 4 * u }, secs: 1.6 });
        s.push({ kind: "move", to: { zplate: 1 }, secs: 1.4 });
        s.push({ kind: "pause", secs: 0.4 });
        s.push({ kind: "move", to: { zclip: 1 }, secs: 0.8 });
        s.push({ kind: "pause", secs: 0.5 });
        // the measurement: fast find, back off, slow press for accuracy
        s.push({ kind: "move", to: { posz: plate }, secs: 2.0 });
        s.push({ kind: "input", name: "in1", value: 1 }); // plate contact
        s.push({ kind: "pause", secs: TRIP_HOLD });
        s.push({ kind: "move", to: { posz: plate + 0.25 * u }, secs: 0.5 });
        s.push({ kind: "input", name: "in1", value: 0 });
        s.push({ kind: "move", to: { posz: plate - 0.01 * u }, secs: 0.8 });
        s.push({ kind: "input", name: "in1", value: 1 });
        s.push({ kind: "set", fields: { posz: plate } });
        s.push({ kind: "pause", secs: TRIP_HOLD });
        s.push({ kind: "input", name: "in1", value: 0 });
        s.push({ kind: "move", to: { posz: 1.0 * u }, secs: 0.8 });
        // teardown, also the operator's job: unclip, stow the plate
        s.push({ kind: "move", to: { zclip: 0 }, secs: 0.6 });
        s.push({ kind: "move", to: { zplate: 0 }, secs: 1.2 });
        s.push({ kind: "state", state: "idle" });
        s.push({ kind: "done", name: "zeroz" });
        this._enqueue(s);
    };

    // --------------------------------------------------------- animation

    SimMachine.prototype._enqueueMove = function (dest, secs, state) {
        var to = {};
        var any = false;
        for (var k in dest) {
            if (dest[k] !== undefined) {
                to[k] = dest[k];
                any = true;
            }
        }
        if (!any) return;
        var restore = this.status.state === "manual" ? "manual" : "idle";
        this._enqueue([
            { kind: "state", state: state || "running" },
            { kind: "move", to: to, secs: secs },
            { kind: "state", state: restore },
            { kind: "done", name: "move" },
        ]);
    };

    SimMachine.prototype._enqueue = function (steps) {
        this._seq = this._seq.concat(steps);
    };

    SimMachine.prototype._setState = function (state) {
        if (this.status.state !== state) {
            this.status.lastState = this.status.state;
            this.status.state = state;
        }
    };

    SimMachine.prototype._tick = function () {
        var dt = TICK_MS / 1000;
        var st = this.status;
        // A main-thread stall (the Pi under paint load) suspends the
        // keypad's maint heartbeats along with everything else. The deadman
        // is there to catch a client that stopped STREAMING, not a tab that
        // stopped RUNNING -- credit stalled time back so a held jog
        // survives a long frame.
        var now = Date.now();
        if (this._lastTick && now - this._lastTick > 2 * TICK_MS) {
            this._maintDeadline += now - this._lastTick - TICK_MS;
        }
        this._lastTick = now;

        // Feed-hold: freeze motion and the sequence, but keep both intact so
        // resume picks up where it left off. Status keeps flowing (paused).
        if (this._paused) {
            this._emit();
            return;
        }

        // Continuous manual velocities (units/min), with a deadman: the
        // keypad streams 'maint' while a key is held.
        if (this._vel.x || this._vel.y || this._vel.z) {
            if (Date.now() > this._maintDeadline) {
                this._vel = { x: 0, y: 0, z: 0 };
            } else {
                st.posx = (st.posx || 0) + (this._vel.x / 60) * dt;
                st.posy = (st.posy || 0) + (this._vel.y / 60) * dt;
                st.posz = (st.posz || 0) + (this._vel.z / 60) * dt;
            }
        }

        // Scripted sequence steps. The coach raises the gate while its
        // instruction text is printing, so the theater never runs ahead of
        // the narration: queued steps wait at the next boundary (an
        // in-flight move or pause finishes first; jogging is unaffected).
        while (this._seq.length || this._step) {
            if (!this._step) {
                if (this._gate) break;
                var next = this._seq.shift();
                if (next.kind === "move") {
                    var from = {};
                    for (var k in next.to) from[k] = st[k] || 0;
                    this._step = { kind: "move", from: from, to: next.to, t: 0, secs: Math.max(next.secs, dt) };
                } else if (next.kind === "pause") {
                    this._step = { kind: "pause", t: 0, secs: next.secs };
                } else if (next.kind === "state") {
                    this._setState(next.state);
                    continue;
                } else if (next.kind === "set") {
                    for (var f in next.fields) st[f] = next.fields[f];
                    continue;
                } else if (next.kind === "input") {
                    st[next.name] = next.value;
                    // Let observers (the coach) react to the trip itself,
                    // e.g. to flash the input light during the hold.
                    this._action({ type: "input", name: next.name, value: next.value });
                    continue;
                } else if (next.kind === "done") {
                    this._action({ type: "sequence", name: next.name, phase: "done" });
                    continue;
                } else {
                    continue;
                }
            }
            // advance the in-progress timed step by one tick, then wait
            var stp = this._step;
            stp.t += dt;
            var p = Math.min(1, stp.t / stp.secs);
            if (stp.kind === "move") {
                for (var ax in stp.to) {
                    st[ax] = stp.from[ax] + (stp.to[ax] - stp.from[ax]) * p;
                }
            }
            if (p >= 1) {
                this._step = null;
                continue; // zero-cost steps may follow immediately
            }
            break;
        }

        this._emit();
    };

    SimMachine.prototype._emit = function () {
        var copy = clone(this.status);
        copy.server_ts = Date.now();
        this.engine._setStatus(copy);
        this.engine.emit("status", copy);
    };

    return SimMachine;
});
