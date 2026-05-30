#!/usr/bin/env node
/*
 * i18n-import — read a CSV from i18n-export back into a language file.
 * Pairs with i18n-export.js; the layout is the same three columns:
 *   key, english, target
 *
 * Usage:
 *   node scripts/i18n-import.js <targetLang> [inFile]
 *   node scripts/i18n-import.js ja i18n/ja.csv
 *   cat translations.csv | node scripts/i18n-import.js ja
 *
 * Behaviour:
 *   - Reads the CSV (file or stdin).
 *   - Rebuilds a fresh nested dict from the rows where the target
 *     column is non-empty. Rows with empty target are skipped so the
 *     output file doesn't contain "" strings that would mask the
 *     English fallback at runtime.
 *   - Preserves the _meta block of the existing target file if any.
 *   - Writes i18n/<targetLang>.json with 4-space indent for diff
 *     readability.
 *
 * Skipped rows + total count are reported on stderr.
 */
var fs = require("fs");
var path = require("path");

var targetLang = process.argv[2];
if (!targetLang) {
    process.stderr.write("Usage: i18n-import.js <targetLang> [inFile]\n");
    process.exit(1);
}
var inFile = process.argv[3] || null;

function readInput() {
    if (inFile) return fs.readFileSync(inFile, "utf8");
    return fs.readFileSync(0, "utf8");
}

// Minimal CSV parser — handles quoted fields with embedded commas /
// quotes / newlines. Returns array of rows; each row is array of cells.
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

var i18nDir = path.resolve(__dirname, "..", "i18n");
var outPath = path.join(i18nDir, targetLang + ".json");

// Preserve the _meta block from the existing target file if it exists.
var existingMeta = null;
try {
    var existing = JSON.parse(fs.readFileSync(outPath, "utf8"));
    if (existing._meta) existingMeta = existing._meta;
} catch (e) { /* no existing file — fine */ }

var rows = parseCSV(readInput());
if (!rows.length) {
    process.stderr.write("no rows in input\n");
    process.exit(1);
}
var header = rows[0];
if (header[0] !== "key" || header[1] !== "english") {
    process.stderr.write("expected header: key,english,<lang>\n");
    process.exit(1);
}

var out = {};
if (existingMeta) out._meta = existingMeta;

var filled = 0;
var skipped = 0;
for (var r = 1; r < rows.length; r++) {
    var row = rows[r];
    if (!row[0]) continue;
    var key = row[0];
    var target = (row[2] || "").trim();
    if (!target) { skipped++; continue; }
    setNested(out, key, target);
    filled++;
}

fs.writeFileSync(outPath, JSON.stringify(out, null, 4) + "\n");
process.stderr.write("Wrote " + filled + " translated keys to " + outPath +
                     " (" + skipped + " untranslated row(s) skipped)\n");
