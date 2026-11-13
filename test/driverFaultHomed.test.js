/*jshint esversion: 6 */
// A drive fault marks the machine as not homed (XYHOMED / ZHOMED temp
// variables), once per fault, and only for drive-fault inputs.
const config = require("../config");
const Machine = require("../machine").private_Machine;

function setup(assignments) {
    const sets = [];
    config.machine = { get: (k) => assignments[k] };
    config.opensbp = {
        setTempVariable: (id, value, cb) => {
            sets.push(id.name + "=" + value);
            if (cb) cb();
        },
    };
    const m = { driver: { status: {} } };
    m.isDriverFaultInputActive = Machine.prototype.isDriverFaultInputActive;
    const edge = () => Machine.prototype._checkDriverFaultEdge.call(m);
    return { m, sets, edge };
}

describe("driver fault clears homed state", () => {
    const saved = { machine: config.machine, opensbp: config.opensbp };
    afterAll(() => {
        config.machine = saved.machine;
        config.opensbp = saved.opensbp;
    });

    test("nothing happens while no fault input is active", () => {
        const { sets, edge } = setup({});
        edge();
        expect(sets).toEqual([]);
    });

    test("unassigned input 15 going active marks XY and Z not homed, once", () => {
        const { m, sets, edge } = setup({});
        m.driver.status.in15 = 1;
        edge();
        expect(sets).toEqual(["XYHOMED=false", "ZHOMED=false"]);
        edge(); // still active: no repeat
        expect(sets.length).toBe(2);
    });

    test("a second fault after the input clears marks it again", () => {
        const { m, sets, edge } = setup({});
        m.driver.status.in15 = 1;
        edge();
        m.driver.status.in15 = 0;
        edge();
        m.driver.status.in15 = 1;
        edge();
        expect(sets.length).toBe(4);
    });

    test("an input assigned driverFault counts; other assignments do not", () => {
        const { m, sets, edge } = setup({ di3ac: "driverFault", di2ac: "interlock", di15ac: "none" });
        m.driver.status.in2 = 1;
        edge();
        expect(sets).toEqual([]);
        m.driver.status.in3 = 1;
        edge();
        expect(sets).toEqual(["XYHOMED=false", "ZHOMED=false"]);
    });

    test("input 15 assigned to something else is not a drive fault", () => {
        const { m, sets, edge } = setup({ di15ac: "stop" });
        m.driver.status.in15 = 1;
        edge();
        expect(sets).toEqual([]);
    });
});
