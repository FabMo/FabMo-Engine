/*jshint esversion: 6 */
//
// SB3 accepted a comma after PAUSE as well as a space: "PAUSE,2" is the
// same statement as "PAUSE 2". Old part files use both.

const parser = require("../runtime/opensbp/parser");

function pause(line) {
    return parser.parse(line)[0];
}

describe("PAUSE with a comma after the word", () => {
    test("PAUSE,2 is a 2 second pause, like PAUSE 2", () => {
        const expected = { type: "pause", expr: 2, var: null, params: {} };
        expect(pause("PAUSE 2")).toMatchObject(expected);
        expect(pause("PAUSE,2")).toMatchObject(expected);
        expect(pause("PAUSE, 2")).toMatchObject(expected);
        expect(pause("PAUSE ,2")).toMatchObject(expected);
        expect(pause("pause,2")).toMatchObject(expected);
        expect(pause("PAUSE,.5")).toMatchObject({ type: "pause", expr: 0.5 });
    });

    test("a variable, an expression or a message may follow the comma", () => {
        expect(pause("PAUSE,&t")).toEqual(pause("PAUSE &t"));
        expect(pause("PAUSE,&t + 1")).toEqual(pause("PAUSE &t + 1"));
        expect(pause('PAUSE,"Change the bit"')).toEqual(pause('PAUSE "Change the bit"'));
        expect(pause('PAUSE,2, TITLE="Wait"')).toEqual(pause('PAUSE 2, TITLE="Wait"'));
    });

    test("PAUSE with nothing after it still waits for the operator", () => {
        const expected = { type: "pause", expr: null, var: null, params: {} };
        expect(pause("PAUSE")).toMatchObject(expected);
        expect(pause("PAUSE,")).toMatchObject(expected);
    });

    test("works after IF ... THEN and with a trailing comment", () => {
        expect(pause("IF &a = 1 THEN PAUSE,2").stmt).toMatchObject({ type: "pause", expr: 2 });
        expect(pause("PAUSE,2 'let the spindle spin up")).toMatchObject({ type: "pause", expr: 2 });
    });
});
