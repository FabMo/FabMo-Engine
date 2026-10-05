/*
 * i18n.js copy sync — each app ships its own copy of the client i18n
 * library (apps run in sandboxed iframes and can't share the dashboard
 * bundle), with the source of truth at dashboard/static/js/libs/i18n.js.
 *
 * The copies are plain files, so fixes to the lib silently miss the apps
 * unless propagated by hand — which is exactly what happened with the
 * missing-key guard (Oct 2026): added to the lib, absent from all eight
 * app copies. This test fails the build whenever a copy drifts.
 *
 * To fix a failure: edit dashboard/static/js/libs/i18n.js, then
 *   for f in dashboard/apps/*.fma/js/i18n.js; do
 *       cp dashboard/static/js/libs/i18n.js "$f"; done
 */
var fs = require("fs");
var path = require("path");

var ROOT = path.resolve(__dirname, "..");
var CANONICAL = path.join(ROOT, "dashboard", "static", "js", "libs", "i18n.js");

function appCopies() {
    var appsDir = path.join(ROOT, "dashboard", "apps");
    return fs
        .readdirSync(appsDir)
        .map(function (entry) {
            return path.join(appsDir, entry, "js", "i18n.js");
        })
        .filter(fs.existsSync);
}

describe("app copies of i18n.js", function () {
    var canonical = fs.readFileSync(CANONICAL, "utf8");
    var copies = appCopies();

    test("at least one app carries a copy (sanity)", function () {
        expect(copies.length).toBeGreaterThan(0);
    });

    copies.forEach(function (copy) {
        var rel = path.relative(ROOT, copy);
        test(rel + " matches dashboard/static/js/libs/i18n.js", function () {
            expect(fs.readFileSync(copy, "utf8")).toBe(canonical);
        });
    });
});
