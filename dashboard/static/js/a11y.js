/* eslint-disable no-undef */
/*
 * a11y.js
 * Accessibility ("larger text / high contrast") mode for the dashboard.
 *
 * PoC scope: a per-device toggle (localStorage) that
 *   - tags the dashboard root with .fabmo-a11y (chrome rules in style.css)
 *   - injects a zoom stylesheet into the app iframe document
 *
 * Apps are same-origin (served from /approot on this host), so the
 * injection works for user-installed apps as well as system apps. The
 * injected sheet scales the whole app layout with CSS zoom, which
 * reflows cleanly on arbitrary apps where font-size overrides would
 * break fixed-height layouts. High contrast is applied from the
 * dashboard side as a filter on the iframe element (style.css), so app
 * internals are never touched for it.
 */
define(function (require) {
    var STORAGE_KEY = "fabmo_a11y";
    var STYLE_ID = "fabmo-a11y-style";
    // Whole-layout scale for app content.
    var APP_ZOOM = 1.3;

    function isEnabled() {
        try {
            return window.localStorage.getItem(STORAGE_KEY) === "1";
        } catch (e) {
            return false;
        }
    }

    function setEnabled(on) {
        try {
            if (on) window.localStorage.setItem(STORAGE_KEY, "1");
            else window.localStorage.removeItem(STORAGE_KEY);
        } catch (e) {
            // Private mode etc. — the mode still applies, just won't persist.
        }
        apply();
    }

    function toggle() {
        setEnabled(!isEnabled());
    }

    // Inject (or remove) the override stylesheet in an app iframe.
    // The injected sheet dies with each app navigation, so this must be
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
    }

    return {
        isEnabled: isEnabled,
        setEnabled: setEnabled,
        toggle: toggle,
        apply: apply,
        applyToIframe: applyToIframe,
    };
});
