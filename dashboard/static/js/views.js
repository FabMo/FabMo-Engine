/* eslint-disable no-unused-vars */
/* eslint-disable no-undef */
define(function (require) {
    var models = require("./models.js");
    var Backbone = require("backbone");
    var auth = require("./auth.js");
    var _ = require("underscore");
    var a11y = require("./a11y.js");
    var views = {};

    // How long an app may take to finish loading before it is shown anyway
    // (see AppClientView.render).
    var APP_LOAD_GRACE_MS = 4000; // shown from here on, once its page is parsed
    var APP_LOAD_CAP_MS = 15000; // shown from here on, regardless

    views.Authentication = Backbone.View.extend({
        el: "#mainContent",
        template: _.template(require("text-loader!./templates/authentication.html")),
        initialize: function () {
            this.render();
        },
        render: function () {
            $(this.el).html(this.template());
            return this;
        },
    });

    views.AppClientView = Backbone.View.extend({
        tagName: "div",
        className: "app",
        model: new models.App(),
        initialize: function (options) {
            this.is_visible = false;
            this.iframe = null;
            this.hard_refresh = false;
            _.bindAll(this, "render");
        },
        render: function (hard_refresh, callback) {
            var url = this.model.get("app_url") || "about:blank";
            var client_container = jQuery(this.el);
            ////##			var src = '<iframe class="app-iframe" id="app-iframe" sandbox="allow-scripts allow-same-origin" allowfullscreen></iframe>'
            // allowfullscreen is correctly written here
            var src =
                '<iframe class="app-iframe" id="app-iframe" sandbox="allow-scripts allow-same-origin allow-downloads allow-popups" allowfullscreen></iframe>';
            client_container.html(src);
            this.iframe = $(client_container.children()[0]);
            // Disable double-tap-zoom on the iframe region without blocking touch
            // forwarding to the iframe content (touch-action:none breaks OrbitControls).
            this.iframe[0].style.touchAction = "manipulation";
            // Accessibility overrides live in the app document and die
            // with each navigation — re-inject on every (re)load.
            this.iframe.on(
                "load",
                function () {
                    a11y.applyToIframe(this.iframe[0]);
                }.bind(this),
            );
            // The launch gear comes down when the app document fires "load",
            // which waits for every script, stylesheet and image. On a poor
            // connection one stalled request used to leave the gear up for
            // good. So the load is watched: once the grace period has passed
            // the app is shown as soon as its page has been parsed and its
            // scripts have run (only images and the like still pending), and
            // after the cap it is shown whatever state it is in.
            clearInterval(this.loadWatch);
            var iframe = this.iframe;
            var started = Date.now();
            var done = false;
            var finish = function () {
                if (done) return;
                done = true;
                clearInterval(this.loadWatch);
                callback();
            }.bind(this);
            this.loadWatch = setInterval(
                function () {
                    var waited = Date.now() - started;
                    if (waited < APP_LOAD_GRACE_MS) return;
                    var parsed = false;
                    try {
                        var doc = iframe[0].contentDocument;
                        // The iframe starts on a blank document that is
                        // already "complete"; only the app's own counts.
                        parsed = !!doc && doc.location.href !== "about:blank" && doc.readyState !== "loading";
                    } catch (e) {
                        /* document not reachable yet: keep waiting */
                    }
                    if (parsed || waited >= APP_LOAD_CAP_MS) {
                        console.warn("App still loading after " + Math.round(waited / 1000) + "s; showing it anyway.");
                        // "load" has not fired, so its handler has not run
                        try {
                            a11y.applyToIframe(iframe[0]);
                        } catch (e) {
                            console.warn(e);
                        }
                        finish();
                    }
                }.bind(this),
                500,
            );
            if (hard_refresh) {
                this.iframe.one(
                    "load",
                    function () {
                        // Shown early already: reloading now would yank the
                        // app out from under the user. Files are revalidated
                        // on every load anyway, so skipping this is safe.
                        if (done) return;
                        this.hardRefresh(finish);
                    }.bind(this),
                );
            } else {
                this.iframe.one("load", finish);
            }
            this.iframe.attr("src", url);
        },
        hardRefresh: function (callback) {
            this.iframe.one("load", function () {
                callback();
            });
            this.iframe[0].contentWindow.location.reload(true);
        },
        show: function () {
            $(this.el).css("visibility", "visible");
            this.is_visible = true;
        },
        hide: function (arg) {
            $(this.el).css("visibility", "hidden");
            this.is_visible = false;
        },
        setModel: function (model, hard_refresh, callback) {
            if (model) {
                this.hard_refresh = hard_refresh;
                this.model.set(model.toJSON());
            } else {
                this.model.clear();
            }
            this.render(hard_refresh, callback);
        },
    });

    return views;
});
