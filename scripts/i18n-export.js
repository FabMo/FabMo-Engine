#!/usr/bin/env node
/*
 * i18n-export — dump every (key, English, target-language, status) tuple
 * to CSV for handing off to a translator or feeding to an AI.
 *
 * Usage:
 *   node scripts/i18n-export.js [targetLang] [outFile]
 *   node scripts/i18n-export.js ja i18n/ja.csv
 *   node scripts/i18n-export.js ja > /tmp/ja.csv
 *
 * Defaults: targetLang = "ja", outFile = stdout.
 *
 * CSV columns:
 *   key      — dotted path, e.g. "toolbox.drill_press"
 *   english  — current value from i18n/en.json
 *   <lang>   — current value from i18n/<lang>.json (or empty)
 *   status   — one of:
 *                ok        translation matches the English it was made
 *                          from (per i18n/<lang>.meta.json sidecar)
 *                new       no translation yet
 *                stale     English has changed since the translation
 *                          was last recorded. Format: stale (was: "...")
 *                          so the translator sees what the old English
 *                          said and can judge whether their translation
 *                          still applies.
 *                untracked translation exists but no sidecar record —
 *                          translation predates the staleness system,
 *                          or someone hand-edited the JSON. Treat as
 *                          "probably ok, please confirm."
 *                orphaned  translation exists but the key has been
 *                          removed from en.json. Translator can delete
 *                          the row, or keep the translation in case the
 *                          key returns later.
 *
 * Skips the _meta block. Standard CSV escaping.
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
var meta = {};
try {
    meta = JSON.parse(fs.readFileSync(path.join(i18nDir, targetLang + ".meta.json"), "utf8"));
} catch (e) {
    // No sidecar yet — every existing translation will be "untracked."
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

// Build the union of keys: everything in en.json, plus any target-only
// keys (so orphaned translations show up in the CSV and the translator
// can review them rather than them silently lingering in the JSON).
var enKeys = [];
walk(en, "", enKeys);
var targetKeys = [];
walk(target, "", targetKeys);

var enKeySet = {};
enKeys.forEach(function (k) { enKeySet[k] = true; });
var orphanKeys = targetKeys.filter(function (k) { return !enKeySet[k]; });

var rows = [];

enKeys.forEach(function (k) {
    var enVal = lookup(en, k) || "";
    var trVal = lookup(target, k);
    var metaEntry = meta[k];
    var status;
    if (trVal === undefined || trVal === "") {
        status = "new";
    } else if (!metaEntry || metaEntry.en_at_translation === undefined) {
        status = "untracked";
    } else if (metaEntry.en_at_translation === enVal) {
        status = "ok";
    } else {
        status = "stale (was: \"" + metaEntry.en_at_translation + "\")";
    }
    rows.push([k, enVal, trVal || "", status]);
});

orphanKeys.forEach(function (k) {
    rows.push([k, "", lookup(target, k) || "", "orphaned"]);
});

var lines = ["key,english," + targetLang + ",status"];
rows.forEach(function (r) {
    lines.push(r.map(csvEscape).join(","));
});

var output = lines.join("\n") + "\n";
if (outFile) {
    fs.writeFileSync(outFile, output);
    // Summary on stderr — useful when the script is part of a release flow.
    var counts = { ok: 0, "new": 0, stale: 0, untracked: 0, orphaned: 0 };
    rows.forEach(function (r) {
        var s = r[3].split(" ")[0];   // "stale (was: ...)" → "stale"
        if (counts[s] !== undefined) counts[s]++;
    });
    process.stderr.write(
        "Wrote " + rows.length + " keys to " + outFile + "\n" +
        "  ok: " + counts.ok +
        ", new: " + counts["new"] +
        ", stale: " + counts.stale +
        ", untracked: " + counts.untracked +
        ", orphaned: " + counts.orphaned + "\n"
    );
} else {
    process.stdout.write(output);
}
