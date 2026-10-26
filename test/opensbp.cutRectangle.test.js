/*jshint esversion: 6 */
//
// CR (cut rectangle): the handler was reduced to the nine parameters in the
// OpenSBP Command Reference. test/fixtures/cr_golden.json holds the g-code the
// previous handler emitted for the documented parameter space (captured before
// the cleanup), so these tests prove the cleanup changed nothing a file can
// reach. The table entry must match: nine parameters, pocket values 2 and 3.

const config = require("../config");
const golden = require("./fixtures/cr_golden.json");
const table = require("../runtime/opensbp/sb3_commands.json");

config.opensbp = config.opensbp || {};
config.opensbp.get = (k) => ({ cutterDia: 0.25, pocketOverlap: 50, safeZpullUp: 0.5 })[k];
const cut = require("../runtime/opensbp/commands/cut");

function runCR(args) {
    const out = [];
    const rt = {
        cmd_posx: 1,
        cmd_posy: 2,
        cmd_posz: 0.1,
        movespeed_xy: 2,
        lastNoZPullup: 0,
        emit_gcode: (s) => out.push(s),
        emit_move: (code, p) => out.push(code + JSON.stringify(p)),
    };
    cut.CR.call(rt, args);
    return out;
}

describe("CR emits the same g-code as before the cleanup", () => {
    // JSON has no undefined: an omitted parameter is stored as null in the fixture,
    // but the runtime's argument scrubber hands the handler undefined.
    const fromFixture = (args) => args.map((a) => (a === null ? undefined : a));
    test.each(Object.keys(golden))("%s", (name) => {
        expect(runCR(fromFixture(golden[name].args))).toEqual(golden[name].gcode);
    });
});

describe("CR command table", () => {
    test("has exactly the nine documented parameters", () => {
        expect(table.CR.params.map((p) => p.abrev)).toEqual([
            "lenX",
            "lenY",
            "OIT",
            "Dr",
            "sCorn",
            "Plg",
            "Rp",
            "tf",
            "z0",
        ]);
    });

    test("pocket parameter offers only outside-in (2) and inside-out (3)", () => {
        expect(table.CR.params[7].opts.map((o) => o.value)).toEqual(["2", "3"]);
    });
});
