/*
 * i18n coverage — every i18n key referenced by dashboard HTML/JS must
 * exist in the English dictionary, or users see the raw key in the UI
 * (the DOM walker in dashboard/static/js/libs/i18n.js replaces element
 * text with t(key)).
 *
 * Guards against the recurring failure mode where markup lands with
 * data-i18n attributes but the matching en.json entries are forgotten
 * (e.g. the Machine Features checkboxes, Oct 2026).
 */
var fs = require("fs");
var path = require("path");

var ROOT = path.resolve(__dirname, "..");

function readJson(p) {
    return JSON.parse(fs.readFileSync(p, "utf8"));
}

// The engine serves i18n/en.json merged with each app's own i18n/en.json
// namespace (see the i18n merge at startup), so build the same view here.
function loadMergedEnglishDict() {
    var dict = readJson(path.join(ROOT, "i18n", "en.json"));
    var appsDir = path.join(ROOT, "dashboard", "apps");
    fs.readdirSync(appsDir).forEach(function (entry) {
        var appDict = path.join(appsDir, entry, "i18n", "en.json");
        if (fs.existsSync(appDict)) {
            var d = readJson(appDict);
            Object.keys(d).forEach(function (k) {
                if (k !== "_meta") dict[k] = d[k];
            });
        }
    });
    return dict;
}

function lookup(dict, dottedKey) {
    return dottedKey.split(".").reduce(function (o, part) {
        return o === undefined || o === null ? undefined : o[part];
    }, dict);
}

function listHtmlFiles() {
    var files = [path.join(ROOT, "dashboard", "build", "index.html")];
    var appsDir = path.join(ROOT, "dashboard", "apps");
    fs.readdirSync(appsDir).forEach(function (entry) {
        var dir = path.join(appsDir, entry);
        if (!fs.statSync(dir).isDirectory()) return;
        fs.readdirSync(dir).forEach(function (f) {
            if (f.endsWith(".html")) files.push(path.join(dir, f));
        });
    });
    return files.filter(function (f) {
        return fs.existsSync(f);
    });
}

function listJsFiles() {
    var files = [];
    function walk(dir) {
        fs.readdirSync(dir).forEach(function (entry) {
            var p = path.join(dir, entry);
            var stat = fs.statSync(p);
            if (stat.isDirectory()) {
                if (entry === "node_modules" || entry === "build") return;
                walk(p);
            } else if (entry.endsWith(".js")) {
                files.push(p);
            }
        });
    }
    walk(path.join(ROOT, "dashboard", "apps"));
    walk(path.join(ROOT, "dashboard", "static", "js"));
    return files;
}

describe("i18n key coverage", function () {
    var dict = loadMergedEnglishDict();
    var topLevelNamespaces = Object.keys(dict);

    test("every data-i18n key in dashboard HTML exists in the English dict", function () {
        var missing = [];
        listHtmlFiles().forEach(function (file) {
            var html = fs.readFileSync(file, "utf8");
            var re = /data-i18n(?:-[a-z-]+)?="([^"]+)"/g;
            var m;
            while ((m = re.exec(html)) !== null) {
                var key = m[1];
                if (lookup(dict, key) === undefined) {
                    missing.push(path.relative(ROOT, file) + ": " + key);
                }
            }
        });
        expect(missing).toEqual([]);
    });

    test("every literal t('…') key in dashboard JS exists in the English dict", function () {
        var missing = [];
        // Only dotted keys whose first segment is a known namespace —
        // avoids false positives from unrelated functions named t().
        // The closing ")/," requirement skips dynamic keys built by
        // concatenation, e.g. t("config.outputs_tab.input_title_" + side).
        var re = /\bt\(\s*["']([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+)["']\s*[),]/g;
        listJsFiles().forEach(function (file) {
            var src = fs.readFileSync(file, "utf8");
            var m;
            while ((m = re.exec(src)) !== null) {
                var key = m[1];
                if (topLevelNamespaces.indexOf(key.split(".")[0]) === -1) continue;
                if (lookup(dict, key) === undefined) {
                    missing.push(path.relative(ROOT, file) + ": " + key);
                }
            }
        });
        expect(missing).toEqual([]);
    });
});
