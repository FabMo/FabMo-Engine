/* eslint-disable no-undef */
/*
 * a11y.js
 * Accessibility mode for the dashboard: larger text + high contrast,
 * toggled from the nav bar ("aA") or the sidebar, persisted per-device
 * in localStorage.
 *
 * App content is scaled by a zoom stylesheet injected into the app
 * iframe document. Apps are same-origin (served from /approot on this
 * host), so the injection covers user-installed apps with no
 * cooperation from the app; CSS zoom reflows cleanly where font-size
 * overrides would break fixed-height layouts. High contrast is a
 * filter on the iframe ELEMENT (style.css), so app internals are never
 * touched. Dashboard chrome rules key off the .fabmo-a11y root class.
 */
define(function (require) {
    var toastr = require("./libs/toastr.min");

    var STORAGE_KEY = "fabmo_a11y";
    var STYLE_ID = "fabmo-a11y-style";
    // Whole-layout scale for app content.
    var APP_ZOOM = 1.3;

    function isEnabled() {
        try {
            var v = window.localStorage.getItem(STORAGE_KEY);
            // "large"/"large-cb" were stored by the short-lived
            // mode-cycle experiment — treat them as on.
            return v === "1" || (!!v && v.indexOf("large") === 0);
        } catch (e) {
            return false;
        }
    }

    function setEnabled(on) {
        try {
            if (on) window.localStorage.setItem(STORAGE_KEY, "1");
            else window.localStorage.removeItem(STORAGE_KEY);
        } catch (e) {
            // Private mode etc. — still applies, just won't persist.
        }
        apply();
    }

    function toggle() {
        setEnabled(!isEnabled());
        var key = "status.a11y." + (isEnabled() ? "on" : "off");
        var msg = typeof window.t === "function" ? window.t(key) : key;
        toastr.info(msg, "", { timeOut: 2500, positionClass: "toast-top-center" });
    }

    // Inject (or remove) the zoom stylesheet in an app iframe. The
    // injected sheet dies with each app navigation, so this must be
    // re-run on every iframe load (views.AppClientView hooks that).
    function applyToIframe(iframe) {
        if (!iframe) return;
        try {
            var doc = iframe.contentDocument;
            if (!doc) return;
            var style = doc.getElementById(STYLE_ID);
            if (isEnabled()) {
                if (style) return;
                style = doc.createElement("style");
                style.id = STYLE_ID;
                style.textContent = "html { zoom: " + APP_ZOOM + "; }";
                (doc.head || doc.documentElement).appendChild(style);
            } else if (style && style.parentNode) {
                style.parentNode.removeChild(style);
            }
        } catch (e) {
            // Cross-origin content — leave it alone.
        }
    }

    // Bring the dashboard chrome and the currently-loaded app in line
    // with the stored setting.
    function apply() {
        var on = isEnabled();
        document.documentElement.classList.toggle("fabmo-a11y", on);
        $(".icon_a11y").toggleClass("a11y-on", on);
        applyToIframe(document.getElementById("app-iframe"));
        // The side DRO panel zooms 1.2x in this mode. If it is pinned
        // open (push mode pads the app aside — see events.js), re-pad
        // for the new effective panel width.
        var $app = $("#app-client-container");
        if (parseInt($app.css("padding-right"), 10) > 0) {
            var scale = on ? 1.2 : 1;
            $app.css("padding-right", Math.round(218 * scale) + "px");
            $("#app_menu_container, #waiting_container").css(
                "padding-right",
                Math.round(220 * scale) + "px"
            );
        }
    }

    return {
        isEnabled: isEnabled,
        setEnabled: setEnabled,
        toggle: toggle,
        apply: apply,
        applyToIframe: applyToIframe,
    };
});
