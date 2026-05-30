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

function loadAll() {
    var dir = __dirname;
    var files = fs.readdirSync(dir);
    files.forEach(function (file) {
        if (path.extname(file) !== ".json") return;
        var code = path.basename(file, ".json");
        try {
            var raw = fs.readFileSync(path.join(dir, file), "utf8");
            dicts[code] = JSON.parse(raw);
        } catch (e) {
            log.warn("i18n: failed to load " + file + ": " + e.message);
        }
    });
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
