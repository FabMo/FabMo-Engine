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

describe("start() scheduling", function () {
    var T = bundle._timing;
    var origDecide, origInstall;
    beforeEach(function () {
        jest.useFakeTimers();
        origDecide = bundle._impl.decide;
        origInstall = bundle._impl.attemptInstall;
    });
    afterEach(function () {
        bundle._impl.decide = origDecide;
        bundle._impl.attemptInstall = origInstall;
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    function machineIn(state) {
        return { status: { state: state } };
    }
    var BUNDLE = { install: true, reason: "test", bundle: { version: "v9.9.9", name: "x.fmp", path: "/x" } };

    test("installs right after the initial delay when the machine is idle", function () {
        bundle._impl.decide = jest.fn().mockReturnValue(BUNDLE);
        var installed = jest.fn(function (b, cb) { cb(null); });
        bundle._impl.attemptInstall = installed;
        bundle.start(machineIn("idle"));
        jest.advanceTimersByTime(T.INITIAL_DELAY_MS - 1);
        expect(installed).not.toHaveBeenCalled();
        jest.advanceTimersByTime(1);
        expect(installed).toHaveBeenCalledTimes(1);
        // the initial delay is seconds, not minutes: before the user is back
        expect(T.INITIAL_DELAY_MS).toBeLessThanOrEqual(30 * 1000);
    });

    test("polls for the machine's first idle, then installs once", function () {
        bundle._impl.decide = jest.fn().mockReturnValue(BUNDLE);
        var installed = jest.fn(function (b, cb) { cb(null); });
        bundle._impl.attemptInstall = installed;
        var machine = machineIn("not_ready");
        bundle.start(machine);
        jest.advanceTimersByTime(T.INITIAL_DELAY_MS + T.IDLE_POLL_MS * 2);
        expect(installed).not.toHaveBeenCalled();
        machine.status.state = "idle";
        jest.advanceTimersByTime(T.IDLE_POLL_MS);
        expect(installed).toHaveBeenCalledTimes(1);
        jest.advanceTimersByTime(T.IDLE_POLL_MS * 10);
        expect(installed).toHaveBeenCalledTimes(1);
    });

    test("a transient failure retries, bounded by MAX_ATTEMPTS", function () {
        bundle._impl.decide = jest.fn().mockReturnValue(BUNDLE);
        var installed = jest.fn(function (b, cb) { cb(new Error("updater unreachable")); });
        bundle._impl.attemptInstall = installed;
        bundle.start(machineIn("idle"));
        jest.advanceTimersByTime(T.INITIAL_DELAY_MS + T.FAIL_RETRY_MS * (T.MAX_ATTEMPTS + 3));
        expect(installed).toHaveBeenCalledTimes(T.MAX_ATTEMPTS);
    });

    test("nothing to install → no attempt and no lingering timers", function () {
        bundle._impl.decide = jest.fn().mockReturnValue({ install: false, reason: "up to date", bundle: null });
        var installed = jest.fn();
        bundle._impl.attemptInstall = installed;
        bundle.start(machineIn("idle"));
        jest.advanceTimersByTime(T.INITIAL_DELAY_MS * 10);
        expect(installed).not.toHaveBeenCalled();
        expect(jest.getTimerCount()).toBe(0);
    });
});
