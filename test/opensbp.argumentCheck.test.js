/*jshint esversion: 6 */
//
// Command-argument checks in SBPRuntime._evaluateArguments, driven by the
// command table (runtime/opensbp/sb3_commands.json):
//   - a value beyond a command's last defined parameter is an error
//   - empty trailing slots ("MX, " / "M2, , ,") are not
//   - a value for a numeric parameter must evaluate to a number
// and the matching leniency in the single-axis moves (MX..MC): no value, no move.

const config = require("../config");
const { SBPRuntime } = require("../runtime/opensbp/opensbp");
const move = require("../runtime/opensbp/commands/move");

function makeRuntime() {
    config.opensbp = config.opensbp || {};
    config.opensbp._cache = config.opensbp._cache || { tempVariables: {}, variables: {} };
    return new SBPRuntime();
}

describe("argument count against the command table", () => {
    test("a value beyond the last parameter is an error", () => {
        const rt = makeRuntime();
        expect(() => rt._evaluateArguments("MX", [3, 4])).toThrow(/MX was given 2 values but takes at most 1/);
        expect(() => rt._evaluateArguments("M2", ["", "", 1])).toThrow(/M2 was given 3 values/);
    });

    test("an empty slot followed by a value still counts the value", () => {
        const rt = makeRuntime();
        expect(() => rt._evaluateArguments("MX", ["", 4])).toThrow(/MX was given 2 values/);
    });

    test("empty trailing slots are ignored (PEG parser gives '', fastParse gives undefined)", () => {
        const rt = makeRuntime();
        expect(rt._evaluateArguments("MX", [""])).toEqual([undefined]);
        expect(rt._evaluateArguments("M2", ["", "", ""])).toEqual([undefined, undefined]);
        expect(rt._evaluateArguments("M2", [undefined, undefined, undefined])).toEqual([undefined, undefined]);
    });

    test("a command with no parameters accepts an empty slot but not a value", () => {
        const rt = makeRuntime();
        expect(rt._evaluateArguments("SV", [""])).toEqual([]);
        expect(() => rt._evaluateArguments("SV", [1])).toThrow(/SV was given 1 value but takes none/);
    });

    test("CR accepts its nine documented parameters and rejects a tenth", () => {
        const rt = makeRuntime();
        const nine = [4, 3, "I", 1, 4, -0.25, 2, 3, 1];
        expect(rt._evaluateArguments("CR", nine).length).toBe(9);
        expect(() => rt._evaluateArguments("CR", nine.concat([45]))).toThrow(
            /CR was given 10 values but takes at most 9/,
        );
    });
});

describe("argument type against the command table", () => {
    test("a numeric parameter rejects a non-numeric value", () => {
        const rt = makeRuntime();
        expect(() => rt._evaluateArguments("MX", ["abc"])).toThrow(
            /MX parameter 1 \(New X location\) must be a number, got "abc"/,
        );
        expect(() => rt._evaluateArguments("M2", ["abc", 1])).toThrow(/M2 parameter 1/);
    });

    test("numeric literals pass, as numbers", () => {
        const rt = makeRuntime();
        expect(rt._evaluateArguments("MX", [3])).toEqual([3]);
        expect(rt._evaluateArguments("MX", ["3.5"])).toEqual([3.5]);
        expect(rt._evaluateArguments("M2", [1, 2])).toEqual([1, 2]);
    });

    test("option-list parameters are not type checked (CR cutter compensation I/O/T)", () => {
        const rt = makeRuntime();
        expect(rt._evaluateArguments("CR", [2, 3, "I"])[2]).toBe("I");
    });
});

describe("single-axis moves with no value", () => {
    function fakeRuntime() {
        return {
            movespeed_xy: 1,
            movespeed_z: 1,
            movespeed_a: 1,
            movespeed_b: 1,
            movespeed_c: 1,
            cmd_posx: 0,
            cmd_posz: 0,
            moves: [],
            emit_move: function (code, params) {
                this.moves.push(params);
            },
        };
    }

    test("MX with no value does nothing and does not throw", () => {
        const rt = fakeRuntime();
        move.MX.call(rt, [undefined]);
        move.MX.call(rt, [""]);
        expect(rt.moves).toEqual([]);
    });

    test("MX with a value still moves", () => {
        const rt = fakeRuntime();
        move.MX.call(rt, [3]);
        expect(rt.moves.length).toBe(1);
        expect(rt.moves[0].X).toBe(3);
        expect(rt.cmd_posx).toBe(3);
    });

    test("MZ with a non-number still throws (backstop behind the table check)", () => {
        const rt = fakeRuntime();
        expect(() => move.MZ.call(rt, ["abc"])).toThrow(/Invalid MZ argument/);
    });
});
