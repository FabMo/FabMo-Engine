/*
 * Keypad wedged after a quick close-and-reopen (11/25/2026).
 *
 * Sequence from the log: enter, exit, enter within half a second. The second
 * enter arrived while the first session's cycle stream was still closing, so
 * the runtime scheduled a retry. By the time the retry fired the stream had
 * finished and the machine had gone idle and switched away from the manual
 * runtime. The retry called enter() directly: it opened a new stream on a
 * runtime the machine no longer listened to, the "manual" state change was
 * ignored, and every later enter was refused with "stream still active"
 * until the engine was restarted.
 *
 * Fix under test: the retry goes back through machine.executeRuntimeCode, so
 * the machine makes the manual runtime current again before it enters.
 */
"use strict";

jest.mock("../runtime/manual/driver", () => {
    var EventEmitter = require("events").EventEmitter;
    function FakeManualDriver(driver, stream) {
        EventEmitter.call(this);
        this.driver = driver;
        this.stream = stream;
        this.exit = jest.fn();
    }
    FakeManualDriver.prototype = Object.create(EventEmitter.prototype);
    FakeManualDriver.prototype.enter = function () {
        return Promise.resolve();
    };
    return FakeManualDriver;
});

var EventEmitter = require("events").EventEmitter;
var ManualRuntime = require("../runtime/manual/index").ManualRuntime;

// A machine that behaves like the real one where it matters here: state
// changes from a runtime that is not current are ignored, going idle switches
// away from the runtime, and runtime code is routed through the current one.
function makeRig() {
    var drv = new EventEmitter();
    var streams = []; // one {resolve} per runStream call
    drv.runStream = jest.fn(function () {
        return new Promise(function (resolve) {
            streams.push({ resolve: resolve });
        });
    });

    var rt = new ManualRuntime();
    var machine = {
        driver: drv,
        status: { state: "idle" },
        current: null,
        ignored: 0,
        emit: jest.fn(),
        setState: function (source, state) {
            if (source !== this.current) {
                this.ignored += 1;
                return;
            }
            this.status.state = state;
            if (state === "idle") {
                this.current.disconnect();
                this.current = null;
            }
        },
        executeRuntimeCode: jest.fn(function (name, code) {
            if (this.current !== rt) {
                this.current = rt;
                rt.connect(this);
            }
            rt.executeCode(code);
        }),
    };
    // End the Nth session's stream, as the driver does after the exit M30.
    function finish(n) {
        streams[n].resolve();
        return Promise.resolve().then(function () {});
    }
    return { rt: rt, machine: machine, drv: drv, streams: streams, finish: finish };
}

describe("manual re-enter while the previous session is still closing", () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });
    afterEach(() => {
        jest.useRealTimers();
    });

    test("enter / exit / enter in quick succession ends in a working manual session", async () => {
        var t = makeRig();
        t.machine.executeRuntimeCode("manual", { cmd: "enter" });
        expect(t.machine.status.state).toBe("manual");
        t.machine.executeRuntimeCode("manual", { cmd: "exit" });
        t.machine.executeRuntimeCode("manual", { cmd: "enter" }); // refused: stream still closing
        expect(t.drv.runStream).toHaveBeenCalledTimes(1);

        await t.finish(0); // first session ends; machine goes idle and switches away
        expect(t.machine.status.state).toBe("idle");
        expect(t.machine.current).toBe(null);

        jest.advanceTimersByTime(100);
        expect(t.drv.runStream).toHaveBeenCalledTimes(2);
        expect(t.machine.current).toBe(t.rt); // the machine is listening to it again
        expect(t.machine.status.state).toBe("manual");
        expect(t.machine.ignored).toBe(0); // no state change fell on the floor

        // And the session can be closed and reopened normally afterwards.
        t.machine.executeRuntimeCode("manual", { cmd: "exit" });
        await t.finish(1);
        expect(t.machine.status.state).toBe("idle");
        t.machine.executeRuntimeCode("manual", { cmd: "enter" });
        expect(t.machine.status.state).toBe("manual");
        expect(t.drv.runStream).toHaveBeenCalledTimes(3);
    });

    test("keeps waiting while the old stream is slow to close", async () => {
        var t = makeRig();
        t.machine.executeRuntimeCode("manual", { cmd: "enter" });
        t.machine.executeRuntimeCode("manual", { cmd: "exit" });
        t.machine.executeRuntimeCode("manual", { cmd: "enter", hideKeypad: true });
        jest.advanceTimersByTime(700);
        expect(t.drv.runStream).toHaveBeenCalledTimes(1);
        await t.finish(0);
        jest.advanceTimersByTime(100);
        expect(t.machine.status.state).toBe("manual");
        expect(t.machine.status.hideKeypad).toBe(true);
    });

    test("gives up if the old stream never closes, without leaving anything behind", async () => {
        var t = makeRig();
        t.machine.executeRuntimeCode("manual", { cmd: "enter" });
        t.machine.executeRuntimeCode("manual", { cmd: "exit" });
        t.machine.executeRuntimeCode("manual", { cmd: "enter" });
        jest.advanceTimersByTime(5000);
        expect(t.drv.runStream).toHaveBeenCalledTimes(1);
        expect(jest.getTimerCount()).toBe(0);
        // The stream closing later does not open the keypad on its own...
        await t.finish(0);
        jest.advanceTimersByTime(1000);
        expect(t.machine.status.state).toBe("idle");
        // ...but a fresh request works.
        t.machine.executeRuntimeCode("manual", { cmd: "enter" });
        expect(t.machine.status.state).toBe("manual");
    });

    test("closing the keypad while the enter is waiting cancels it", async () => {
        var t = makeRig();
        t.machine.executeRuntimeCode("manual", { cmd: "enter" });
        t.machine.executeRuntimeCode("manual", { cmd: "exit" });
        t.machine.executeRuntimeCode("manual", { cmd: "enter" });
        t.machine.executeRuntimeCode("manual", { cmd: "exit" });
        await t.finish(0);
        jest.advanceTimersByTime(1000);
        expect(t.drv.runStream).toHaveBeenCalledTimes(1);
        expect(t.machine.status.state).toBe("idle");
    });

    test("does not open the keypad if something else took the machine meanwhile", async () => {
        var t = makeRig();
        t.machine.executeRuntimeCode("manual", { cmd: "enter" });
        t.machine.executeRuntimeCode("manual", { cmd: "exit" });
        t.machine.executeRuntimeCode("manual", { cmd: "enter" });
        await t.finish(0);
        t.machine.status.state = "running";
        jest.advanceTimersByTime(1000);
        expect(t.drv.runStream).toHaveBeenCalledTimes(1);
        expect(t.machine.executeRuntimeCode).toHaveBeenCalledTimes(3);
    });
});
