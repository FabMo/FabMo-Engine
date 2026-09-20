#!/usr/bin/env node
/*
 * i18n-import — read an i18n-export CSV back into the language files.
 * Writes two files:
 *   i18n/<lang>.json       — runtime dict (nested object of key→string)
 *   i18n/<lang>.meta.json  — sidecar recording the English text that
 *                            each translation was made against, so the
 *                            next export can detect drift (stale flag).
 *
 * Usage:
 *   node scripts/i18n-import.js <targetLang> [inFile]
 *   node scripts/i18n-import.js ja i18n/ja.csv
 *   cat translations.csv | node scripts/i18n-import.js ja
 *
 * CSV layout (4 cols, status column optional and ignored by importer):
 *   key, english, <lang>, [status]
 *
 * Behaviour:
 *   - Rows with empty <lang> are skipped — the runtime falls back to
 *     English on missing keys, so empty rows don't pollute the JSON.
 *   - For each kept row, the second column (english) is stamped into
 *     the meta sidecar as `en_at_translation`. That's the source-of-
 *     truth for the next export's staleness check.
 *   - Existing _meta block in <lang>.json is preserved.
 *   - The meta sidecar is rewritten from scratch each import — entries
 *     for keys not in the CSV are dropped.
 */
var fs = require("fs");
var path = require("path");

// CLI: i18n-import.js <targetLang> [inFile] [--app <appDir>]
//   --app <dir>  Write translations into <dir>/i18n/<lang>.json
//                (and <lang>.meta.json) instead of the core /fabmo/i18n/.
//                Use for third-party app translations.
var argv = process.argv.slice(2);
var appIdx = argv.indexOf("--app");
var appDir = appIdx !== -1 ? argv[appIdx + 1] : null;
var positional = argv.filter(function (a, i) {
    if (a === "--app") return false;
    if (argv[i - 1] === "--app") return false;
    return true;
});
var targetLang = positional[0];
if (!targetLang) {
    process.stderr.write("Usage: i18n-import.js <targetLang> [inFile] [--app <appDir>]\n");
    process.exit(1);
}
var inFile = positional[1] || null;

function readInput() {
    if (inFile) return fs.readFileSync(inFile, "utf8");
    return fs.readFileSync(0, "utf8");
}

// Minimal CSV parser — handles quoted fields with embedded commas /
// quotes / newlines.
function parseCSV(text) {
    var rows = [];
    var row = [];
    var cell = "";
    var i = 0;
    var inQuotes = false;
    while (i < text.length) {
        var c = text[i];
        if (inQuotes) {
            if (c === "\"") {
                if (text[i + 1] === "\"") { cell += "\""; i += 2; continue; }
                inQuotes = false; i++; continue;
            }
            cell += c; i++; continue;
        }
        if (c === "\"") { inQuotes = true; i++; continue; }
        if (c === ",") { row.push(cell); cell = ""; i++; continue; }
        if (c === "\n" || c === "\r") {
            if (c === "\r" && text[i + 1] === "\n") i++;
            row.push(cell); rows.push(row); row = []; cell = ""; i++; continue;
        }
        cell += c; i++;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    return rows;
}

function setNested(obj, dottedKey, value) {
    var parts = dottedKey.split(".");
    var cur = obj;
    for (var i = 0; i < parts.length - 1; i++) {
        if (typeof cur[parts[i]] !== "object" || cur[parts[i]] === null) {
            cur[parts[i]] = {};
        }
        cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
}

var i18nDir;
if (appDir) {
    i18nDir = path.resolve(appDir, "i18n");
    if (!fs.existsSync(i18nDir)) {
        try { fs.mkdirSync(i18nDir, { recursive: true }); }
        catch (e) {
            process.stderr.write("Could not create " + i18nDir + ": " + e.message + "\n");
            process.exit(1);
        }
    }
} else {
    i18nDir = path.resolve(__dirname, "..", "i18n");
}
var outPath = path.join(i18nDir, targetLang + ".json");
var metaPath = path.join(i18nDir, targetLang + ".meta.json");

// Preserve _meta block of existing target file.
var existingMeta = null;
try {
    var existing = JSON.parse(fs.readFileSync(outPath, "utf8"));
    if (existing._meta) existingMeta = existing._meta;
} catch (e) { /* no existing file */ }

var rows = parseCSV(readInput());
if (!rows.length) {
    process.stderr.write("no rows in input\n");
    process.exit(1);
}
var header = rows[0];
if (header[0] !== "key" || header[1] !== "english") {
    process.stderr.write("expected header: key,english,<lang>[,status]\n");
    process.exit(1);
}

var out = {};
if (existingMeta) out._meta = existingMeta;

var metaOut = {};
var filled = 0;
var skipped = 0;
for (var r = 1; r < rows.length; r++) {
    var row = rows[r];
    if (!row[0]) continue;
    var key = row[0];
    var english = row[1] || "";
    var target = (row[2] || "").trim();
    if (!target) { skipped++; continue; }
    setNested(out, key, target);
    metaOut[key] = { en_at_translation: english };
    filled++;
}

fs.writeFileSync(outPath, JSON.stringify(out, null, 4) + "\n");
fs.writeFileSync(metaPath, JSON.stringify(metaOut, null, 4) + "\n");
process.stderr.write(
    "Wrote " + filled + " translated keys to " + outPath +
    " (" + skipped + " untranslated row(s) skipped)\n" +
    "Wrote sidecar: " + metaPath + "\n"
);
