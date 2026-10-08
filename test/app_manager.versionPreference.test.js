/*
 * Tests for app id-collision version preference in the app manager:
 * when two installed apps share a package.json id, the higher-versioned
 * one must win regardless of load order, and a stale (older) user copy
 * must be cleaned out of the user app directory so profile applies and
 * updates stop resurrecting it.
 */
jest.mock("../machine", () => ({ machine: null }));
jest.mock("../config", () => ({
    getDataDir: jest.fn(() => "/tmp/fabmo-test"),
    getProfileDir: jest.fn(() => "/tmp/fabmo-test-profile"),
}));
jest.mock("fs-extra", () => ({
    remove: jest.fn((p, cb) => cb && cb(null)),
}));

const fs = require("fs-extra");
const { AppManager, compareAppVersions } = require("../dashboard/app_manager");

describe("compareAppVersions", () => {
    test("orders plain dotted versions", () => {
        expect(compareAppVersions("4.0.96", "4.0.103")).toBe(-1);
        expect(compareAppVersions("4.0.103", "4.0.96")).toBe(1);
        expect(compareAppVersions("0.2.0", "0.2.0")).toBe(0);
    });

    test("treats missing segments as zero", () => {
        expect(compareAppVersions("1.2", "1.2.0")).toBe(0);
        expect(compareAppVersions("1.2", "1.2.1")).toBe(-1);
    });

    test("tolerates a leading v", () => {
        expect(compareAppVersions("v0.1.0", "0.2.0")).toBe(-1);
    });

    test("returns null when a side is not a dotted version", () => {
        expect(compareAppVersions("", "1.0.0")).toBeNull();
        expect(compareAppVersions("1.0.0-beta", "1.0.0")).toBeNull();
        expect(compareAppVersions(undefined, "1.0.0")).toBeNull();
    });
});

describe("_addApp id collisions", () => {
    const USER_DIR = "/opt/fabmo/apps";

    function makeManager() {
        const mgr = new AppManager({
            app_directory: USER_DIR,
            approot_directory: "/opt/fabmo/approot/approot",
        });
        return mgr;
    }

    function entry(id, version, archive_path, app_path) {
        return {
            info: {
                id: id,
                version: version,
                app_archive_path: archive_path,
                app_path: app_path,
            },
            config: {},
        };
    }

    beforeEach(() => {
        fs.remove.mockClear();
    });

    test("older user copy loaded after a system app is ignored and cleaned up", () => {
        const mgr = makeManager();
        const system = entry(
            "tool_status",
            "0.2.0",
            mgr.system_app_directory + "/tool_status.fma",
            "/opt/fabmo/approot/approot/tool_status.fma"
        );
        const stale = entry(
            "tool_status",
            "0.1.0",
            USER_DIR + "/877b1930.fma",
            "/opt/fabmo/approot/approot/877b1930.fma"
        );

        mgr._addApp(system);
        mgr._addApp(stale);

        expect(mgr.apps_index["tool_status"].version).toBe("0.2.0");
        const removed = fs.remove.mock.calls.map((c) => c[0]);
        expect(removed).toContain(USER_DIR + "/877b1930.fma");
        expect(removed).toContain("/opt/fabmo/approot/approot/877b1930.fma");
    });

    test("newer user copy still replaces a system app", () => {
        const mgr = makeManager();
        const system = entry(
            "fabmo-sb4",
            "4.0.103",
            mgr.system_app_directory + "/sb4.fma",
            "/opt/fabmo/approot/approot/sb4.fma"
        );
        const newer = entry(
            "fabmo-sb4",
            "4.1.0",
            USER_DIR + "/abc123.fma",
            "/opt/fabmo/approot/approot/abc123.fma"
        );

        mgr._addApp(system);
        mgr._addApp(newer);

        expect(mgr.apps_index["fabmo-sb4"].version).toBe("4.1.0");
        // The losing system app's source must never be deleted
        const removed = fs.remove.mock.calls.map((c) => c[0]);
        expect(removed).not.toContain(mgr.system_app_directory + "/sb4.fma");
    });

    test("equal versions keep last-wins behavior (intentional same-version override)", () => {
        const mgr = makeManager();
        const system = entry(
            "tool_status",
            "0.2.0",
            mgr.system_app_directory + "/tool_status.fma",
            "/opt/fabmo/approot/approot/tool_status.fma"
        );
        const override = entry(
            "tool_status",
            "0.2.0",
            USER_DIR + "/def456.fma",
            "/opt/fabmo/approot/approot/def456.fma"
        );

        mgr._addApp(system);
        mgr._addApp(override);

        expect(mgr.apps_index["tool_status"].app_archive_path).toBe(USER_DIR + "/def456.fma");
    });

    test("unparseable versions keep last-wins behavior", () => {
        const mgr = makeManager();
        const a = entry("weird", "", USER_DIR + "/a.fma", "/approot/a.fma");
        const b = entry("weird", "", USER_DIR + "/b.fma", "/approot/b.fma");

        mgr._addApp(a);
        mgr._addApp(b);

        expect(mgr.apps_index["weird"].app_archive_path).toBe(USER_DIR + "/b.fma");
    });

    test("older stale copy outside the user app dir is ignored but not deleted", () => {
        const mgr = makeManager();
        const user = entry("someapp", "2.0.0", USER_DIR + "/new.fma", "/approot/new.fma");
        const profileStale = entry("someapp", "1.0.0", "/fabmo/profiles/foo/apps/old.fma", "/approot/old.fma");

        mgr._addApp(user);
        mgr._addApp(profileStale);

        expect(mgr.apps_index["someapp"].version).toBe("2.0.0");
        const removed = fs.remove.mock.calls.map((c) => c[0]);
        expect(removed).not.toContain("/fabmo/profiles/foo/apps/old.fma");
    });
});
