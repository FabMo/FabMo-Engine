/*jshint esversion: 6 */
//
// Output-change notification timing (machine.outputs.<n>.notify_on_timing /
// notify_off_timing).
//
// "before" (default): an SO for a notify-enabled output pauses first and
// drives the output after the operator resumes.
//
// "after": the output is driven first, the program waits for G2 to execute
// it, and only then pauses with the message. This is for a spindle that also
// needs its start button pressed: the operator must see it start while the
// message is still on screen. After resume the SO is not run a second time.

const config = require("../config");
const { SBPRuntime } = require("../runtime/opensbp/opensbp");

function makeRuntime(output1) {
    config.opensbp = config.opensbp || {};
    config.opensbp._cache = config.opensbp._cache || { tempVariables: {}, variables: {} };
    config.machine._cache = config.machine._cache || {};
    config.machine._cache.outputs = { 1: Object.assign({ label: "Spindle 1" }, output1) };

    const rt = new SBPRuntime();
    rt.emitted = [];
    rt.emit_gcode = function (g) {
        rt.emitted.push(g);
        rt.gcodesPending = true;
    };
    rt.prime = function () {};
    rt.states = [];
    rt.machine = {
        driver: { pause_hold: false },
        setState: function (source, state, info) {
            rt.states.push({ state: state, message: info && info.message });
        },
    };
    rt.program = [{ type: "cmd", cmd: "SO", args: [1, 1] }];
    rt.pc = 0;
    return rt;
}

// One dispatch of the current line, the way _executeNext does it once G2 is
// stopped. Returns true if the line was treated as stack-breaking.
function visit(rt) {
    const line = rt.program[rt.pc];
    const breaks = rt._breaksStack(line);
    rt._execute(line, function () {});
    return breaks;
}

describe("SO notify timing", () => {
    beforeAll((done) => {
        // Commands (SO among them) are attached to the prototype at engine start
        new SBPRuntime().loadCommands(done);
    });

    test("before: pauses first, drives the output after resume", () => {
        const rt = makeRuntime({ notify_on: "always", notify_on_timing: "before" });

        expect(visit(rt)).toBe(true);
        expect(rt.emitted).toEqual([]);
        expect(rt.paused).toBe(true);
        expect(rt.states.length).toBe(1);
        expect(rt.states[0].message).toMatch(/will turn ON/);
        expect(rt.pc).toBe(0);

        rt.paused = false; // operator resumes
        visit(rt);
        expect(rt.emitted).toEqual(["M3"]);
        expect(rt.pc).toBe(1);
        expect(rt.states.length).toBe(1);
    });

    test("after: drives the output, waits for it, then pauses; no second SO on resume", () => {
        const rt = makeRuntime({ notify_on: "always", notify_on_timing: "after" });

        // Visit 1: output driven, no pause yet, pc held on the SO
        expect(visit(rt)).toBe(true);
        expect(rt.emitted).toEqual(["M3"]);
        expect(rt.paused).toBeFalsy();
        expect(rt.states.length).toBe(0);
        expect(rt.pc).toBe(0);
        // The revisit must break the stack so it waits for G2 to run the M3
        expect(rt._breaksStack(rt.program[0])).toBe(true);

        // Visit 2 (G2 has stopped): now the message
        rt.gcodesPending = false;
        visit(rt);
        expect(rt.paused).toBe(true);
        expect(rt.machine.driver.pause_hold).toBe(true);
        expect(rt.states.length).toBe(1);
        expect(rt.states[0].state).toBe("paused");
        expect(rt.states[0].message).toMatch(/is now ON/);
        expect(rt.emitted).toEqual(["M3"]);
        expect(rt.pc).toBe(0);

        // Visit 3 (resumed): step past, do not drive the output again
        rt.paused = false;
        visit(rt);
        expect(rt.emitted).toEqual(["M3"]);
        expect(rt.pc).toBe(1);
        expect(rt.states.length).toBe(1);
        expect(rt._notifyAfter).toBe(null);
    });

    test("after + once per cut: second SO in the same run does not notify", () => {
        const rt = makeRuntime({ notify_on: "once", notify_on_timing: "after" });
        rt.program.push({ type: "cmd", cmd: "SO", args: [1, 1] });

        visit(rt); // drive
        // "once" is now used up, but the pending revisit must still break the stack
        expect(rt._breaksStack(rt.program[0])).toBe(true);
        visit(rt); // show
        expect(rt.states.length).toBe(1);
        rt.paused = false;
        visit(rt); // step past
        expect(rt.pc).toBe(1);

        expect(visit(rt)).toBe(false);
        expect(rt.emitted).toEqual(["M3", "M3"]);
        expect(rt.states.length).toBe(1);
        expect(rt.pc).toBe(2);
    });

    test("custom message is used verbatim in after mode", () => {
        const rt = makeRuntime({
            notify_on: "always",
            notify_on_timing: "after",
            notify_on_message: "Press the green start button.",
        });
        visit(rt);
        visit(rt);
        expect(rt.states[0].message).toBe("Press the green start button.");
    });

    test("timing normalizes to before unless it is exactly after", () => {
        config.machine._cache.outputs = {
            1: { notify_on: "always", notify_on_timing: "after", notify_off_timing: 0 },
            2: { notify_on: "always" },
        };
        config.machine._normalizeOutputNotify();
        expect(config.machine._cache.outputs[1].notify_on_timing).toBe("after");
        expect(config.machine._cache.outputs[1].notify_off_timing).toBe("before");
        expect(config.machine._cache.outputs[2].notify_on_timing).toBe("before");
    });
});
