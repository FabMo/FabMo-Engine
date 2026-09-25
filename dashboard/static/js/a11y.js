/* eslint-disable no-undef */
/*
 * a11y.js
 * Accessibility modes for the dashboard, cycled by the sidebar button:
 *
 *   off -> large -> large-cb -> cb -> off
 *
 * "large"  — larger text + high contrast. App content is scaled by a
 *            zoom stylesheet injected into the app iframe document
 *            (same-origin, so user-installed apps are covered with no
 *            cooperation; CSS zoom reflows cleanly where font-size
 *            overrides would break fixed-height layouts). Contrast is
 *            a filter on the iframe ELEMENT (style.css), so app
 *            internals are never touched.
 *   "cb"    — colorblind-safe. Dashboard chrome swaps its red/green
 *            semantics to a blue/orange axis (style.css); apps get a
 *            saturation boost on the frame filter, which helps hue
 *            separation but is honest best-effort — real support in
 *            system apps means native palettes (follow-on).
 *
 * The selected mode persists per-device in localStorage.
 */
define(function (require) {
    var toastr = require("./libs/toastr.min");

    var STORAGE_KEY = "fabmo_a11y";
    var STYLE_ID = "fabmo-a11y-style";
    // Whole-layout scale for app content in "large" modes.
    var APP_ZOOM = 1.3;
    // Cycle order: everything-on sits next to large so the common case
    // (older user who wants both) is two presses, not three.
    var MODES = ["off", "large", "large-cb", "cb"];

    function getMode() {
        var m;
        try {
            m = window.localStorage.getItem(STORAGE_KEY);
        } catch (e) {
            return "off";
        }
        if (m === "1") return "large"; // pre-cycle PoC value
        return MODES.indexOf(m) > 0 ? m : "off";
    }

    function isLarge() {
        return getMode().indexOf("large") === 0;
    }

    function isColorblind() {
        return getMode().indexOf("cb") !== -1;
    }

    // events.js uses this to scale the side-DRO push padding, which
    // only matters when the panel is zoomed — i.e. in "large" modes.
    function isEnabled() {
        return isLarge();
    }

    function setMode(mode) {
        if (MODES.indexOf(mode) === -1) mode = "off";
        try {
            if (mode === "off") window.localStorage.removeItem(STORAGE_KEY);
            else window.localStorage.setItem(STORAGE_KEY, mode);
        } catch (e) {
            // Private mode etc. — still applies, just won't persist.
        }
        apply();
    }

    function announce() {
        var key = "status.a11y.mode_" + getMode().replace("-", "_");
        var msg = typeof window.t === "function" ? window.t(key) : key;
        toastr.info(msg, "", { timeOut: 2500, positionClass: "toast-top-center" });
    }

    function cycle() {
        setMode(MODES[(MODES.indexOf(getMode()) + 1) % MODES.length]);
        announce();
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
            if (isLarge()) {
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
    // with the stored mode.
    function apply() {
        var large = isLarge();
        var cb = isColorblind();
        document.documentElement.classList.toggle("fabmo-a11y", large);
        document.documentElement.classList.toggle("fabmo-a11y-cb", cb);
        $(".icon_a11y").toggleClass("a11y-on", large || cb);
        applyToIframe(document.getElementById("app-iframe"));
        // The side DRO panel zooms 1.2x in "large" modes. If it is
        // pinned open (push mode pads the app aside — see events.js),
        // re-pad for the new effective panel width.
        var $app = $("#app-client-container");
        if (parseInt($app.css("padding-right"), 10) > 0) {
            var scale = large ? 1.2 : 1;
            $app.css("padding-right", Math.round(218 * scale) + "px");
            $("#app_menu_container, #waiting_container").css(
                "padding-right",
                Math.round(220 * scale) + "px"
            );
        }
    }

    return {
        getMode: getMode,
        setMode: setMode,
        cycle: cycle,
        isEnabled: isEnabled,
        isLarge: isLarge,
        isColorblind: isColorblind,
        apply: apply,
        applyToIframe: applyToIframe,
    };
});
