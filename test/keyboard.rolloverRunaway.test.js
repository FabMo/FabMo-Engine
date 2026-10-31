/*
 * Regression tests for the keypad-keyboard rapid-tap runaway (field reports,
 * Oct 2026): tapping two jog keys (typically Z up/down) fast enough that the
 * presses overlap ("rollover") orphaned the first key's pending nudgeTimer in
 * onKeyDown. The orphaned timer fired AFTER both keys were released, called
 * start(), and began continuous motion with no keyup left to stop it. The
 * server's renew loop self-sustains, so the machine ran away until another
 * jog key was tapped or the keypad was closed.
 *
 * These tests drive dashboard/static/js/libs/keyboard.js with synthetic key
 * events under fake timers and assert the invariant the bug violated: once
 * no jog key is physically down, no "go" may be emitted without a following
 * "stop".
 */

/* eslint-env jest */

const PGUP = 33; // Z+
const PGDN = 34; // Z-

function jqStub(fixedState) {
    function jqObj(sel) {
        return {
            attr() {
                return this;
            },
            on() {
                return this;
            },
            is() {
                return sel === ".fixed-switch input" ? fixedState.checked : false;
            },
            addClass() {
                return this;
            },
            removeClass() {
                return this;
            },
            find() {
                return this;
            },
            hasClass() {
                return false;
            },
            focus() {
                return this;
            },
            trigger() {
                return this;
            },
        };
    }
    return function (sel) {
        return jqObj(sel);
    };
}

function makeKeyboard(fixedState) {
    global.window = { addEventListener() {}, removeEventListener() {} };
    global.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
    global.$ = jqStub(fixedState);
    jest.resetModules();
    const Keyboard = require("../dashboard/static/js/libs/keyboard");
    const kb = new Keyboard(null, { nudgeTimeout: 200, refreshInterval: 50 });
    kb.setEnabled(true);
    const events = [];
    ["go", "stop", "nudge", "nudgeCancel"].forEach((e) => kb.on(e, () => events.push(e)));
    return { kb, events };
}

function keydown(kb, code) {
    kb.onKeyDown({ keyCode: code, altKey: false, target: { tagName: "DIV" }, preventDefault() {} });
}

function keyup(kb, code) {
    kb.onKeyUp({ keyCode: code, altKey: false, target: { tagName: "DIV" }, preventDefault() {} });
}

// True if the event stream would leave the server in continuous motion
function serverMoving(events) {
    let moving = false;
    for (const e of events) {
        if (e === "go") moving = true;
        if (e === "stop") moving = false;
    }
    return moving;
}

describe("keyboard jog rollover runaway", () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });
    afterEach(() => {
        jest.useRealTimers();
    });

    test("two-key rollover must not start motion after both keys are released", () => {
        const { kb, events } = makeKeyboard({ checked: false });
        keydown(kb, PGUP);
        jest.advanceTimersByTime(50);
        keydown(kb, PGDN); // rollover inside PGUP's tap window
        jest.advanceTimersByTime(30);
        keyup(kb, PGUP);
        jest.advanceTimersByTime(30);
        keyup(kb, PGDN);
        // The orphaned PGUP timer would have fired ~90ms from now and pumped
        // "go" forever; give any stray timers ample time to misbehave.
        jest.advanceTimersByTime(3000);
        expect(serverMoving(events)).toBe(false);
        expect(kb.going).toBe(false);
        expect(kb.interval).toBeFalsy();
    });

    test("repeated fast rollover cycles never leave motion running", () => {
        const { kb, events } = makeKeyboard({ checked: false });
        for (let i = 0; i < 4; i++) {
            keydown(kb, PGUP);
            jest.advanceTimersByTime(40);
            keydown(kb, PGDN);
            jest.advanceTimersByTime(25);
            keyup(kb, PGUP);
            jest.advanceTimersByTime(25);
            keyup(kb, PGDN);
            jest.advanceTimersByTime(40);
        }
        jest.advanceTimersByTime(3000);
        expect(serverMoving(events)).toBe(false);
        expect(kb.going).toBe(false);
    });

    test("rollover with first key released last must not start motion", () => {
        const { kb, events } = makeKeyboard({ checked: false });
        keydown(kb, PGUP);
        jest.advanceTimersByTime(50);
        keydown(kb, PGDN);
        jest.advanceTimersByTime(30);
        keyup(kb, PGDN);
        jest.advanceTimersByTime(30);
        keyup(kb, PGUP);
        jest.advanceTimersByTime(3000);
        expect(serverMoving(events)).toBe(false);
        expect(kb.going).toBe(false);
    });

    test("hold past the tap window still starts and stops continuous motion", () => {
        const { kb, events } = makeKeyboard({ checked: false });
        keydown(kb, PGDN);
        jest.advanceTimersByTime(400); // timer fires at 200ms -> continuous
        expect(events).toContain("go");
        keyup(kb, PGDN);
        jest.advanceTimersByTime(1000);
        expect(serverMoving(events)).toBe(false);
        expect(kb.going).toBe(false);
    });

    test("quick taps still produce nudges, one per tap", () => {
        const { kb, events } = makeKeyboard({ checked: false });
        for (let i = 0; i < 3; i++) {
            keydown(kb, PGDN);
            jest.advanceTimersByTime(60);
            keyup(kb, PGDN);
            jest.advanceTimersByTime(60);
        }
        jest.advanceTimersByTime(1000);
        expect(events.filter((e) => e === "nudge").length).toBe(3);
        expect(serverMoving(events)).toBe(false);
    });

    test("auto-repeat keydowns inside the tap window don't postpone continuous start", () => {
        const { kb, events } = makeKeyboard({ checked: false });
        keydown(kb, PGDN);
        jest.advanceTimersByTime(80);
        keydown(kb, PGDN); // typematic repeat of the same key
        jest.advanceTimersByTime(80);
        keydown(kb, PGDN);
        // Original timer must still fire at 200ms from the FIRST press
        jest.advanceTimersByTime(60);
        expect(events).toContain("go");
        keyup(kb, PGDN);
        jest.advanceTimersByTime(1000);
        expect(serverMoving(events)).toBe(false);
    });

    test("fixed mode: rollover taps only nudge, never start continuous motion", () => {
        const { kb, events } = makeKeyboard({ checked: true });
        keydown(kb, PGUP);
        jest.advanceTimersByTime(50);
        keydown(kb, PGDN);
        jest.advanceTimersByTime(30);
        keyup(kb, PGUP);
        jest.advanceTimersByTime(30);
        keyup(kb, PGDN);
        jest.advanceTimersByTime(3000);
        expect(events).not.toContain("go");
        expect(kb.going).toBe(false);
    });
});
