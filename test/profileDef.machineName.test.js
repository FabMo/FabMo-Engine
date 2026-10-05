// machine_name kept in fabmo-def.json (so the user's tool name survives updates)
var fs = require("fs");
var os = require("os");
var path = require("path");
var profileDef = require("../config/profile_definition");

describe("profile_definition machine_name", function () {
    var dir;

    beforeEach(function () {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "fabmo-def-"));
        profileDef.definition_file = path.join(dir, "fabmo-def.json");
        profileDef.applied_marker = path.join(dir, ".auto_profile_applied");
        fs.writeFileSync(
            profileDef.definition_file,
            JSON.stringify({
                auto_profile: { enabled: true, profile_name: "fabmo-profile-dt", apply_once: true },
                machine_name: "",
                owner: "someone",
            })
        );
    });

    afterEach(function () {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    function setName(name) {
        return new Promise(function (resolve) {
            profileDef.setMachineName(name, resolve);
        });
    }

    function readDef() {
        return JSON.parse(fs.readFileSync(profileDef.definition_file, "utf8"));
    }

    test("blank or missing name reads as empty", function () {
        expect(profileDef.getMachineName()).toBe("");
        fs.unlinkSync(profileDef.definition_file);
        expect(profileDef.getMachineName()).toBe("");
    });

    test("set writes the name and preserves everything else", function () {
        return setName("  Shop Tool 1 ").then(function (err) {
            expect(err).toBeFalsy();
            var def = readDef();
            expect(def.machine_name).toBe("Shop Tool 1");
            expect(def.owner).toBe("someone");
            expect(def.auto_profile.profile_name).toBe("fabmo-profile-dt");
            expect(def.auto_profile.apply_once).toBe(true);
            expect(profileDef.getMachineName()).toBe("Shop Tool 1");
        });
    });

    test("blank name clears it", function () {
        return setName("Shop Tool 1")
            .then(function () {
                return setName("");
            })
            .then(function () {
                expect(readDef().machine_name).toBe("");
                expect(profileDef.getMachineName()).toBe("");
            });
    });

    test("existing marker follows the name; a marker is never created", function () {
        return setName("Shop Tool 1")
            .then(function () {
                expect(fs.existsSync(profileDef.applied_marker)).toBe(false);
                fs.writeFileSync(
                    profileDef.applied_marker,
                    JSON.stringify({ profile_applied: "fabmo-profile-dt", in_progress: false, user_choice: "keep" })
                );
                return setName("Shop Tool 2");
            })
            .then(function () {
                var marker = JSON.parse(fs.readFileSync(profileDef.applied_marker, "utf8"));
                expect(marker.machine_name).toBe("Shop Tool 2");
                expect(marker.user_choice).toBe("keep");
                expect(marker.in_progress).toBe(false);
            });
    });
});
