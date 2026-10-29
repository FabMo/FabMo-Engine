/*
 * coach.js is the Training Mode lesson runner. It owns the simulated
 * machine (fabmosim behind FabMoAPI's transports), the TRAINING banner, and
 * the step-by-step instruction dialog. Lessons live in lessons.json as
 * declarative steps; they advance by observing what the user's clicks send
 * through the API bridge -- the coached apps are the real, unmodified
 * dashboard apps. Steps can highlight elements in the dashboard chrome or
 * inside the current app's iframe (same-origin injection, like a11y).
 *
 * The instructions are delivered game-style: a pixel ShopBot character
 * (coach-sprite.js) whose router carriage types each line out, and an
 * optional isometric view of the simulated machine (coach-machine.js) that
 * lessons can bring on stage so the trainee sees their moves play out.
 */
define(function (require) {
    "use strict";

    var $ = require("jquery");
    var SimMachine = require("./libs/fabmosim.js");
    var CoachSprite = require("./coach-sprite.js");
    var CoachMachine = require("./coach-machine.js");
    var CoachKeypad = require("./coach-keypad.js");
    var LESSONS = require("./lessons.json");

    var TYPE_MS = 22; // ms per typed character
    var TYPE_LINE = 30; // virtual carriage line length, chars (~the DRO-width rail)

    // Injected into app iframes for app-side highlights; dashboard-side
    // highlights use the same rules from style.css.
    var HIGHLIGHT_CSS =
        ".coach-highlight{outline:3px solid #d9a420 !important;outline-offset:2px;" +
        "border-radius:4px;animation:coach-pulse 1.2s ease-in-out infinite;}" +
        "@keyframes coach-pulse{0%,100%{outline-color:#d9a420;}50%{outline-color:rgba(217,164,32,0.25);}}";

    // watch specs from lessons.json -> predicate over sim actions
    function compileWatch(spec) {
        if (!spec) return null;
        if (spec.type === "any") {
            var preds = (spec.of || []).map(compileWatch);
            return function (a) {
                return preds.some(function (p) {
                    return p && p(a);
                });
            };
        }
        if (spec.type === "code") {
            var re = new RegExp(spec.pattern, "i");
            return function (a) {
                return a.type === "code" && re.test(a.code);
            };
        }
        if (spec.type === "sequence") {
            return function (a) {
                return a.type === "sequence" && a.name === spec.name;
            };
        }
        if (spec.type === "manual") {
            // Optional axis/dir narrow a keypad watch to e.g. "jog Z down":
            // start carries speed, fixed carries dist, on axis or second_axis.
            return function (a) {
                if (a.type !== "manual" || a.cmd !== spec.cmd) return false;
                if (!spec.axis) return true;
                var c = a.code || {};
                var v;
                if ((c.axis || "").toLowerCase() === spec.axis) v = c.speed !== undefined ? c.speed : c.dist;
                else if ((c.second_axis || "").toLowerCase() === spec.axis) v = c.second_speed !== undefined ? c.second_speed : c.second_dist;
                else return false;
                if (spec.dir === "neg") return v < 0;
                if (spec.dir === "pos") return v > 0;
                return true;
            };
        }
        return function () {
            return false;
        };
    }

    // "position" watches advance on the status stream instead of on actions:
    // {type:"position", axis:"z", below:0} / {above:0}.
    function checkPositionWatch(spec, status) {
        if (!spec || spec.type !== "position") return false;
        var v = status["pos" + spec.axis];
        if (v === undefined || v === null) return false;
        if (spec.below !== undefined) return v < spec.below;
        if (spec.above !== undefined) return v > spec.above;
        return false;
    }

    function Coach(engine, context) {
        this.engine = engine;
        this.context = context;
        this.sim = new SimMachine(engine);
        this.sim.onAction(this._onAction.bind(this));
        this.machine = new CoachMachine(engine);
        this.sprite = null; // built with the UI, destroyed with it
        this.lesson = null;
        this.stepIndex = 0;
        this._ui = null;
        this._hlTimer = null;
        this._typeTimer = null;
        // Registered once; inert outside a lesson (FabMoAPI has no off()).
        var self = this;
        this.engine.on("status", function (status) {
            if (!self.lesson) return;
            self._reposition();
            var step = self.lesson.steps[self.stepIndex];
            if (step && status && checkPositionWatch(step.watch, status)) {
                self.stepIndex++;
                self._showStep();
            }
        });
    }

    Coach.prototype.start = function (lessonId, callback) {
        callback = callback || function () {};
        if (this.lesson) return callback("A lesson is already running.");
        var lesson = LESSONS[lessonId];
        if (!lesson) return callback("Unknown lesson: " + lessonId);
        var err = this.sim.enter();
        if (err) return callback(err.message);
        this.lesson = lesson;
        this.stepIndex = 0;
        this._buildUI();
        this._showStep();
        $(window).on("resize.coach", this._reposition.bind(this));
        // The lesson happens in a real app. Launching it destroys the
        // Training iframe (which had focus from the Start click) and the app
        // grabs focus as it loads -- so the first click on Begin would only
        // pull focus back to the parent. Pull focus to the coach bar once
        // the app has settled so that first click actually registers.
        var self = this;
        this.context.launchApp(lesson.app || "fabmo-sb4", {}, function () {
            self._focusBar();
            setTimeout(function () {
                self._focusBar();
            }, 350);
        });
        callback(null);
    };

    Coach.prototype.exit = function () {
        if (!this.lesson) return;
        this.lesson = null;
        clearInterval(this._typeTimer);
        this._clearHighlights();
        this.machine.hide();
        // Destroy the keypad while the sim shim is still installed: its
        // parting manualStop/manualExit must go to the sim, not the engine.
        if (this._keypad) this._keypad.destroy();
        this._keypad = null;
        this.sim.exit();
        if (this._ui) {
            if (this.sprite) this.sprite.destroy();
            this.sprite = null;
            this._ui.banner.remove();
            this._ui.rail.remove();
            this._ui.arena.remove();
            this._ui = null;
        }
        $(window).off("resize.coach");
        $("body").removeClass("fabmo-training");
        // Land back on the lesson list, not in the no-longer-simulated app.
        this.context.launchApp("fabmo-training", {}, function () {});
    };

    Coach.prototype._onAction = function (action) {
        if (!this.lesson) return;
        // A switch tripped in the sim (motion holds on these): pop the
        // matching input light in the top bar so the trainee's eye finds it.
        if (action.type === "input" && action.value) {
            var light = $("." + action.name + ".input");
            light.removeClass("coach-input-pop");
            if (light[0]) void light[0].offsetWidth; // restart the animation
            light.addClass("coach-input-pop");
        }
        var step = this.lesson.steps[this.stepIndex];
        if (step && step._watch === undefined) step._watch = compileWatch(step.watch);
        if (step && step._watch && step._watch(action)) {
            this.stepIndex++;
            this._showStep();
        }
    };

    Coach.prototype._advance = function () {
        // While text is printing, the button fast-forwards; once printed, it
        // advances the lesson (classic dialog-box behavior).
        if (this._typeTimer) {
            this._finishTyping();
            return;
        }
        this.stepIndex++;
        this._showStep();
    };

    Coach.prototype._showStep = function () {
        if (!this._ui || !this.lesson) return;
        var steps = this.lesson.steps;
        if (this.stepIndex >= steps.length) {
            this.exit();
            return;
        }
        var step = steps[this.stepIndex];
        var last = this.stepIndex === steps.length - 1;
        var dots = "";
        for (var i = 0; i < steps.length; i++) {
            dots += '<span class="coach-dot' + (i === this.stepIndex ? " active" : i < this.stepIndex ? " done" : "") + '"></span>';
        }
        this._ui.dots.html(dots);
        this._clearHighlights();
        // Lessons bring the sim-machine stage on and off per step; leaving
        // the flag out keeps whatever state the previous step set. The stage
        // has two homes: docked small in the rail (stage: true) for steps
        // that need the app visible, or taking over the whole app area
        // ({"mode": "arena"}) -- optionally with the practice keypad beside
        // it ({"mode": "arena", "keypad": true}) for driving lessons.
        if (step.stage !== undefined) {
            if (step.stage) {
                var spec = typeof step.stage === "object" ? step.stage : {};
                var arena = spec.mode === "arena";
                this._ui.arena.toggleClass("visible", arena);
                if (arena && spec.keypad) this._keypad.show();
                else this._keypad.hide();
                this.machine.show({
                    sizeX: spec.sizeX,
                    sizeY: spec.sizeY,
                    arena: arena,
                    parent: arena ? this._ui.arenaSlot[0] : this._ui.stageSlot[0],
                });
                if (arena) this._fitArena();
            } else {
                this.machine.hide();
                this._keypad.hide();
                this._ui.arena.removeClass("visible");
            }
        }
        // Buttons and highlights wait until the line has finished printing.
        this._ui.next.hide();
        this._ui.show.hide();
        this._ui.bar.removeClass("coach-waiting");
        var self = this;
        this._typeText(step.text, function () {
            self._ui.next.toggle(!!step.button).text(step.button || "");
            self._ui.show.toggle(!!step.highlight);
            if (step.button) {
                self._ui.bar.addClass("coach-waiting");
                self._focusBar();
            }
            if (step.highlight) self._applyHighlight(step.highlight);
            if (last && self.sprite) self.sprite.celebrate();
        });
        this._reposition();
        if (step.button) this._focusBar();
    };

    // --------------------------------------------------------- typewriter

    // Print the step's HTML character by character, preserving markup: the
    // full HTML is set, then every text node is emptied and refilled one
    // character at a time. The sprite's carriage tracks the virtual column.
    Coach.prototype._typeText = function (html, done) {
        clearInterval(this._typeTimer);
        this._typeTimer = null;
        var el = this._ui.text[0];
        this._ui.text.html(html);
        el.scrollTop = 0; // fresh step starts at the top of the pane
        var nodes = [];
        var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
        var n;
        while ((n = walker.nextNode())) nodes.push({ node: n, full: n.nodeValue });
        nodes.forEach(function (t) {
            t.node.nodeValue = "";
        });
        this._typeState = { nodes: nodes, i: 0, pos: 0, col: 0, done: done };
        if (!nodes.length) return done();
        if (this.sprite) this.sprite.startTyping();
        var self = this;
        this._typeTimer = setInterval(function () {
            self._typeTick();
        }, TYPE_MS);
    };

    Coach.prototype._typeTick = function () {
        var st = this._typeState;
        var cur = st.nodes[st.i];
        if (!cur) return this._finishTyping();
        var ch = cur.full.charAt(st.pos);
        cur.node.nodeValue += ch;
        st.pos++;
        // the pane is fixed-height: follow the print head as it fills
        var pane = this._ui.text[0];
        if (pane.scrollHeight > pane.clientHeight) pane.scrollTop = pane.scrollHeight;
        if (st.pos >= cur.full.length) {
            st.i++;
            st.pos = 0;
        }
        if (/\s/.test(ch) && st.col > TYPE_LINE - 8) {
            st.col = 0; // wrap at a space near the margin: carriage return
            if (this.sprite) this.sprite.typeChar(0, true);
        } else {
            st.col++;
            if (this.sprite) this.sprite.typeChar(Math.min(1, st.col / TYPE_LINE), false);
        }
        if (st.i >= st.nodes.length) this._finishTyping();
    };

    Coach.prototype._finishTyping = function () {
        clearInterval(this._typeTimer);
        this._typeTimer = null;
        var st = this._typeState;
        if (!st) return;
        this._typeState = null;
        st.nodes.forEach(function (t) {
            t.node.nodeValue = t.full;
        });
        var pane = this._ui && this._ui.text[0];
        if (pane && pane.scrollHeight > pane.clientHeight) pane.scrollTop = pane.scrollHeight;
        if (this.sprite) this.sprite.endTyping();
        if (st.done) st.done();
    };

    // Move document focus to the coach bar (out of any app iframe) without a
    // visible ring -- #coach-bar is tabindex -1 with outline:none.
    Coach.prototype._focusBar = function () {
        if (this._ui && this._ui.bar[0]) {
            try {
                this._ui.bar[0].focus({ preventScroll: true });
            } catch (e) {
                this._ui.bar[0].focus();
            }
        }
    };

    // ------------------------------------------------------- highlights

    Coach.prototype._applyHighlight = function (spec) {
        this._curSpec = spec;
        var self = this;
        if (spec.dashboard) {
            $(spec.dashboard).addClass("coach-highlight");
        }
        if (spec.app) {
            // The app may still be loading (or get relaunched) while this
            // step is active: retry until the elements exist, then play the
            // zoom-in frame (its union rect includes any dashboard targets).
            var tries = 0;
            var attempt = function () {
                if (!self.lesson) return;
                if (self._highlightInApp(spec.app)) {
                    self._revealAndZoom();
                } else if (tries++ < 20) {
                    self._hlTimer = setTimeout(attempt, 400);
                } else if (spec.dashboard) {
                    self._revealAndZoom(); // app target never appeared; show what we have
                }
            };
            attempt();
        } else {
            this._revealAndZoom();
        }
    };

    // Gracefully bring an off-screen target into view before spotlighting
    // it: smooth-scroll the first highlighted element (app iframes are
    // same-origin, so scrollIntoView inside them works), then play the zoom
    // once the scroll has settled.
    Coach.prototype._revealAndZoom = function () {
        var spec = this._curSpec || {};
        var scrolled = false;
        var reveal = function (el, vh) {
            var r = el.getBoundingClientRect();
            if (r.top >= 0 && r.bottom <= vh) return false;
            try {
                el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
            } catch (e) {
                el.scrollIntoView();
            }
            return true;
        };
        try {
            if (spec.app) {
                var iframe = document.getElementById("app-iframe");
                var doc = iframe && iframe.contentDocument;
                var target = doc && doc.querySelector(spec.app);
                if (target) scrolled = reveal(target, iframe.contentWindow.innerHeight);
            }
            if (spec.dashboard && $(spec.dashboard)[0]) {
                scrolled = reveal($(spec.dashboard)[0], window.innerHeight) || scrolled;
            }
        } catch (e) {
            /* cross-origin app: zoom to whatever is visible */
        }
        var self = this;
        if (scrolled) {
            setTimeout(function () {
                self._playZoom();
            }, 480);
        } else {
            this._playZoom();
        }
    };

    // Fixed-viewport rects for every current highlight target; app-iframe
    // elements are translated through the iframe's own offset.
    Coach.prototype._targetRects = function () {
        var spec = this._curSpec || {};
        var rects = [];
        if (spec.dashboard) {
            $(spec.dashboard).each(function () {
                var r = this.getBoundingClientRect();
                if (r.width || r.height) rects.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
            });
        }
        if (spec.app) {
            var iframe = document.getElementById("app-iframe");
            try {
                var doc = iframe && iframe.contentDocument;
                if (doc) {
                    var ir = iframe.getBoundingClientRect();
                    var els = doc.querySelectorAll(spec.app);
                    for (var i = 0; i < els.length; i++) {
                        var r = els[i].getBoundingClientRect();
                        if (r.width || r.height) {
                            rects.push({
                                left: r.left + ir.left,
                                top: r.top + ir.top,
                                right: r.right + ir.left,
                                bottom: r.bottom + ir.top,
                            });
                        }
                    }
                }
            } catch (e) {
                /* cross-origin app */
            }
        }
        return rects;
    };

    // A frame sweeps in from the screen boundary and settles on the
    // target(s); the shadow outside it dims everything else on the way in.
    // The coach's eyes follow it to the target.
    Coach.prototype._playZoom = function () {
        var rects = this._targetRects();
        if (!rects.length) return;
        var u = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
        rects.forEach(function (r) {
            u.left = Math.min(u.left, r.left);
            u.top = Math.min(u.top, r.top);
            u.right = Math.max(u.right, r.right);
            u.bottom = Math.max(u.bottom, r.bottom);
        });
        var pad = 6;
        $("#coach-zoom").remove();
        var box = $('<div id="coach-zoom"></div>').appendTo("body");
        box.css({ left: 0, top: 0, width: window.innerWidth + "px", height: window.innerHeight + "px" });
        box[0].getBoundingClientRect(); // commit the start frame before transitioning
        box.addClass("coach-zoom-run");
        box.css({
            left: u.left - pad + "px",
            top: u.top - pad + "px",
            width: u.right - u.left + 2 * pad + "px",
            height: u.bottom - u.top + 2 * pad + "px",
        });
        if (this.sprite) this.sprite.lookAt((u.left + u.right) / 2, (u.top + u.bottom) / 2);
        setTimeout(function () {
            box.addClass("coach-zoom-done");
        }, 750);
        setTimeout(function () {
            box.remove();
        }, 1300);
    };

    Coach.prototype._highlightInApp = function (selector) {
        var iframe = document.getElementById("app-iframe");
        try {
            var doc = iframe && iframe.contentDocument;
            if (!doc || !doc.body) return false;
            if (!doc.getElementById("coach-style")) {
                var style = doc.createElement("style");
                style.id = "coach-style";
                style.textContent = HIGHLIGHT_CSS;
                (doc.head || doc.documentElement).appendChild(style);
            }
            var els = doc.querySelectorAll(selector);
            if (!els.length) return false;
            for (var i = 0; i < els.length; i++) els[i].classList.add("coach-highlight");
            return true;
        } catch (e) {
            return false; // cross-origin app: no highlight, lesson still works
        }
    };

    Coach.prototype._clearHighlights = function () {
        clearTimeout(this._hlTimer);
        this._curSpec = null;
        $("#coach-zoom").remove();
        $(".coach-input-pop").removeClass("coach-input-pop");
        $(".coach-highlight").removeClass("coach-highlight");
        var iframe = document.getElementById("app-iframe");
        try {
            var doc = iframe && iframe.contentDocument;
            if (doc) {
                var els = doc.querySelectorAll(".coach-highlight");
                for (var i = 0; i < els.length; i++) els[i].classList.remove("coach-highlight");
            }
        } catch (e) {
            /* cross-origin app */
        }
    };

    // ----------------------------------------------------------- layout

    // Keep the rail's and arena's bottom clear of the run-control footer
    // (.footBar animates its height between 0 and open over 0.3s --
    // re-measure after the transition settles too), and hug the arena's left
    // edge to the left nav (collapsed or expanded; on phone widths the nav
    // is translated off-canvas, so clamp at 0).
    Coach.prototype._reposition = function () {
        if (!this._ui) return;
        var self = this;
        var set = function () {
            if (!self._ui) return;
            var foot = $(".footBar").height() || 0;
            self._ui.rail.css("bottom", foot + "px");
            var nav = document.getElementById("left-menu");
            var left = nav ? Math.max(0, nav.getBoundingClientRect().right) : 0;
            self._ui.arena.css({ bottom: foot + "px", left: left + "px" });
            self._fitArena();
        };
        set();
        clearTimeout(this._footTimer);
        this._footTimer = setTimeout(set, 400);
    };

    // Size the arena stage's canvas to the largest integer pixel multiple
    // that fits beside the keypad (integer scales keep the pixel art crisp).
    Coach.prototype._fitArena = function () {
        if (!this._ui || !this._ui.arena.hasClass("visible")) return;
        var arena = this._ui.arena[0];
        var cs = window.getComputedStyle(arena);
        var availW = arena.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        var availH = arena.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
        if (this._keypad && this._keypad.visible) {
            availW -= this._keypad.el.offsetWidth + parseFloat(cs.columnGap || 24);
        }
        this.machine.fitTo(availW, availH);
    };

    // The lesson chrome is a docked right rail -- the dialog, with a slot
    // for the small sim-machine stage below -- sized to match the pop-out
    // DRO, and the app area shifts left to sit beside it, so the coach never
    // covers the controls it's teaching. The arena is a separate takeover
    // surface spanning the app area for steps that don't need the app:
    // watching a file run, or driving the sim with the practice keypad.
    Coach.prototype._buildUI = function () {
        $("body").addClass("fabmo-training");
        var banner = $(
            '<div id="coach-banner"><span class="coach-banner-text">TRAINING MODE &mdash; the machine will not move</span>' +
                '<button id="coach-exit">Exit Training</button></div>'
        );
        var rail = $('<div id="coach-rail"></div>');
        var bar = $(
            '<div id="coach-bar" tabindex="-1">' +
                '<div class="coach-sprite-box"></div>' +
                '<div class="coach-content">' +
                '<div class="coach-title"></div>' +
                '<div class="coach-text"></div>' +
                '<div class="coach-footer"><span class="coach-dots"></span>' +
                '<span class="coach-btns">' +
                '<button class="coach-show">&#8982; Highlight</button>' +
                '<button class="coach-next"></button></span></div>' +
                "</div></div>"
        );
        var stageSlot = $('<div class="coach-stage-slot"></div>');
        rail.append(bar).append(stageSlot);
        var arena = $('<div id="coach-arena"></div>');
        var arenaSlot = $('<div class="coach-arena-slot"></div>');
        arena.append(arenaSlot);
        this._keypad = new CoachKeypad(this.engine);
        this._keypad.attach(arena[0]);
        $("body").append(banner).append(rail).append(arena);
        bar.find(".coach-title").text(this.lesson.title);
        banner.find("#coach-exit").on("click", this.exit.bind(this));
        var next = bar.find(".coach-next").on("click", this._advance.bind(this));
        var show = bar.find(".coach-show").on("click", this._revealAndZoom.bind(this));
        // Clicking the dialog text fast-forwards the typewriter.
        var self = this;
        bar.find(".coach-content").on("mousedown", function () {
            if (self._typeTimer) self._finishTyping();
        });
        this.sprite = new CoachSprite();
        this.sprite.attach(bar.find(".coach-sprite-box")[0]);
        this._ui = {
            banner: banner,
            rail: rail,
            stageSlot: stageSlot,
            arena: arena,
            arenaSlot: arenaSlot,
            bar: bar,
            text: bar.find(".coach-text"),
            dots: bar.find(".coach-dots"),
            next: next,
            show: show,
        };
    };

    return Coach;
});
