/*
 * coach.js is the Training Mode lesson runner. It owns the simulated
 * machine (fabmosim behind FabMoAPI's transports), the TRAINING banner, and
 * the step-by-step instruction bar. Lessons advance by observing what the
 * user's clicks send through the API bridge -- the coached apps are the
 * real, unmodified dashboard apps.
 */
define(function (require) {
    "use strict";

    var $ = require("jquery");
    var SimMachine = require("./libs/fabmosim.js");

    // A step is {text, watch} -- watch(action) returns true to advance --
    // or {text, button} for read-and-continue steps.
    var LESSONS = {
        "home-and-zero": {
            title: "Home the machine & zero the Z axis",
            steps: [
                {
                    text:
                        "<b>Welcome to Training Mode.</b> The machine will <b>not</b> move — " +
                        "every control is live, but a simulated tool answers instead of the real one. " +
                        "We'll practice the startup routine every job begins with: homing, then zeroing the Z axis.",
                    button: "Begin",
                },
                {
                    text:
                        "First, the machine needs to find its fixed home position. " +
                        "In the Console's <b>Machine</b> card, press <b>Home&nbsp;XY</b>.",
                    watch: function (a) {
                        return a.type === "code" && /(^|\b)(C#?,?\s*3|MH)\b/i.test(a.code);
                    },
                },
                {
                    text:
                        "Watch the position readout: the tool drives toward each proximity switch, " +
                        "backs off, and creeps back in slowly for an exact reading — first X, then Y.",
                    watch: function (a) {
                        return a.type === "sequence" && a.name === "home";
                    },
                },
                {
                    text:
                        "The DRO now reads <b>X 0.00&nbsp;&nbsp;Y 0.00</b> — the machine knows where it is. " +
                        "Next: the Z axis is zeroed to the <b>top of your material</b> using the metal touch plate. " +
                        "On a real machine you'd rest the plate under the bit now. Press <b>Home&nbsp;Z</b>.",
                    watch: function (a) {
                        return a.type === "code" && /(^|\b)C#?,?\s*2\b/i.test(a.code);
                    },
                },
                {
                    text:
                        "The bit finds the plate twice — a fast touch, then a slow one for accuracy — " +
                        "and Z is set from the plate's known thickness before retracting to a safe height.",
                    watch: function (a) {
                        return a.type === "sequence" && a.name === "zeroz";
                    },
                },
                {
                    text:
                        "<b>That's the whole startup routine.</b> Home XY once per session, zero the Z " +
                        "whenever the bit or material changes. This is exactly what you'll do on the real " +
                        "machine — the only difference is that it moves.",
                    button: "Finish",
                },
            ],
        },
    };

    function Coach(engine, context) {
        this.engine = engine;
        this.context = context;
        this.sim = new SimMachine(engine);
        this.sim.onAction(this._onAction.bind(this));
        this.lesson = null;
        this.stepIndex = 0;
        this._ui = null;
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
        // The lesson happens in the real Console app.
        this.context.launchApp("fabmo-sb4", {}, function () {});
        callback(null);
    };

    Coach.prototype.exit = function () {
        if (!this.lesson) return;
        this.lesson = null;
        this.sim.exit();
        if (this._ui) {
            this._ui.banner.remove();
            this._ui.bar.remove();
            this._ui = null;
        }
        $("body").removeClass("fabmo-training");
    };

    Coach.prototype._onAction = function (action) {
        if (!this.lesson) return;
        var step = this.lesson.steps[this.stepIndex];
        if (step && step.watch && step.watch(action)) {
            this.stepIndex++;
            this._showStep();
        }
    };

    Coach.prototype._advance = function () {
        this.stepIndex++;
        if (this.stepIndex >= this.lesson.steps.length) {
            this.exit();
        } else {
            this._showStep();
        }
    };

    Coach.prototype._showStep = function () {
        if (!this._ui) return;
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
    };

    Coach.prototype._buildUI = function () {
        $("body").addClass("fabmo-training");
        var banner = $(
            '<div id="coach-banner">TRAINING MODE &mdash; the machine will not move' +
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
