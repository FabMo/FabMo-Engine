/*
 * Motor Music — play the machine from the computer keyboard.
 *
 * Motion goes through manual mode's velocity-jog path: every TICK_MS the app
 * re-sends manualStart (ratio form) with the current chord's per-axis
 * speeds. That stream is also the deadman: if this page stops sending
 * (closed, hung, lost focus), the firmware's host-silence watchdog ramps
 * the motors down on its own.
 *
 * Input is physical keys only. The on-screen keyboard is display.
 */
(function () {
    "use strict";

    var MS = window.MotorSynth;
    var fabmo = new FabMoDashboard();
    var LIVE = fabmo.isPresent();
    var $ = function (id) {
        return document.getElementById(id);
    };

    var TICK_MS = 40;
    var RELEASE_DEBOUNCE_MS = 30; // some keyboards send keyup+keydown pairs while a key is held
    var MAX_SPEED = { in: 150, mm: 3800 }; // units/min ceiling for any note

    // Physical key (event.code) -> semitones above the lowest C
    var KEYS = {
        KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5, KeyG: 6, KeyB: 7, KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11,
        Comma: 12, KeyL: 13, Period: 14, Semicolon: 15, Slash: 16,
        KeyQ: 12, Digit2: 13, KeyW: 14, Digit3: 15, KeyE: 16, KeyR: 17, Digit5: 18, KeyT: 19, Digit6: 20, KeyY: 21,
        Digit7: 22, KeyU: 23, KeyI: 24, Digit9: 25, KeyO: 26, Digit0: 27, KeyP: 28,
    };
    var LABELS = {
        KeyZ: "Z", KeyS: "S", KeyX: "X", KeyD: "D", KeyC: "C", KeyV: "V", KeyG: "G", KeyB: "B", KeyH: "H", KeyN: "N",
        KeyJ: "J", KeyM: "M", Comma: ",", KeyL: "L", Period: ".", Semicolon: ";", Slash: "/",
        KeyQ: "Q", Digit2: "2", KeyW: "W", Digit3: "3", KeyE: "E", KeyR: "R", Digit5: "5", KeyT: "T", Digit6: "6",
        KeyY: "Y", Digit7: "7", KeyU: "U", KeyI: "I", Digit9: "9", KeyO: "O", Digit0: "0", KeyP: "P",
    };
    var SPAN = 29; // semitones shown

    var DEFAULTS = { voices: "XY", octave: 3, transpose: 0, cents: 0, vibDepth: 0.4, vibRate: 6, vibAlways: false, box: 1, speaker: !LIVE };

    var S = {
        set: Object.assign({}, DEFAULTS),
        status: { state: LIVE ? "" : "offline", posx: 0, posy: 0, unit: "in" },
        su: {}, // steps per unit by axis letter
        armed: false,
        arming: false,
        centre: { X: 0, Y: 0 },
        down: {}, // event.code -> midi currently held
        pendingUp: {}, // event.code -> timer
        shift: false,
        moving: false,
        timer: null,
        audio: null,
        osc: [],
    };
    var synth = new MS.Synth({});

    // ----------------------------------------------------------------- setup

    function axesFor() {
        return S.set.voices.split("").map(function (a) {
            // without a machine, pretend 2000 steps/unit so the readout works
            return { axis: a, su: S.su[a] || (LIVE ? 0 : 2000) };
        });
    }

    function configure() {
        synth.configure({
            axes: axesFor(),
            box: S.set.box,
            maxSpeed: MAX_SPEED[S.status.unit] || MAX_SPEED.in,
            tuning: { transpose: S.set.transpose, cents: S.set.cents },
            vibrato: { rate: S.set.vibRate, depth: S.set.vibDepth },
        });
        buildVoices();
        tuneNote();
    }

    function status(msg, err) {
        var el = $("status-line");
        el.textContent = msg || "";
        el.className = "mm-status" + (err ? " err" : "");
    }

    function tuneNote() {
        var parts = [];
        S.set.voices.split("").forEach(function (a) {
            if (S.su[a]) {
                var sp = (440 * 60) / S.su[a];
                parts.push(a + ": " + S.su[a].toFixed(1) + " steps per " + S.status.unit + ", so A4 (440 Hz) is " + sp.toFixed(1) + " " + S.status.unit + "/min");
            } else if (LIVE) {
                parts.push(a + ": steps per " + S.status.unit + " not found in the machine settings — this axis cannot play");
            }
        });
        $("tune-note").innerHTML =
            (parts.length ? parts.join(" &middot; ") + ". " : "") +
            "Pitch assumes one motor step per cycle of the tone. If the motors sound in a different octave or key, hold A4 " +
            "(key <b>Y</b> with Lowest octave at 3) against a tuner app and adjust Transpose and Fine tune.";
    }

    // --------------------------------------------------------------- display

    function isBlack(semi) {
        return [1, 3, 6, 8, 10].indexOf(semi % 12) >= 0;
    }

    function buildPiano() {
        var el = $("piano");
        el.innerHTML = "";
        var whites = [];
        for (var s = 0; s < SPAN; s++) if (!isBlack(s)) whites.push(s);
        var ww = 100 / whites.length;
        var labelFor = function (semi) {
            var out = [];
            Object.keys(KEYS).forEach(function (c) {
                if (KEYS[c] === semi) out.push(LABELS[c]);
            });
            return out.join(" ");
        };
        var add = function (semi, cls, left, width) {
            var d = document.createElement("div");
            d.className = "mm-key " + cls;
            d.dataset.semi = semi;
            d.style.left = left + "%";
            d.style.width = width + "%";
            d.innerHTML = '<span class="kb">' + labelFor(semi) + '</span><span class="nn"></span>';
            el.appendChild(d);
        };
        whites.forEach(function (semi, i) {
            add(semi, "white", i * ww, ww);
        });
        for (var s2 = 0; s2 < SPAN; s2++) {
            if (!isBlack(s2)) continue;
            var i = whites.indexOf(s2 - 1);
            add(s2, "black", (i + 1) * ww - ww * 0.3, ww * 0.6);
        }
        labelPiano();
    }

    function labelPiano() {
        var base = 12 * (S.set.octave + 1);
        document.querySelectorAll(".mm-key").forEach(function (k) {
            var semi = Number(k.dataset.semi);
            k.querySelector(".nn").textContent = isBlack(semi) ? "" : MS.noteName(base + semi);
        });
    }

    function buildVoices() {
        $("voices").innerHTML = synth.voices
            .map(function (v, i) {
                return (
                    '<div class="mm-voice silent" data-v="' + i + '"><span class="ax">' + v.axis + '</span><span class="nt">—</span>' +
                    '<span class="dt"></span></div>'
                );
            })
            .join("");
    }

    function paint(frame) {
        var base = 12 * (S.set.octave + 1);
        var byNote = {};
        frame.voices.forEach(function (v, i) {
            var el = document.querySelector('.mm-voice[data-v="' + i + '"]');
            if (v.note !== null) byNote[v.note] = i;
            if (!el) return;
            el.classList.toggle("silent", v.note === null);
            el.querySelector(".nt").textContent = v.note === null ? "—" : MS.noteName(v.note);
            el.querySelector(".dt").textContent =
                v.note === null
                    ? ""
                    : v.freq.toFixed(1) + " Hz · " + Math.abs(v.speed).toFixed(1) + " " + S.status.unit + "/min " + (v.speed < 0 ? "←" : "→");
        });
        var heldDry = {};
        Object.keys(S.down).forEach(function (c) {
            heldDry[S.down[c]] = true;
        });
        document.querySelectorAll(".mm-key").forEach(function (k) {
            var midi = base + Number(k.dataset.semi);
            var cls = "mm-key " + (k.classList.contains("black") ? "black" : "white");
            if (byNote[midi] !== undefined) cls += " on" + byNote[midi];
            else if (heldDry[midi]) cls += " dry";
            if (k.className !== cls) k.className = cls;
        });
    }

    function refresh() {
        $("state-badge").textContent = S.status.state || "—";
        $("state-badge").className = "mm-badge mm-state " + (S.status.state || "");
        $("pos-badge").textContent = LIVE ? "X " + S.status.posx.toFixed(3) + "  Y " + S.status.posy.toFixed(3) + "  " + S.status.unit : "not connected";
        $("btn-arm").hidden = S.armed;
        $("btn-disarm").hidden = !S.armed;
        $("btn-arm").disabled = !LIVE || S.arming || S.status.state !== "idle";
        document.querySelector(".mm-arm").classList.toggle("armed", S.armed);
        document.querySelectorAll(".unit").forEach(function (el) {
            el.textContent = S.status.unit;
        });
        $("arm-note").innerHTML = S.armed
            ? "<b>Playing.</b> Keys move the X and Y motors. Click away, switch apps or press Esc and the machine stops."
            : LIVE
              ? "Playing moves the machine. Each note shuttles an axis back and forth inside a small area around where the " +
                "tool is now. Spindle off, tool raised, stay clear."
              : "Not connected to a machine — keys sound through this computer only, as a preview.";
    }

    // ------------------------------------------------------ speaker preview

    function speaker(frame) {
        if (!S.set.speaker) {
            if (S.audio) S.osc.forEach(function (o) { o.gain.gain.value = 0; });
            return;
        }
        if (!S.audio) {
            var AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return;
            try {
                S.audio = new AC();
            } catch (e) {
                return;
            }
        }
        frame.voices.forEach(function (v, i) {
            if (!S.osc[i]) {
                var o = S.audio.createOscillator(),
                    g = S.audio.createGain();
                o.type = "square";
                g.gain.value = 0;
                o.connect(g);
                g.connect(S.audio.destination);
                o.start();
                S.osc[i] = { osc: o, gain: g };
            }
            var t = S.audio.currentTime;
            if (v.note !== null && v.freq > 0) {
                S.osc[i].osc.frequency.setTargetAtTime(v.freq, t, 0.004);
                S.osc[i].gain.gain.setTargetAtTime(0.06, t, 0.005);
            } else {
                S.osc[i].gain.gain.setTargetAtTime(0, t, 0.01);
            }
        });
        for (var j = frame.voices.length; j < S.osc.length; j++) S.osc[j].gain.gain.value = 0;
    }

    // ------------------------------------------------------------- the loop

    function tick() {
        if (S.armed) {
            synth.setOffset("X", S.status.posx - S.centre.X);
            synth.setOffset("Y", S.status.posy - S.centre.Y);
        }
        var frame = synth.frame(performance.now() / 1000, S.shift || S.set.vibAlways);
        if (S.armed) {
            if (frame.cmd) {
                var c = frame.cmd;
                fabmo.manualStart(c.axis, c.speed, c.second_axis, c.second_speed, c.primary_ratio, c.secondary_ratio);
                S.moving = true;
            } else if (S.moving) {
                fabmo.manualStop();
                S.moving = false;
            }
        }
        speaker(frame);
        paint(frame);
    }

    // --------------------------------------------------------- arm / disarm

    function arm() {
        if (!LIVE || S.armed || S.arming) return;
        if (S.status.state !== "idle") return status("The machine must be idle to start playing.", true);
        var missing = S.set.voices.split("").filter(function (a) {
            return !S.su[a];
        });
        if (missing.length) return status("No steps-per-unit setting found for " + missing.join(", ") + ".", true);
        S.arming = true;
        status("Taking manual control…");
        refresh();
        fabmo.manualEnter({ hideKeypad: true, mode: "normal" }, function () {});
        var t0 = Date.now();
        (function wait() {
            if (S.status.state === "manual") {
                S.arming = false;
                S.armed = true;
                S.moving = false;
                S.centre = { X: S.status.posx, Y: S.status.posy };
                synth.allOff();
                configure();
                status("Ready. Play.");
                window.focus();
                return refresh();
            }
            if (Date.now() - t0 > 4000) {
                S.arming = false;
                status("Could not take manual control (machine is " + (S.status.state || "not responding") + ").", true);
                return refresh();
            }
            fabmo.requestStatus(function () {});
            setTimeout(wait, 100);
        })();
    }

    function disarm(why) {
        S.down = {};
        synth.allOff();
        if (S.armed || S.arming) {
            S.armed = false;
            S.arming = false;
            if (LIVE) {
                fabmo.manualStop();
                S.moving = false;
                // let the ramp-down start before leaving manual mode
                setTimeout(function () {
                    fabmo.manualExit();
                }, 150);
            }
            status(why || "Stopped.");
        }
        refresh();
    }

    // ------------------------------------------------------------- keyboard

    function noteFor(code) {
        return KEYS[code] === undefined ? null : 12 * (S.set.octave + 1) + KEYS[code];
    }

    function typing(e) {
        var t = e.target && e.target.tagName ? e.target.tagName.toLowerCase() : "";
        return t === "input" || t === "select" || t === "textarea";
    }

    function onKeyDown(e) {
        if (typing(e)) return;
        if (e.code === "ShiftLeft" || e.code === "ShiftRight") {
            S.shift = true;
            return;
        }
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.code === "Escape") {
            e.preventDefault();
            return disarm("Stopped.");
        }
        if (e.code === "Space") {
            e.preventDefault();
            S.down = {};
            return synth.allOff();
        }
        if (e.code === "ArrowUp" || e.code === "ArrowDown") {
            e.preventDefault();
            if (e.repeat) return;
            S.set.octave = Math.max(0, Math.min(6, S.set.octave + (e.code === "ArrowUp" ? 1 : -1)));
            S.down = {};
            synth.allOff();
            showSettings();
            labelPiano();
            return saveSettings();
        }
        var midi = noteFor(e.code);
        if (midi === null) return;
        e.preventDefault();
        if (S.pendingUp[e.code]) {
            // the key never really came up: a synthesized repeat pair
            clearTimeout(S.pendingUp[e.code]);
            delete S.pendingUp[e.code];
            return;
        }
        if (e.repeat || S.down[e.code] !== undefined) return;
        S.down[e.code] = midi;
        synth.noteOn(midi);
        if (S.audio && S.audio.state === "suspended") S.audio.resume();
        tick(); // sound it now, not on the next tick
    }

    function onKeyUp(e) {
        if (e.code === "ShiftLeft" || e.code === "ShiftRight") {
            S.shift = false;
            return;
        }
        // keep the dashboard's one-key shortcuts from firing while playing
        if (S.armed || KEYS[e.code] !== undefined) e.stopPropagation();
        if (S.down[e.code] === undefined) return;
        var code = e.code;
        clearTimeout(S.pendingUp[code]);
        S.pendingUp[code] = setTimeout(function () {
            delete S.pendingUp[code];
            var midi = S.down[code];
            delete S.down[code];
            // another key may be holding the same pitch (Q and , are both C)
            var still = Object.keys(S.down).some(function (c) {
                return S.down[c] === midi;
            });
            if (!still) synth.noteOff(midi);
            tick();
        }, RELEASE_DEBOUNCE_MS);
    }

    // ------------------------------------------------------------- settings

    var FIELDS = ["octave", "transpose", "cents", "vibDepth", "vibRate", "box"];

    function showSettings() {
        FIELDS.forEach(function (k) {
            $("set-" + k).value = S.set[k];
        });
        $("set-voices").value = S.set.voices;
        $("set-vibAlways").checked = !!S.set.vibAlways;
        $("set-speaker").checked = !!S.set.speaker;
    }

    function saveSettings() {
        if (LIVE) fabmo.setAppConfig({ settings: S.set }, function () {});
    }

    function wire() {
        $("btn-arm").onclick = arm;
        $("btn-disarm").onclick = function () {
            disarm("Stopped.");
        };
        FIELDS.forEach(function (k) {
            $("set-" + k).onchange = function (e) {
                var v = parseFloat(e.target.value);
                var lo = parseFloat(e.target.min),
                    hi = parseFloat(e.target.max);
                if (isNaN(v)) return showSettings();
                if (!isNaN(lo)) v = Math.max(lo, v);
                if (!isNaN(hi)) v = Math.min(hi, v);
                if (k === "octave" || k === "transpose") v = Math.round(v);
                S.set[k] = v;
                S.down = {};
                synth.allOff();
                configure();
                labelPiano();
                showSettings();
                saveSettings();
                e.target.blur();
            };
        });
        $("set-voices").onchange = function (e) {
            if (S.armed) disarm("Stopped to change voices.");
            S.set.voices = e.target.value;
            configure();
            saveSettings();
            e.target.blur();
        };
        ["vibAlways", "speaker"].forEach(function (k) {
            $("set-" + k).onchange = function (e) {
                S.set[k] = e.target.checked;
                saveSettings();
                e.target.blur();
            };
        });
        // capture phase: see the keys before the dashboard's shortcut listener
        window.addEventListener("keydown", onKeyDown, true);
        window.addEventListener("keyup", onKeyUp, true);
        // Losing the page means losing key releases: stop rather than hang a note
        window.addEventListener("blur", function () {
            S.shift = false;
            if (S.armed) disarm("Stopped: this page lost focus.");
            else {
                S.down = {};
                synth.allOff();
            }
        });
        document.addEventListener("visibilitychange", function () {
            if (document.hidden && S.armed) disarm("Stopped: this page was hidden.");
        });
        window.addEventListener("pagehide", function () {
            if (S.armed) disarm();
        });
    }

    function onStatus(st) {
        if (!st) return;
        var unit = st.unit || S.status.unit;
        var unitChanged = unit !== S.status.unit;
        S.status = { state: st.state, posx: Number(st.posx) || 0, posy: Number(st.posy) || 0, unit: unit };
        if (S.armed && st.state !== "manual") disarm("Stopped: the machine left manual mode.");
        if (unitChanged) configure();
        refresh();
    }

    function init() {
        buildPiano();
        wire();
        showSettings();
        configure();
        refresh();
        S.timer = setInterval(tick, TICK_MS);
        if (!LIVE) return;
        fabmo.getAppConfig(function (err, cfg) {
            if (!err && cfg && cfg.settings) {
                Object.keys(DEFAULTS).forEach(function (k) {
                    if (cfg.settings[k] !== undefined) S.set[k] = cfg.settings[k];
                });
            }
            showSettings();
            labelPiano();
            configure();
        });
        fabmo.getConfig(function (err, cfg) {
            if (!err && cfg) S.su = MS.stepsPerUnit(cfg.driver);
            configure();
        });
        fabmo.on("status", onStatus);
        fabmo.requestStatus(function (err, st) {
            if (!err) onStatus(st);
        });
    }

    // test hook
    window.MotorMusicApp = { state: S, synth: synth, arm: arm, disarm: disarm, onStatus: onStatus, tick: tick };

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
})();
