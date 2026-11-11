/*
 * JogIntent reports WHY a gesture ended on its stop/nudgeCancel payload, so
 * the host can forward it to the engine's manual-gesture log.
 */
"use strict";

var JogIntent = require("../dashboard/static/js/libs/jogintent");

describe("JogIntent end reasons", () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    function continuous() {
        var ji = new JogIntent({ tapWindow: 0 });
        var stops = [];
        ji.on("stop", (e) => stops.push(e));
        ji.press("k", { axis: "x", dir: 1 });
        return { ji: ji, stops: stops };
    }

    test("a delivered release reports 'release'", () => {
        var c = continuous();
        c.ji.release("k");
        expect(c.stops).toEqual([{ reason: "release" }]);
    });

    test("cancelAll carries the adapter's reason", () => {
        var c = continuous();
        c.ji.cancelAll("buttons_up");
        expect(c.stops).toEqual([{ reason: "buttons_up" }]);
    });

    test("cancelAll without a reason reports 'cancel', and never leaks into the next gesture", () => {
        var c = continuous();
        c.ji.cancelAll();
        c.ji.press("k", { axis: "x", dir: 1 });
        c.ji.release("k");
        expect(c.stops).toEqual([{ reason: "cancel" }, { reason: "release" }]);
    });

    test("cancelAll while idle emits nothing", () => {
        var ji = new JogIntent({ tapWindow: 0 });
        var stops = [];
        ji.on("stop", (e) => stops.push(e));
        ji.cancelAll("window_blur");
        expect(stops).toEqual([]);
    });

    test("a fixed hold with repeats reports its reason on nudgeCancel", () => {
        var ji = new JogIntent({ tapWindow: 0, repeatDelay: 100, repeatInterval: 50 });
        var cancels = [];
        ji.on("nudgeCancel", (e) => cancels.push(e));
        ji.press("b", { axis: "x", dir: 1 }, true);
        jest.advanceTimersByTime(300);
        ji.cancelAll("mouse_slide_off");
        expect(cancels).toEqual([{ reason: "mouse_slide_off" }]);
    });
});
