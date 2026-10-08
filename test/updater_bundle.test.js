/*
 * Tests for the bundled-updater background install decision logic
 * (updater_bundle.js). The actual relay/install path is shared with the
 * manual-update routes and is not exercised here.
 */
var fs = require("fs");
var path = require("path");
var os = require("os");

var bundle = require("../updater_bundle");

describe("verCmp", function () {
    test("orders semver with and without v prefix", function () {
        expect(bundle._verCmp("v4.0.53", "4.0.53")).toBe(0);
        expect(bundle._verCmp("v4.0.55", "v4.0.53")).toBeGreaterThan(0);
        expect(bundle._verCmp("v4.0.9", "v4.0.53")).toBeLessThan(0);
        expect(bundle._verCmp("v4.1.0", "v4.0.99")).toBeGreaterThan(0);
    });
});

describe("findBundledPackage", function () {
    var tmp;
    beforeEach(function () {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-test-"));
    });
    afterEach(function () {
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    function withBundleDir(dir, fn) {
        // _BUNDLE_DIR is baked in at require time; findBundledPackage reads
        // it via closure, so test through a symlink at the real location is
        // not possible — instead we exercise the directory scan indirectly
        // by pointing the module's fs calls at our dir via monkey-patch.
        var origReaddir = fs.readdirSync;
        fs.readdirSync = function (p) {
            if (p === bundle._BUNDLE_DIR) {
                return origReaddir(dir);
            }
            return origReaddir.apply(fs, arguments);
        };
        try {
            return fn(function joined(f) {
                // findBundledPackage joins names onto _BUNDLE_DIR; callers
                // only need name/version here, so that's fine.
            });
        } finally {
            fs.readdirSync = origReaddir;
        }
    }

    test("picks the newest fabmo-updater package, ignoring other products", function () {
        fs.writeFileSync(path.join(tmp, "fabmo-updater_linux_raspberry-pi_v4.0.53.fmp"), "x");
        fs.writeFileSync(path.join(tmp, "fabmo-updater_linux_raspberry-pi_v4.0.55.fmp"), "x");
        fs.writeFileSync(path.join(tmp, "fabmo-engine_linux_raspberry-pi_v9.9.9.fmp"), "x");
        fs.writeFileSync(path.join(tmp, "notes.txt"), "x");
        withBundleDir(tmp, function () {
            var best = bundle._findBundledPackage();
            expect(best).not.toBeNull();
            expect(best.version).toBe("v4.0.55");
            expect(best.name).toBe("fabmo-updater_linux_raspberry-pi_v4.0.55.fmp");
        });
    });

    test("returns null for an empty or missing directory", function () {
        withBundleDir(tmp, function () {
            expect(bundle._findBundledPackage()).toBeNull();
        });
    });

    test("ignores packages without a parseable version", function () {
        fs.writeFileSync(path.join(tmp, "fabmo-updater_custom.fmp"), "x");
        withBundleDir(tmp, function () {
            expect(bundle._findBundledPackage()).toBeNull();
        });
    });
});
