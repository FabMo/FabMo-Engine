/* eslint-disable no-undef */
/*jshint esversion: 6 */
const EventEmitter = require("events").EventEmitter;
const fs = require("fs");
const path = require("path");

const ctrl = require("../pendant/cannedCutsController");

// Fake machine: emits status events, records runFile calls.
function makeMachine(initialStatus) {
    const m = new EventEmitter();
    m.status = Object.assign({ posx: 0, posy: 0, posz: 0, state: "manual" }, initialStatus || {});
    m.runFileCalls = [];
    m.runFile = function (filename, bypassInterlock) {
        m.runFileCalls.push({ filename, bypassInterlock });
    };
    return m;
}

describe("CannedCutsController: state machine", () => {
    test("starts idle with default circular_bore params", () => {
        const c = ctrl.create(makeMachine());
        expect(c.state).toBe("idle");
        expect(c.cutType).toBe("circular_bore");
        expect(c.params.diameter).toBe(0.5);
        c.close();
    });

    test("toggle: idle → active → idle", () => {
        const c = ctrl.create(makeMachine());
        const events = [];
        c.on("canned_cut_state", (e) => events.push(e));
        c.toggle();
        expect(c.state).toBe("active");
        expect(events[0].reason).toBe("enter");
        c.toggle();
        expect(c.state).toBe("idle");
        expect(events[1].reason).toBe("exit");
        c.close();
    });

    test("adjustParam only works in active state", () => {
        const c = ctrl.create(makeMachine());
        const original = c.params.diameter;
        c.adjustParam("diameter", 1);
        expect(c.params.diameter).toBe(original);  // ignored in idle
        c.toggle();
        c.adjustParam("diameter", 1);
        expect(c.params.diameter).toBeCloseTo(original + 0.0625);
        c.adjustParam("diameter", -2);
        expect(c.params.diameter).toBeCloseTo(original - 0.0625);
        c.close();
    });

    test("adjustParam clamps to bounds", () => {
        const c = ctrl.create(makeMachine());
        c.toggle();
        // Diameter min = 0.0625; push way under and confirm clamp.
        for (let i = 0; i < 20; i++) c.adjustParam("diameter", -1);
        expect(c.params.diameter).toBeCloseTo(0.0625);
        // Diameter max = 12; push way over and confirm clamp.
        for (let i = 0; i < 250; i++) c.adjustParam("diameter", 1);
        expect(c.params.diameter).toBe(12);
        c.close();
    });

    test("adjustParam ignores unknown params", () => {
        const c = ctrl.create(makeMachine());
        c.toggle();
        c.adjustParam("nonsense", 1);
        // params unchanged, no crash
        expect(c.params.diameter).toBe(0.5);
        c.close();
    });
});

describe("CannedCutsController: commit", () => {
    test("commit ignored when not active", () => {
        const m = makeMachine();
        const c = ctrl.create(m);
        const r = c.commit();
        expect(r.ok).toBe(false);
        expect(r.reason).toBe("not_active");
        expect(m.runFileCalls.length).toBe(0);
        c.close();
    });

    test("commit writes tmp file and calls runFile with bypassInterlock", () => {
        const m = makeMachine({ posx: 5, posy: 7, posz: 1 });
        const c = ctrl.create(m);
        c.toggle();
        const r = c.commit();
        expect(r.ok).toBe(true);
        expect(m.runFileCalls.length).toBe(1);
        expect(m.runFileCalls[0].bypassInterlock).toBe(true);
        expect(c.state).toBe("executing");
        const fname = m.runFileCalls[0].filename;
        expect(fname).toMatch(/canned-circular_bore-\d+\.nc$/);
        // File should contain G-code with center at the machine position.
        const content = fs.readFileSync(fname, "utf8");
        expect(content).toContain("G90 G61");
        expect(content).toMatch(/X5\.\d{4}/);
        expect(content).toMatch(/Y7\.\d{4}/);
        // Cleanup
        fs.unlinkSync(fname);
        c.close();
    });

    test("execution complete returns state to active on machine idle", () => {
        const m = makeMachine({ posx: 0, posy: 0, posz: 0 });
        const c = ctrl.create(m);
        c.toggle();
        c.commit();
        expect(c.state).toBe("executing");
        // Simulate machine returning to idle after file finishes.
        m.emit("status", { state: "running" });
        expect(c.state).toBe("executing");
        m.emit("status", { state: "idle" });
        expect(c.state).toBe("active");
        // Cleanup the tmp file from commit
        try { fs.unlinkSync(c._lastTempFile); } catch (_) { }
        c.close();
    });

    test("commit refuses when machine has no position reported", () => {
        const m = makeMachine();
        m.status = { state: "manual" };  // no posx/posy/posz
        const c = ctrl.create(m);
        c.toggle();
        const r = c.commit();
        expect(r.ok).toBe(false);
        expect(r.reason).toBe("no_position");
        c.close();
    });
});

describe("CannedCutsController: events", () => {
    test("emits canned_cut_state on every transition", () => {
        const m = makeMachine({ posx: 0, posy: 0, posz: 0 });
        const c = ctrl.create(m);
        const events = [];
        c.on("canned_cut_state", (e) => events.push(e.reason));
        c.toggle();           // enter
        c.adjustParam("diameter", 1);  // adjust:diameter
        c.commit();           // commit
        m.emit("status", { state: "idle" });  // done
        expect(events).toEqual(["enter", "adjust:diameter", "commit", "done"]);
        try { fs.unlinkSync(c._lastTempFile); } catch (_) { }
        c.close();
    });

    test("event payload includes current state, cutType, and params", () => {
        const c = ctrl.create(makeMachine());
        const seen = [];
        c.on("canned_cut_state", (e) => seen.push(e));
        c.toggle();
        expect(seen[0]).toMatchObject({
            state: "active",
            cutType: "circular_bore",
            reason: "enter",
        });
        expect(seen[0].params.diameter).toBe(0.5);
        c.close();
    });
});
