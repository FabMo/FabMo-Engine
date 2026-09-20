#!/usr/bin/env node
/*
 * i18n-orphans — find keys in i18n/en.json that no longer have a
 * reference anywhere in the code. Helps trim dead translations after
 * a UI is refactored / removed.
 *
 * Scans .html / .js files under dashboard/ and the engine root for:
 *   - data-i18n="key" / data-i18n-title="key" / data-i18n-*="key"
 *   - t("key" …)     / window.t("key" …)
 *   - i18n.t("key", …)
 *
 * Caveat: dynamically-built keys (`t("foo." + name)`) won't be
 * caught. The scanner reports references it can prove, so the orphan
 * list is "candidates to investigate," not "safe to delete."
 *
 * Usage:
 *   node scripts/i18n-orphans.js
 *   node scripts/i18n-orphans.js --json   (machine-readable output)
 */
var fs = require("fs");
var path = require("path");

var ROOT = path.resolve(__dirname, "..");
var SCAN_DIRS = [
    "dashboard/static",
    "dashboard/apps",
    "dashboard/build/index.html",  // built dashboard HTML
    "routes",
    "pendant",
    "i18n",                         // catches t() calls in server code
];
var SKIP = /(node_modules|\.git|\/build\/(?!index\.html$))/;

function walkFiles(p, out) {
    var st;
    try { st = fs.statSync(p); } catch (e) { return; }
    if (st.isFile()) {
        if (/\.(html|js|json)$/.test(p) && !SKIP.test(p)) {
            // Skip i18n JSON files themselves — keys defined there are
            // not "references." Server module is OK to scan because t()
            // calls might exist there.
            if (/\/i18n\/[a-z_]+\.json$/i.test(p)) return;
            out.push(p);
        }
        return;
    }
    if (st.isDirectory()) {
        if (SKIP.test(p)) return;
        fs.readdirSync(p).forEach(function (entry) {
            walkFiles(path.join(p, entry), out);
        });
    }
}

var files = [];
SCAN_DIRS.forEach(function (d) { walkFiles(path.join(ROOT, d), files); });

// Patterns to match key references.
var patterns = [
    /data-i18n(?:-[a-z-]+)?\s*=\s*["']([\w.]+)["']/g,
    /\bt\s*\(\s*["']([\w.]+)["']/g,
    /\bi18n\.t\s*\(\s*["']([\w.]+)["']/g,
    /\bi18nError\s*\(\s*["']([\w.]+)["']/g,
];

var referenced = {};
files.forEach(function (f) {
    var content;
    try { content = fs.readFileSync(f, "utf8"); } catch (e) { return; }
    patterns.forEach(function (re) {
        re.lastIndex = 0;
        var m;
        while ((m = re.exec(content)) !== null) {
            referenced[m[1]] = (referenced[m[1]] || []).concat([f]);
        }
    });
});

// Walk en.json and find keys with no reference.
var en = JSON.parse(fs.readFileSync(path.join(ROOT, "i18n", "en.json"), "utf8"));

function walkKeys(dict, prefix, out) {
    if (!dict || typeof dict !== "object") return;
    Object.keys(dict).forEach(function (k) {
        if (k === "_meta") return;
        var keyPath = prefix ? prefix + "." + k : k;
        var v = dict[k];
        if (v && typeof v === "object") walkKeys(v, keyPath, out);
        else if (typeof v === "string") out.push(keyPath);
    });
}

var enKeys = [];
walkKeys(en, "", enKeys);

var orphans = enKeys.filter(function (k) { return !referenced[k]; });

if (process.argv.indexOf("--json") !== -1) {
    process.stdout.write(JSON.stringify({
        scanned_files: files.length,
        total_keys: enKeys.length,
        referenced: enKeys.length - orphans.length,
        orphans: orphans,
    }, null, 2) + "\n");
} else {
    process.stdout.write(
        "Scanned " + files.length + " files\n" +
        "Keys in en.json: " + enKeys.length + "\n" +
        "  referenced: " + (enKeys.length - orphans.length) + "\n" +
        "  orphans:    " + orphans.length + "\n"
    );
    if (orphans.length) {
        process.stdout.write("\nOrphan keys (no static reference found):\n");
        orphans.forEach(function (k) {
            process.stdout.write("  " + k + "\n");
        });
        process.stdout.write(
            "\nNote: dynamically-built keys (t(\"foo.\" + name)) are not " +
            "detected. Review before deleting.\n"
        );
    }
}
