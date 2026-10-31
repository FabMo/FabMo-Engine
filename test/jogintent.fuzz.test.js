/*
 * JogIntent invariant fuzzer — the "runaways can never come back" gate.
 *
 * Example-based tests pin the failure shapes we know about (rollover, blur,
 * synthesized pairs). This fuzzer hunts the ones we don't: hundreds of
 * seeded-random gesture scripts — presses, releases, synthetic auto-repeat
 * pairs, mode flips, cancels, odd timing — each checked against the iron
 * invariants of manual jogging:
 *
 *   I1. With no source held (and time to settle), nothing is live: no
 *       heartbeat, no pending start, no typematic — the server is not
 *       left moving.
 *   I2. Every continuous episode ("go"...) is closed by a stop: at script
 *       end the modeled server is never in motion.
 *   I3. The machine never emits "go" while no source is physically down.
 *
 * Failures print the seed and script so they replay exactly.
 */

/* eslint-env jest */

var JogIntent = require("../dashboard/static/js/libs/jogintent");

// Deterministic PRNG (mulberry32) so failures are reproducible.
function rng(seed) {
    return function () {
        seed |= 0;
        seed = (seed + 0x6d2b79f5) | 0;
        var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

var SOURCES = ["a", "b", "c"];
var MOVES = {
    a: { axis: "z", dir: 1 },
    b: { axis: "z", dir: -1 },
    c: { axis: "x", dir: 1 },
};

function runScript(seed) {
    var rand = rng(seed);
    var fixedMode = { on: rand() < 0.5 };
    var intent = new JogIntent({
        tapWindow: rand() < 0.3 ? 0 : 200,
        refreshInterval: 50,
        repeatDelay: 600,
        repeatInterval: 250,
        getFixedMode: function () {
            return fixedMode.on;
        },
    });
    var events = [];
    var down = {}; // ground truth of physically-held sources
    ["go", "stop", "nudge", "nudgeCancel"].forEach(function (e) {
        intent.on(e, function () {
            events.push({ e: e, downCount: Object.keys(down).length });
        });
    });

    var script = [];
    function op(name, fn) {
        script.push(name);
        fn();
    }

    var steps = 30 + Math.floor(rand() * 40);
    for (var i = 0; i < steps; i++) {
        var r = rand();
        var src = SOURCES[Math.floor(rand() * SOURCES.length)];
        if (r < 0.3) {
            op("press " + src, function () {
                down[src] = true;
                intent.press(src, MOVES[src], rand() < 0.3 ? rand() < 0.5 : undefined);
            });
        } else if (r < 0.55) {
            op("release " + src, function () {
                delete down[src];
                intent.release(src);
            });
        } else if (r < 0.65 && down[src]) {
            // Synthesized auto-repeat pair on a held source (as delivered by
            // X11/VNC input paths): release+press back to back. The ADAPTER
            // debounces these in production; the state machine must at
            // minimum stay invariant-clean when they reach it raw.
            op("synthpair " + src, function () {
                intent.release(src);
                intent.press(src, MOVES[src]);
            });
        } else if (r < 0.72) {
            op("flip-fixed", function () {
                fixedMode.on = !fixedMode.on;
            });
        } else if (r < 0.78) {
            op("cancelAll", function () {
                down = {};
                intent.cancelAll();
            });
        } else {
            var ms = 10 + Math.floor(rand() * 700);
            op("advance " + ms, function () {
                jest.advanceTimersByTime(ms);
            });
        }

        // I3: "go" may only ever be emitted while something is down. Checked
        // via the ground truth captured at emit time.
        for (var k = 0; k < events.length; k++) {
            if (events[k].e === "go" && events[k].downCount === 0) {
                throw new Error("I3 violated (go with nothing held) in script: " + script.join(", "));
            }
        }
    }

    // Settle: release everything, give every timer time to misbehave.
    SOURCES.forEach(function (s) {
        delete down[s];
        intent.release(s);
    });
    script.push("release-all");
    jest.advanceTimersByTime(5000);

    // I1: nothing live.
    if (intent.isActive() || intent.heartbeat || intent.tapTimer || intent.repeatTimer) {
        throw new Error("I1 violated (machine still live after settle) in script: " + script.join(", "));
    }
    // I2: the modeled server is not moving.
    var moving = false;
    events.forEach(function (ev) {
        if (ev.e === "go") moving = true;
        if (ev.e === "stop") moving = false;
    });
    if (moving) {
        throw new Error("I2 violated (server left moving) in script: " + script.join(", "));
    }
}

describe("JogIntent fuzz: gesture invariants hold for arbitrary input orderings", () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    test("300 seeded-random gesture scripts", () => {
        for (var seed = 1; seed <= 300; seed++) {
            try {
                runScript(seed);
            } catch (e) {
                throw new Error("seed " + seed + ": " + e.message);
            }
        }
    });
});
