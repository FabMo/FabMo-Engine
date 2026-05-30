#!/usr/bin/env node
/*
 * i18n-export — dump every (key, English, target-language) tuple to CSV
 * for handing off to a translator or feeding to an AI for first-pass
 * translation. The CSV layout is intentionally trivial so any tool
 * (Sheets, Excel, jq, awk) can roundtrip it.
 *
 * Usage:
 *   node scripts/i18n-export.js [targetLang] [outFile]
 *   node scripts/i18n-export.js ja > i18n/ja.csv
 *
 * Defaults: targetLang = "ja", outFile = stdout.
 *
 * Columns: key, english, target
 *   - key is the dotted path ("toolbox.drill_press")
 *   - english is the value from i18n/en.json
 *   - target is the current value from i18n/<lang>.json, or empty if
 *     not yet translated. Empty target = translator's TODO list.
 *
 * Skips the _meta block. Standard CSV escaping (double-quotes around
 * any field containing comma, quote, or newline).
 */
var fs = require("fs");
var path = require("path");

var targetLang = process.argv[2] || "ja";
var outFile = process.argv[3] || null;

var i18nDir = path.resolve(__dirname, "..", "i18n");
var en = JSON.parse(fs.readFileSync(path.join(i18nDir, "en.json"), "utf8"));
var target = {};
try {
    target = JSON.parse(fs.readFileSync(path.join(i18nDir, targetLang + ".json"), "utf8"));
} catch (e) {
    process.stderr.write("note: " + targetLang + ".json missing, target column will be empty\n");
}

function walk(dict, prefix, out) {
    if (!dict || typeof dict !== "object") return;
    Object.keys(dict).forEach(function (k) {
        if (k === "_meta") return;
        var keyPath = prefix ? prefix + "." + k : k;
        var v = dict[k];
        if (v && typeof v === "object") {
            walk(v, keyPath, out);
        } else if (typeof v === "string") {
            out.push(keyPath);
        }
    });
}

function lookup(dict, dottedKey) {
    var parts = dottedKey.split(".");
    var cur = dict;
    for (var i = 0; i < parts.length; i++) {
        if (cur === null || typeof cur !== "object") return undefined;
        cur = cur[parts[i]];
    }
    return typeof cur === "string" ? cur : undefined;
}

function csvEscape(s) {
    if (s === undefined || s === null) return "";
    s = String(s);
    if (/[",\n]/.test(s)) {
        return "\"" + s.replace(/"/g, "\"\"") + "\"";
    }
    return s;
}

var keys = [];
walk(en, "", keys);

var lines = ["key,english," + targetLang];
keys.forEach(function (k) {
    lines.push([
        csvEscape(k),
        csvEscape(lookup(en, k)),
        csvEscape(lookup(target, k) || ""),
    ].join(","));
});

var output = lines.join("\n") + "\n";
if (outFile) {
    fs.writeFileSync(outFile, output);
    process.stderr.write("Wrote " + keys.length + " keys to " + outFile + "\n");
} else {
    process.stdout.write(output);
}
