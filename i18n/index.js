/*
 * i18n — server-side translation registry.
 *
 * Loads every i18n/<code>.json at startup. Each file is a nested dict
 * keyed by area, e.g.:
 *   { "keypad": { "go_to": "Go To" }, "toolbox": { "cut": "CUT" } }
 *
 * t(key, lang, vars) does dotted-path lookup with two fallbacks:
 *   1. Missing key in the target language → look up in English.
 *   2. Missing key in English too → return the key string itself.
 *
 * Partial translations are first-class: a fresh ja.json with empty
 * sections still renders, falling back to English where the translator
 * hasn't filled things in. That's how the workflow stays smooth.
 *
 * Var substitution is the simplest possible thing — `{name}` tokens in
 * the value get replaced with vars[name]. No ICU, no plural rules; if
 * we need plurals later we can add tn(key, count, vars).
 */

var fs = require("fs");
var path = require("path");
var log = require("../log").logger("i18n");

var dicts = {};
var loaded = false;

// Directories scanned for app dictionaries on top of core. Each
// matching <appdir>/i18n/<code>.json is merged into the in-memory
// dict for that language. Apps from /opt/fabmo/approot/... are
// installed third-party apps; apps under dashboard/apps/ are the
// ones bundled with the engine.
var APP_DICT_ROOTS = [
    path.resolve(__dirname, "..", "dashboard", "apps"),
    "/opt/fabmo/approot/approot",
];

// Deep-merge `src` into `dst` in place; later writes override earlier
// ones at the leaf level. Used to layer app dicts on top of core.
function deepMerge(dst, src) {
    if (!src || typeof src !== "object") return dst;
    Object.keys(src).forEach(function (k) {
        if (src[k] && typeof src[k] === "object" && !Array.isArray(src[k])) {
            if (!dst[k] || typeof dst[k] !== "object") dst[k] = {};
            deepMerge(dst[k], src[k]);
        } else {
            dst[k] = src[k];
        }
    });
    return dst;
}

// Pluck the top-level non-_meta keys to use as the expected namespace.
// Apps must scope all their keys under their app id, e.g.
//   { "my-app": { "buttons": { "go": "Go" } } }
// Returns the set of top-level namespaces declared in the dict.
function topLevelNamespaces(dict) {
    if (!dict || typeof dict !== "object") return [];
    return Object.keys(dict).filter(function (k) { return k !== "_meta"; });
}

function loadAppDicts() {
    APP_DICT_ROOTS.forEach(function (root) {
        var entries;
        try { entries = fs.readdirSync(root); } catch (e) { return; }
        entries.forEach(function (entry) {
            if (!/\.fma$/.test(entry)) return;
            var i18nDir = path.join(root, entry, "i18n");
            var files;
            try { files = fs.readdirSync(i18nDir); } catch (e) { return; }
            files.forEach(function (file) {
                // Skip meta sidecars (<lang>.meta.json) and non-json.
                if (!/\.json$/.test(file)) return;
                if (/\.meta\.json$/.test(file)) return;
                var code = path.basename(file, ".json");
                var fullPath = path.join(i18nDir, file);
                try {
                    var raw = fs.readFileSync(fullPath, "utf8");
                    var appDict = JSON.parse(raw);
                    if (!dicts[code]) dicts[code] = {};
                    deepMerge(dicts[code], appDict);
                    log.info("i18n: merged " + entry + "/" + file +
                             " [namespaces: " +
                             topLevelNamespaces(appDict).join(",") + "]");
                } catch (e) {
                    log.warn("i18n: failed to load " + fullPath +
                             ": " + e.message);
                }
            });
        });
    });
}

function loadAll() {
    // 1. Core dicts in /fabmo/i18n/*.json — source of truth, loaded first.
    var dir = __dirname;
    var files = fs.readdirSync(dir);
    files.forEach(function (file) {
        if (path.extname(file) !== ".json") return;
        if (/\.meta\.json$/.test(file)) return;   // skip sidecars
        var code = path.basename(file, ".json");
        try {
            var raw = fs.readFileSync(path.join(dir, file), "utf8");
            dicts[code] = JSON.parse(raw);
        } catch (e) {
            log.warn("i18n: failed to load " + file + ": " + e.message);
        }
    });
    // 2. App dicts merged on top, namespaced under each app's id.
    loadAppDicts();
    loaded = true;
    log.info("i18n loaded: " + Object.keys(dicts).join(", "));
}

function ensureLoaded() {
    if (!loaded) loadAll();
}

// Walk a dotted key path through a nested dict. Returns undefined if
// any segment is missing or a non-object is reached before the end.
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

function t(key, lang, vars) {
    ensureLoaded();
    var value = lookup(dicts[lang], key);
    if (value === undefined && lang !== "en") {
        value = lookup(dicts.en, key);
    }
    if (value === undefined) value = key;
    return substitute(value, vars);
}

function listLanguages() {
    ensureLoaded();
    return Object.keys(dicts).map(function (code) {
        var meta = (dicts[code] && dicts[code]._meta) || {};
        return {
            code: code,
            language: meta.language || code,
        };
    });
}

function getDict(lang) {
    ensureLoaded();
    return dicts[lang] || dicts.en || {};
}

// Reload from disk — useful after an import script writes new content.
function reload() {
    dicts = {};
    loaded = false;
    loadAll();
}

module.exports = {
    t: t,
    getDict: getDict,
    listLanguages: listLanguages,
    reload: reload,
};
