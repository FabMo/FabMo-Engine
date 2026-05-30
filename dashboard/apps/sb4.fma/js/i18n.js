/*
 * Client-side i18n.
 *
 * Exposes window.t(key, vars) and window.i18nReady (a promise).
 * Fetches /i18n/languages to learn the active language code, then
 * /i18n/dict/<code> for the dictionary. English is also loaded as
 * the fallback dict so missing keys in the target language still
 * render English text instead of the raw key.
 *
 * Lookup:
 *   t("keypad.go_to")             → "Go To"
 *   t("toolbox.cut_summary", {d:0.5}) → "Bored 0.500" hole"
 *
 * If the key is missing in both dicts, returns the key itself so the
 * developer sees a glaring "keypad.go_to" instead of an empty span —
 * makes untranslated strings easy to spot in QA.
 */
(function (global) {
    var activeDict = {};
    var fallbackDict = {};
    var currentLang = "en";

    function lookup(dict, key) {
        if (!dict || typeof key !== "string") return undefined;
        var parts = key.split(".");
        var cur = dict;
        for (var i = 0; i < parts.length; i++) {
            if (cur === null || typeof cur !== "object") return undefined;
            cur = cur[parts[i]];
        }
        return typeof cur === "string" ? cur : undefined;
    }

    function substitute(template, vars) {
        if (!vars || typeof template !== "string") return template;
        return template.replace(/\{(\w+)\}/g, function (m, name) {
            return vars[name] !== undefined ? String(vars[name]) : m;
        });
    }

    function t(key, vars) {
        var value = lookup(activeDict, key);
        if (value === undefined && currentLang !== "en") {
            value = lookup(fallbackDict, key);
        }
        if (value === undefined) value = key;
        return substitute(value, vars);
    }

    function fetchJSON(url) {
        return new Promise(function (resolve, reject) {
            var x = new XMLHttpRequest();
            x.open("GET", url, true);
            x.onload = function () {
                if (x.status >= 200 && x.status < 300) {
                    try { resolve(JSON.parse(x.responseText)); }
                    catch (e) { reject(e); }
                } else {
                    reject(new Error("HTTP " + x.status));
                }
            };
            x.onerror = function () { reject(new Error("network")); };
            x.send();
        });
    }

    global.i18nReady = fetchJSON("/i18n/languages").then(function (info) {
        currentLang = info.current || "en";
        var jobs = [fetchJSON("/i18n/dict/" + currentLang).then(function (d) {
            activeDict = d || {};
        })];
        if (currentLang !== "en") {
            jobs.push(fetchJSON("/i18n/dict/en").then(function (d) {
                fallbackDict = d || {};
            }));
        }
        return Promise.all(jobs);
    }).catch(function (e) {
        if (typeof console !== "undefined" && console.warn) {
            console.warn("i18n init failed:", e);
        }
    });

    // DOM walker — applies translations to elements that opt in via
    // attributes. Authors mark HTML once and the walker keeps it in
    // sync after every dict reload / language change:
    //
    //   <span data-i18n="keypad.go_to">Go To</span>
    //     → textContent replaced by t("keypad.go_to")
    //
    //   <button data-i18n-title="keypad.go_to_tooltip" title="Move to…">…</button>
    //     → title attribute replaced
    //
    //   <input data-i18n-placeholder="keypad.feed_placeholder" placeholder="…">
    //     → placeholder attribute replaced
    //
    // English text in the HTML stays as the no-JS / pre-fetch fallback,
    // so untranslated UI never flashes a raw key.
    function applyDomTranslations(root) {
        root = root || document;
        var els = root.querySelectorAll("[data-i18n]");
        for (var i = 0; i < els.length; i++) {
            var k = els[i].getAttribute("data-i18n");
            if (k) els[i].textContent = t(k);
        }
        var attrs = [
            ["data-i18n-title",       "title"],
            ["data-i18n-placeholder", "placeholder"],
            ["data-i18n-aria-label",  "aria-label"],
            ["data-i18n-value",       "value"],
        ];
        for (var a = 0; a < attrs.length; a++) {
            var sel = "[" + attrs[a][0] + "]";
            var attr = attrs[a][1];
            var nodes = root.querySelectorAll(sel);
            for (var n = 0; n < nodes.length; n++) {
                var key = nodes[n].getAttribute(attrs[a][0]);
                if (key) nodes[n].setAttribute(attr, t(key));
            }
        }
    }

    global.t = t;
    global.i18nCurrent = function () { return currentLang; };
    global.i18nApply = applyDomTranslations;

    // Run the walker once the active dict is loaded, then again
    // whenever fresh DOM is injected (callers can fire it manually).
    global.i18nReady.then(function () { applyDomTranslations(); });
})(window);
