/*
 * coach.js is the Training Mode lesson runner. It owns the simulated
 * machine (fabmosim behind FabMoAPI's transports), the TRAINING banner, and
 * the step-by-step instruction bar. Lessons live in lessons.json as
 * declarative steps; they advance by observing what the user's clicks send
 * through the API bridge -- the coached apps are the real, unmodified
 * dashboard apps. Steps can highlight elements in the dashboard chrome or
 * inside the current app's iframe (same-origin injection, like a11y).
 */
define(function (require) {
    "use strict";

    var $ = require("jquery");
    var SimMachine = require("./libs/fabmosim.js");
    var LESSONS = require("./lessons.json");

    // Injected into app iframes for app-side highlights; dashboard-side
    // highlights use the same rules from style.css.
    var HIGHLIGHT_CSS =
        ".coach-highlight{outline:3px solid #d9a420 !important;outline-offset:2px;" +
        "border-radius:4px;animation:coach-pulse 1.2s ease-in-out infinite;}" +
        "@keyframes coach-pulse{0%,100%{outline-color:#d9a420;}50%{outline-color:rgba(217,164,32,0.25);}}";

    // watch specs from lessons.json -> predicate over sim actions
    function compileWatch(spec) {
        if (!spec) return null;
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
            return function (a) {
                return a.type === "manual" && a.cmd === spec.cmd;
            };
        }
        return function () {
            return false;
        };
    }

    function Coach(engine, context) {
        this.engine = engine;
        this.context = context;
        this.sim = new SimMachine(engine);
        this.sim.onAction(this._onAction.bind(this));
        this.lesson = null;
        this.stepIndex = 0;
        this._ui = null;
        this._hlTimer = null;
        // Registered once; inert outside a lesson (FabMoAPI has no off()).
        var self = this;
        this.engine.on("status", function () {
            if (self.lesson) self._reposition();
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
        // The lesson happens in the real Console app.
        this.context.launchApp("fabmo-sb4", {}, function () {});
        callback(null);
    };

    Coach.prototype.exit = function () {
        if (!this.lesson) return;
        this.lesson = null;
        this._clearHighlights();
        this.sim.exit();
        if (this._ui) {
            this._ui.banner.remove();
            this._ui.bar.remove();
            this._ui = null;
        }
        $(window).off("resize.coach");
        $("body").removeClass("fabmo-training");
    };

    Coach.prototype._onAction = function (action) {
        if (!this.lesson) return;
        var step = this.lesson.steps[this.stepIndex];
        if (step && step._watch === undefined) step._watch = compileWatch(step.watch);
        if (step && step._watch && step._watch(action)) {
            this.stepIndex++;
            this._showStep();
        }
    };

    Coach.prototype._advance = function () {
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
        this._ui.text.html(step.text);
        this._ui.next.toggle(!!step.button).text(step.button || "");
        var dots = "";
        for (var i = 0; i < steps.length; i++) {
            dots += '<span class="coach-dot' + (i === this.stepIndex ? " active" : i < this.stepIndex ? " done" : "") + '"></span>';
        }
        this._ui.dots.html(dots);
        this._clearHighlights();
        if (step.highlight) this._applyHighlight(step.highlight);
        this._reposition();
    };

    // ------------------------------------------------------- highlights

    Coach.prototype._applyHighlight = function (spec) {
        if (spec.dashboard) {
            $(spec.dashboard).addClass("coach-highlight");
        }
        if (spec.app) {
            // The app may still be loading (or get relaunched) while this
            // step is active: retry until the elements exist.
            var tries = 0;
            var self = this;
            var attempt = function () {
                if (!self.lesson) return;
                if (!self._highlightInApp(spec.app) && tries++ < 20) {
                    self._hlTimer = setTimeout(attempt, 400);
                }
            };
            attempt();
        }
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

    // Keep the instruction card above the run-control footer (.footBar
    // animates its height between 0 and open over 0.3s -- re-measure after
    // the transition settles too).
    Coach.prototype._reposition = function () {
        if (!this._ui) return;
        var self = this;
        var set = function () {
            if (!self._ui) return;
            var foot = $(".footBar").height() || 0;
            self._ui.bar.css("bottom", foot + 14 + "px");
        };
        set();
        clearTimeout(this._footTimer);
        this._footTimer = setTimeout(set, 400);
    };

    Coach.prototype._buildUI = function () {
        $("body").addClass("fabmo-training");
        var banner = $(
            '<div id="coach-banner"><span class="coach-banner-text">TRAINING MODE &mdash; the machine will not move</span>' +
                '<button id="coach-exit">Exit Training</button></div>'
        );
        var bar = $(
            '<div id="coach-bar">' +
                '<div class="coach-title"></div>' +
                '<div class="coach-text"></div>' +
                '<div class="coach-footer"><span class="coach-dots"></span>' +
                '<button class="coach-next"></button></div>' +
                "</div>"
        );
        $("body").append(banner).append(bar);
        bar.find(".coach-title").text(this.lesson.title);
        banner.find("#coach-exit").on("click", this.exit.bind(this));
        var next = bar.find(".coach-next").on("click", this._advance.bind(this));
        this._ui = {
            banner: banner,
            bar: bar,
            text: bar.find(".coach-text"),
            dots: bar.find(".coach-dots"),
            next: next,
        };
    };

    return Coach;
});
