/*
 * JogIntent — the shared manual-jog gesture state machine (libs/jogintent.js).
 *
 * The core safety invariant under test: WITH NO SOURCE HELD, NOTHING MAY BE
 * LIVE — no pending start, no heartbeat, no typematic — no matter how presses
 * and releases interleave. Plus the behavioral contract each input adapter
 * relies on: tap => nudge, hold => heartbeat stream ending in exactly one
 * stop, fixed mode => step per press with typematic + backlog cancel.
 */

/* eslint-env jest */

var JogIntent = require("../dashboard/static/js/libs/jogintent");

function harness(opts) {
    var events = [];
    var fixed = { on: false };
    var intent = new JogIntent(
        Object.assign(
            {
                tapWindow: 200,
                refreshInterval: 50,
                repeatDelay: 600,
                repeatInterval: 250,
                getFixedMode: function () {
                    return fixed.on;
                },
            },
            opts || {}
        )
    );
    ["go", "stop", "nudge", "nudgeCancel"].forEach(function (e) {
        intent.on(e, function (d) {
            events.push({ e: e, d: d });
        });
    });
    return { intent: intent, events: events, fixed: fixed };
}

function names(events) {
    return events.map(function (ev) {
        return ev.e;
    });
}

// True if the stream would leave the server in continuous motion.
function serverMoving(events) {
    var moving = false;
    events.forEach(function (ev) {
        if (ev.e === "go") moving = true;
        if (ev.e === "stop") moving = false;
    });
    return moving;
}

var MOVE_UP = { axis: "z", dir: 1 };
var MOVE_DN = { axis: "z", dir: -1 };

describe("JogIntent", () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    test("tap -> one nudge, nothing live after", () => {
        var h = harness();
        h.intent.press("a", MOVE_DN);
        jest.advanceTimersByTime(80);
        h.intent.release("a");
        jest.advanceTimersByTime(2000);
        expect(names(h.events)).toEqual(["nudge"]);
        expect(h.intent.isActive()).toBe(false);
    });

    test("hold -> heartbeat stream, release -> exactly one stop", () => {
        var h = harness();
        h.intent.press("a", MOVE_DN);
        jest.advanceTimersByTime(400); // go at 200, beats every 50
        var gos = names(h.events).filter(function (n) {
            return n === "go";
        }).length;
        expect(gos).toBeGreaterThanOrEqual(4);
        h.intent.release("a");
        jest.advanceTimersByTime(2000);
        expect(names(h.events).filter(function (n) {
            return n === "stop";
        })).toHaveLength(1);
        expect(serverMoving(h.events)).toBe(false);
        expect(h.intent.isActive()).toBe(false);
    });

    test("rollover: second press takes the tap window; no motion after both release", () => {
        var h = harness();
        h.intent.press("up", MOVE_UP);
        jest.advanceTimersByTime(50);
        h.intent.press("dn", MOVE_DN); // inside up's window
        jest.advanceTimersByTime(30);
        h.intent.release("up"); // non-owner: ignored
        jest.advanceTimersByTime(30);
        h.intent.release("dn"); // owner: tap
        jest.advanceTimersByTime(3000); // the orphaned-timer runaway window
        expect(names(h.events)).toEqual(["nudge"]);
        expect(h.events[0].d).toBe(MOVE_DN);
        expect(serverMoving(h.events)).toBe(false);
        expect(h.intent.isActive()).toBe(false);
    });

    test("rollover with first key released last: still no motion", () => {
        var h = harness();
        h.intent.press("up", MOVE_UP);
        jest.advanceTimersByTime(50);
        h.intent.press("dn", MOVE_DN);
        jest.advanceTimersByTime(30);
        h.intent.release("dn"); // owner taps
        jest.advanceTimersByTime(30);
        h.intent.release("up");
        jest.advanceTimersByTime(3000);
        expect(serverMoving(h.events)).toBe(false);
        expect(h.intent.isActive()).toBe(false);
    });

    test("any release during continuous motion stops it", () => {
        var h = harness();
        h.intent.press("up", MOVE_UP);
        jest.advanceTimersByTime(300); // continuous
        h.intent.press("dn", MOVE_DN); // tracked, ignored
        h.intent.release("dn"); // ANY release ends motion
        expect(serverMoving(h.events)).toBe(false);
        // held key's auto-repeat must not restart motion
        h.intent.press("up", MOVE_UP);
        jest.advanceTimersByTime(1000);
        expect(serverMoving(h.events)).toBe(false);
    });

    test("auto-repeat of the owner never extends the tap window", () => {
        var h = harness();
        h.intent.press("a", MOVE_DN);
        jest.advanceTimersByTime(150);
        h.intent.press("a", MOVE_DN); // typematic repeat
        jest.advanceTimersByTime(60); // 210ms from the FIRST press
        expect(names(h.events)).toContain("go");
    });

    test("mode is captured at gesture start - flipping fixed mid-hold cannot morph the gesture", () => {
        var h = harness();
        h.fixed.on = false;
        h.intent.press("a", MOVE_DN);
        jest.advanceTimersByTime(300); // continuous motion running
        h.fixed.on = true; // user hits the Fixed toggle mid-hold
        jest.advanceTimersByTime(200);
        h.intent.release("a");
        // The release must still produce the stop continuous motion needs.
        expect(serverMoving(h.events)).toBe(false);
        expect(names(h.events)).toContain("stop");
    });

    test("fixed mode: step on press, typematic while held, backlog cancel on release", () => {
        var h = harness();
        h.fixed.on = true;
        h.intent.press("a", MOVE_DN);
        expect(names(h.events)).toEqual(["nudge"]); // immediate step
        jest.advanceTimersByTime(600 + 250 + 10); // repeatDelay (1st repeat) + one interval (2nd)
        expect(names(h.events).filter(function (n) {
            return n === "nudge";
        })).toHaveLength(3);
        h.intent.release("a");
        expect(names(h.events)).toContain("nudgeCancel"); // repeats fired -> cancel backlog
        expect(names(h.events)).not.toContain("go");
        expect(names(h.events)).not.toContain("stop"); // never feedhold a fixed gesture
        expect(h.intent.isActive()).toBe(false);
    });

    test("fixed mode: a plain tap sends no backlog cancel", () => {
        var h = harness();
        h.fixed.on = true;
        h.intent.press("a", MOVE_DN);
        jest.advanceTimersByTime(100); // released before any repeat
        h.intent.release("a");
        expect(names(h.events)).toEqual(["nudge"]);
    });

    test("fixed mode: alternating presses step per press", () => {
        var h = harness();
        h.fixed.on = true;
        h.intent.press("up", MOVE_UP);
        jest.advanceTimersByTime(40);
        h.intent.press("dn", MOVE_DN); // closes up's hold, steps down
        jest.advanceTimersByTime(40);
        h.intent.release("up");
        h.intent.release("dn");
        jest.advanceTimersByTime(2000);
        expect(names(h.events).filter(function (n) {
            return n === "nudge";
        })).toHaveLength(2);
        expect(serverMoving(h.events)).toBe(false);
        expect(h.intent.isActive()).toBe(false);
    });

    test("cancelAll ends a continuous gesture with a stop", () => {
        var h = harness();
        h.intent.press("a", MOVE_DN);
        jest.advanceTimersByTime(300);
        h.intent.cancelAll(); // blur / modal close / disable
        expect(serverMoving(h.events)).toBe(false);
        expect(h.intent.isActive()).toBe(false);
        jest.advanceTimersByTime(2000);
        expect(names(h.events).filter(function (n) {
            return n === "go";
        }).length).toBeLessThan(8); // heartbeat really died
    });

    test("cancelAll on an idle machine emits nothing", () => {
        var h = harness();
        h.intent.cancelAll();
        expect(h.events).toHaveLength(0);
    });

    test("lost release raced the tap timer: no start without the owner held", () => {
        var h = harness();
        h.intent.press("a", MOVE_DN);
        // Simulate the release being processed via cancelAll (blur) while
        // the tap timer is still pending.
        h.intent.cancelAll();
        jest.advanceTimersByTime(3000);
        expect(names(h.events)).not.toContain("go");
        expect(h.intent.isActive()).toBe(false);
    });

    test("keypad semantics: tapWindow 0 starts continuous motion on press", () => {
        var h = harness({ tapWindow: 0 });
        h.intent.press("btn", MOVE_DN);
        expect(names(h.events)).toContain("go"); // immediately, no tap window
        jest.advanceTimersByTime(200);
        h.intent.release("btn");
        expect(serverMoving(h.events)).toBe(false);
        expect(h.intent.isActive()).toBe(false);
    });

    test("keypad semantics: per-press fixed override beats getFixedMode", () => {
        var h = harness({ tapWindow: 0 });
        h.fixed.on = false; // global switch says continuous...
        h.intent.press("fixedBtn", MOVE_DN, true); // ...but this button is fixed
        expect(names(h.events)).toEqual(["nudge"]);
        h.intent.release("fixedBtn");
        expect(names(h.events)).not.toContain("go");
        expect(h.intent.isActive()).toBe(false);
    });

    test("keypad semantics: one-shot tap (press+release) is a single nudge", () => {
        var h = harness({ tapWindow: 0 });
        h.intent.press("btn", MOVE_DN, true);
        h.intent.release("btn");
        jest.advanceTimersByTime(2000);
        expect(names(h.events)).toEqual(["nudge"]);
        expect(h.intent.isActive()).toBe(false);
    });

    test("fixed mode: a fresh press during a hold steps and owns the gesture", () => {
        var h = harness();
        h.fixed.on = true;
        h.intent.press("up", MOVE_UP);
        jest.advanceTimersByTime(700); // one typematic repeat fired
        h.intent.press("dn", MOVE_DN); // closes up's hold (cancels backlog), steps down
        expect(names(h.events)).toContain("nudgeCancel");
        var nudges = h.events.filter(function (ev) {
            return ev.e === "nudge";
        });
        expect(nudges[nudges.length - 1].d).toBe(MOVE_DN);
        h.intent.release("up");
        h.intent.release("dn");
        jest.advanceTimersByTime(2000);
        expect(h.intent.isActive()).toBe(false);
        expect(serverMoving(h.events)).toBe(false);
    });

    test("a broken listener cannot wedge the state machine", () => {
        var h = harness();
        h.intent.on("go", function () {
            throw new Error("listener bug");
        });
        h.intent.press("a", MOVE_DN);
        jest.advanceTimersByTime(300);
        h.intent.release("a");
        expect(serverMoving(h.events)).toBe(false);
        expect(h.intent.isActive()).toBe(false);
    });
});
