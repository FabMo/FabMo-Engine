#!/usr/bin/env node
/*
 * i18n-analyze — validate and coverage-check a FabMo app's i18n setup.
 *
 * Pre-submission tool for third-party app developers. Reports:
 *   1. Structural validity — does i18n/en.json exist, is it well-formed,
 *      are all keys namespaced under the app id?
 *   2. Coverage — walk the app's .html / .js, find user-visible English
 *      text that has no data-i18n / t(...) marking. Heuristic but
 *      catches the obvious omissions.
 *   3. Summary — total keys, longest values, available target languages,
 *      and a per-language status breakdown if .meta.json sidecars exist.
 *
 * Usage:
 *   node scripts/i18n-analyze.js path/to/myapp.fma
 *   node scripts/i18n-analyze.js path/to/myapp.fma --json
 *   node scripts/i18n-analyze.js path/to/myapp.fma --export ja > ja.csv
 *
 * Determines the app's namespace from i18n/en.json's _meta.app field,
 * falling back to package.json's "name", then the directory name (sans
 * ".fma"). All keys in the app's dict must start with that namespace.
 */
var fs = require("fs");
var path = require("path");

var argv = process.argv.slice(2);
var jsonOut = argv.indexOf("--json") !== -1;
var exportIdx = argv.indexOf("--export");
var exportLang = exportIdx !== -1 ? argv[exportIdx + 1] : null;
var positional = argv.filter(function (a, i) {
    if (a === "--json") return false;
    if (a === "--export") return false;
    if (argv[i - 1] === "--export") return false;
    return true;
});
var appDir = positional[0];

if (!appDir) {
    process.stderr.write("Usage: i18n-analyze.js <appDir> [--json] [--export <lang>]\n");
    process.exit(1);
}
appDir = path.resolve(appDir);
if (!fs.existsSync(appDir) || !fs.statSync(appDir).isDirectory()) {
    process.stderr.write("Not a directory: " + appDir + "\n");
    process.exit(1);
}

// ---------- 1. Identify app namespace ----------
function readJsonSafe(p) {
    try { return JSON.parse(fs.readFileSync(p, "utf8")); }
    catch (e) { return null; }
}

var i18nDir = path.join(appDir, "i18n");
var enDict = readJsonSafe(path.join(i18nDir, "en.json"));
var pkg = readJsonSafe(path.join(appDir, "package.json"));
var dirName = path.basename(appDir).replace(/\.fma$/, "");
var appId = (enDict && enDict._meta && enDict._meta.app) ||
            (pkg && pkg.name) ||
            dirName;

// ---------- 2. Validate ----------
var issues = [];   // hard errors — must fix before submission
var warnings = []; // soft — review but not blocking

if (!enDict) {
    issues.push("Missing or invalid i18n/en.json");
}

function flattenKeys(dict, prefix, out) {
    if (!dict || typeof dict !== "object") return;
    Object.keys(dict).forEach(function (k) {
        if (k === "_meta") return;
        var kp = prefix ? prefix + "." + k : k;
        var v = dict[k];
        if (v && typeof v === "object") flattenKeys(v, kp, out);
        else if (typeof v === "string") out[kp] = v;
        else warnings.push("Non-string value at key " + kp);
    });
}

var enFlat = {};
if (enDict) flattenKeys(enDict, "", enFlat);

var totalKeys = Object.keys(enFlat).length;
if (totalKeys === 0 && enDict) {
    warnings.push("en.json contains no translatable strings");
}

// Keys must start with appId. Period — collisions otherwise possible.
var badNamespace = [];
Object.keys(enFlat).forEach(function (k) {
    if (k !== appId && !k.startsWith(appId + ".")) {
        badNamespace.push(k);
    }
});
if (badNamespace.length) {
    issues.push(
        badNamespace.length + " key(s) not under '" + appId + ".' namespace: " +
        badNamespace.slice(0, 5).join(", ") +
        (badNamespace.length > 5 ? ", ..." : "")
    );
}

// Empty strings — translator will not see anything to work with.
var emptyKeys = Object.keys(enFlat).filter(function (k) { return !enFlat[k]; });
if (emptyKeys.length) {
    warnings.push(emptyKeys.length + " empty value(s): " +
                  emptyKeys.slice(0, 5).join(", ") +
                  (emptyKeys.length > 5 ? ", ..." : ""));
}

// ---------- 3. Coverage scan ----------
function listFiles(dir, out) {
    var entries;
    try { entries = fs.readdirSync(dir); } catch (e) { return; }
    entries.forEach(function (e) {
        if (e === "node_modules" || e === "i18n" || e === ".git") return;
        var p = path.join(dir, e);
        var st;
        try { st = fs.statSync(p); } catch (err) { return; }
        if (st.isDirectory()) listFiles(p, out);
        else if (/\.(html|js)$/.test(e)) out.push(p);
    });
}

var files = [];
listFiles(appDir, files);

// Patterns indicating a string IS marked.
var markedRe = /data-i18n(?:-[a-z-]+)?\s*=|window\.t\s*\(|\bt\s*\(\s*["']|i18n\.t\s*\(/;

// Patterns for visible text candidates. These are heuristics — they
// flag obvious omissions but won't catch everything (and may flag
// false positives that the dev sweeps aside).
var SKIP_TEXT = /^[\s\d\W_]*$/;  // pure punctuation / numbers / whitespace
var SKIP_WORDS = new Set([
    "fabmo", "g2", "g-code", "gcode", "sbp", "ok", "true", "false",
    "yes", "no", "menu", "submit",
]);

function isInteresting(text) {
    text = text.trim();
    if (!text) return false;
    if (text.length < 2) return false;
    if (SKIP_TEXT.test(text)) return false;
    if (/^[A-Z0-9_-]{1,4}$/.test(text)) return false;  // codes like "C2", "JH"
    if (!/[a-zA-Z]{2,}/.test(text)) return false;
    if (SKIP_WORDS.has(text.toLowerCase())) return false;
    return true;
}

var unmarked = [];

files.forEach(function (f) {
    var content;
    try { content = fs.readFileSync(f, "utf8"); } catch (e) { return; }
    var lines = content.split(/\r?\n/);
    var relPath = path.relative(appDir, f);

    if (/\.html$/.test(f)) {
        lines.forEach(function (line, idx) {
            // Visible text between > and < (very approximate). Skip
            // lines that already carry an i18n marker.
            if (markedRe.test(line)) return;
            var m;
            var re = />([^<>{}]+)</g;
            while ((m = re.exec(line)) !== null) {
                var text = m[1];
                if (isInteresting(text)) {
                    unmarked.push({
                        file: relPath, line: idx + 1,
                        kind: "html-text",
                        text: text.trim().slice(0, 60),
                    });
                }
            }
            // title="..." attribute
            var tre = /\b(title|placeholder|aria-label)\s*=\s*["']([^"']+)["']/g;
            while ((m = tre.exec(line)) !== null) {
                var attrText = m[2];
                if (isInteresting(attrText)) {
                    unmarked.push({
                        file: relPath, line: idx + 1,
                        kind: "html-attr-" + m[1],
                        text: attrText.slice(0, 60),
                    });
                }
            }
        });
    } else if (/\.js$/.test(f)) {
        lines.forEach(function (line, idx) {
            if (markedRe.test(line)) return;
            // Strings passed to .text() / .html() / alert / fabmo.notify /
            // setAttribute('title', ...) — these are the usual ways JS
            // injects user-visible English.
            var jsRe = /\.(text|html)\s*\(\s*["']([^"']+)["']|\b(?:alert|notify)\s*\(\s*[^,)]*["']([^"']+)["']/g;
            var m;
            while ((m = jsRe.exec(line)) !== null) {
                var text = m[2] || m[3];
                if (isInteresting(text)) {
                    unmarked.push({
                        file: relPath, line: idx + 1,
                        kind: "js-literal",
                        text: text.slice(0, 60),
                    });
                }
            }
        });
    }
});

// ---------- 4. Language summary ----------
var languages = [];
if (fs.existsSync(i18nDir)) {
    fs.readdirSync(i18nDir).forEach(function (file) {
        if (!/\.json$/.test(file) || /\.meta\.json$/.test(file)) return;
        var code = path.basename(file, ".json");
        if (code === "en") return;
        var d = readJsonSafe(path.join(i18nDir, file));
        if (!d) return;
        var flat = {};
        flattenKeys(d, "", flat);
        languages.push({
            code: code,
            translated_keys: Object.keys(flat).length,
            coverage_pct: totalKeys ? Math.round(100 * Object.keys(flat).length / totalKeys) : 0,
        });
    });
}

var longest = Object.keys(enFlat)
    .map(function (k) { return { key: k, length: enFlat[k].length }; })
    .sort(function (a, b) { return b.length - a.length; })
    .slice(0, 5);

// ---------- 5. Output ----------
var report = {
    app: { dir: appDir, id: appId },
    keys: { total: totalKeys, longest: longest },
    files_scanned: files.length,
    issues: issues,
    warnings: warnings,
    unmarked_candidates: unmarked,
    languages: languages,
};

if (jsonOut) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    process.exit(issues.length ? 1 : 0);
}

if (exportLang) {
    // CSV export for translator — same layout as the core export.
    var target = readJsonSafe(path.join(i18nDir, exportLang + ".json")) || {};
    var meta   = readJsonSafe(path.join(i18nDir, exportLang + ".meta.json")) || {};
    var targetFlat = {};
    flattenKeys(target, "", targetFlat);
    function csvEsc(s) {
        if (s === undefined || s === null) return "";
        s = String(s);
        return /[",\n]/.test(s) ? "\"" + s.replace(/"/g, "\"\"") + "\"" : s;
    }
    process.stdout.write("key,english," + exportLang + ",status\n");
    Object.keys(enFlat).forEach(function (k) {
        var enVal = enFlat[k];
        var trVal = targetFlat[k] || "";
        var status;
        if (!trVal) status = "new";
        else if (!meta[k] || meta[k].en_at_translation === undefined) status = "untracked";
        else if (meta[k].en_at_translation === enVal) status = "ok";
        else status = "stale (was: \"" + meta[k].en_at_translation + "\")";
        process.stdout.write([k, enVal, trVal, status].map(csvEsc).join(",") + "\n");
    });
    process.exit(0);
}

// Human-readable summary.
function header(s) { return "\n=== " + s + " ===\n"; }
process.stdout.write(header("App"));
process.stdout.write("dir:       " + appDir + "\n");
process.stdout.write("id:        " + appId + "\n");
process.stdout.write("namespace: " + appId + ".*\n");

process.stdout.write(header("Dictionary"));
process.stdout.write("keys:      " + totalKeys + "\n");
if (longest.length) {
    process.stdout.write("longest:\n");
    longest.forEach(function (l) {
        process.stdout.write("  " + l.length + " chars  " + l.key + "\n");
    });
}

if (languages.length) {
    process.stdout.write(header("Translations"));
    languages.forEach(function (l) {
        process.stdout.write("  " + l.code + ": " + l.translated_keys + "/" +
                             totalKeys + " (" + l.coverage_pct + "%)\n");
    });
}

if (issues.length) {
    process.stdout.write(header("Issues (must fix)"));
    issues.forEach(function (i) { process.stdout.write("  " + i + "\n"); });
}
if (warnings.length) {
    process.stdout.write(header("Warnings"));
    warnings.forEach(function (w) { process.stdout.write("  " + w + "\n"); });
}

process.stdout.write(header("Coverage scan"));
process.stdout.write("files scanned: " + files.length + "\n");
process.stdout.write("unmarked candidates: " + unmarked.length + "\n");
if (unmarked.length) {
    process.stdout.write("\nCandidates (heuristic — review and either add\n");
    process.stdout.write("data-i18n / t() markup, or ignore if not user-facing):\n");
    unmarked.slice(0, 50).forEach(function (u) {
        process.stdout.write("  " + u.file + ":" + u.line + "  [" + u.kind +
                             "]  " + JSON.stringify(u.text) + "\n");
    });
    if (unmarked.length > 50) {
        process.stdout.write("  ... " + (unmarked.length - 50) + " more (use --json for full list)\n");
    }
}

process.stdout.write("\n");
process.exit(issues.length ? 1 : 0);
