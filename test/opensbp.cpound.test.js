/*jshint esversion: 6 */
//
// SB3-style macro calls: C#,90 must work alongside CN,90 and C90.
// The PEG parser rewrites the C# mnemonic to C_POUND (handler names are
// plain identifiers), but the command table keys keep the SB3 spelling -
// _evaluateArguments translates back so the argument survives scrubbing.

const config = require("../config");
const { SBPRuntime } = require("../runtime/opensbp/opensbp");
const parser = require("../runtime/opensbp/parser");
const custom = require("../runtime/opensbp/commands/custom");

function makeRuntime() {
    config.opensbp = config.opensbp || {};
    config.opensbp._cache = config.opensbp._cache || { tempVariables: {}, variables: {} };
    return new SBPRuntime();
}

describe("C# macro call", () => {
    test("parses as a C_POUND command with the macro number", () => {
        expect(parser.parse("C#,90")[0]).toMatchObject({ type: "cmd", cmd: "C_POUND", args: [90] });
        expect(parser.parse("C#, 90")[0]).toMatchObject({ type: "cmd", cmd: "C_POUND", args: [90] });
    });

    test("CN and bare Cn forms are unchanged", () => {
        expect(parser.parse("CN,90")[0]).toMatchObject({ type: "cmd", cmd: "CN", args: [90] });
        expect(parser.parse("C90")[0]).toMatchObject({ type: "custom", index: 90 });
        expect(parser.parse("C3")[0]).toMatchObject({ type: "custom", index: 3 });
    });

    test("the macro number survives argument scrubbing", () => {
        const rt = makeRuntime();
        expect(rt._evaluateArguments("C_POUND", [90])).toEqual([90]);
    });

    test("argument-count check applies with the SB3 spelling in the message", () => {
        const rt = makeRuntime();
        expect(() => rt._evaluateArguments("C_POUND", [90, 1])).toThrow(/C# was given 2 values but takes at most 1/);
    });

    test("end to end: parsed C#,90 reaches runCustomCut with 90", () => {
        const rt = makeRuntime();
        const cmd = parser.parse("C#,90")[0];
        const args = rt._evaluateArguments(cmd.cmd, cmd.args);
        let ran = null;
        custom.C_POUND.call({ runCustomCut: (n) => { ran = n; } }, args, () => {});
        expect(ran).toBe(90);
    });

    test("a variable macro number evaluates", () => {
        const rt = makeRuntime();
        config.opensbp._cache.tempVariables.MYMACRO = 72;
        const cmd = parser.parse("C#,&MYMACRO")[0];
        const args = rt._evaluateArguments(cmd.cmd, cmd.args);
        expect(args).toEqual([72]);
    });
});
