/*jshint esversion: 6 */
//
// Headless simulation (gcode preview, bounds check) runs SBPRuntime with no
// machine attached — this.machine is null. JS, VR, and ST reached straight
// through to this.machine.driver, so any file containing them (most
// post-processor output sets jog/ramp speeds in its header) crashed the
// simulation and the Previewer rendered an empty toolpath. These tests pin
// the fix: headless runs record the values and keep going; live runs still
// push every driver write.

const jog = require("../runtime/opensbp/commands/jog");
const value = require("../runtime/opensbp/commands/value");
const setting = require("../runtime/opensbp/commands/setting");

describe("speed/setting commands with no machine (headless preview)", () => {
    test("JS records jog speeds and completes", (done) => {
        const rt = { machine: null };
        jog.JS.call(rt, [6, 4], () => {
            expect(rt.jogspeed_xy).toBe(6);
            expect(rt.jogspeed_z).toBe(4);
            done();
        });
    });

    test("VR records ramp values and completes", (done) => {
        const rt = { machine: null };
        value.VR.call(rt, [100, 50, undefined, undefined, undefined, 0.02, 0.01], () => {
            expect(rt.maxjerk_xy).toBe(100);
            expect(rt.maxjerk_z).toBe(50);
            expect(rt.jt).toBe(0.02);
            expect(rt.chordalTol).toBe(0.01);
            done();
        });
    });

    test("ST is a no-op and completes", (done) => {
        setting.ST.call({ machine: null }, [], done);
    });
});

describe("the same commands with a live machine still write to the driver", () => {
    test("JS pushes per-axis vm values", (done) => {
        const sent = [];
        const rt = { machine: { driver: { command: (o) => sent.push(o) } } };
        jog.JS.call(rt, [6, 4], () => {
            expect(sent).toEqual([{ xvm: 360 }, { yvm: 360 }, { zvm: 240 }]);
            done();
        });
    });

    test("VR pushes jerk/jt/ct values", (done) => {
        const sent = [];
        const rt = { machine: { driver: { command: (o) => sent.push(o) } } };
        value.VR.call(rt, [100, undefined, undefined, undefined, undefined, 0.02], () => {
            expect(sent).toEqual([{ xjm: 100 }, { yjm: 100 }, { jt: 0.02 }]);
            done();
        });
    });
});
