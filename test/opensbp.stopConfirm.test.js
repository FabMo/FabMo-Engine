/*jshint esversion: 6 */
//
// Stop confirmation in the OpenSBP runtime (SBPRuntime._confirmStop).
//
// A stat:3 from G2 does not say which line it belongs to, so a stop for an
// earlier line (an M0 from a zero command, the end of a probe cycle, any JSON
// command) can arrive just after a later move was emitted and before G2 has
// started it. The runtime must not release a waiting stack-breaking command
// on such a stop. It only counts a stop when G2 has acknowledged everything
// emitted AND then answers a {stat:null} query with 3.
//
// The first test replays the sequence logged on a tool (Nov 2026) where the
// stop for ZY's M0 released the second PY before the pull-back jog had run.

const config = require("../config");
const { SBPRuntime } = require("../runtime/opensbp/opensbp");

const STAT_STOP = 3;
const STAT_RUNNING = 5;

// A stand-in for the G2 driver: just the acknowledgement state and the
// {stat:null} query that _confirmStop uses.
function makeDriver() {
    return {
        STAT_STOP: STAT_STOP,
        status: { stat: STAT_STOP },
        pause_flag: false,
        acknowledged: true,
        queries: [],
        allGcodeAcknowledged: function () {
            return this.acknowledged;
        },
        get: function (key, callback) {
            this.queries.push({ key: key, callback: callback });
        },
        // Answer the oldest outstanding query, as G2 would
        reply: function (stat) {
            this.queries.shift().callback(null, stat);
        },
    };
}

function makeRuntime() {
    config.opensbp = config.opensbp || {};
    config.opensbp._cache = config.opensbp._cache || { tempVariables: {}, variables: {} };
    const rt = new SBPRuntime();
    rt.driver = makeDriver();
    rt.stream = { readableLength: 0 };
    rt.executed = 0;
    rt._executeNext = function () {
        rt.executed += 1;
    };
    // What emit_gcode does to the pending state, without needing a real stream
    rt.emit = function () {
        rt.gcodesPending = true;
        rt._emitSeq += 1;
        rt.driver.acknowledged = false;
    };
    return rt;
}

afterEach(() => {
    jest.useRealTimers();
});

describe("a stop that belongs to an earlier line", () => {
    test("M0's stop arriving before the pull-back jog is acknowledged does not release the next command", () => {
        const rt = makeRuntime();
        rt.emit(); // M0
        rt.emit(); // G0 pull-back

        // stat:3 for the M0 arrives; neither line acknowledged yet
        rt._confirmStop();
        expect(rt.driver.queries.length).toBe(0);
        expect(rt.executed).toBe(0);
        expect(rt.gcodesPending).toBe(true);

        // Acknowledgements arrive; the runtime now asks G2
        rt.driver.acknowledged = true;
        rt._onG2Response();
        expect(rt.driver.queries.length).toBe(1);
        expect(rt.driver.queries[0].key).toBe("stat");

        // G2 has planned the jog, so it answers "running"
        rt.driver.reply(STAT_RUNNING);
        expect(rt.executed).toBe(0);
        expect(rt.gcodesPending).toBe(true);

        // The real stop at the end of the jog
        rt._confirmStop();
        rt.driver.reply(STAT_STOP);
        expect(rt.executed).toBe(1);
        expect(rt.gcodesPending).toBe(false);
    });

    test("a response that is not the last acknowledgement keeps holding", () => {
        const rt = makeRuntime();
        rt.emit();
        rt._confirmStop();
        rt._onG2Response(); // some other response; still unacknowledged
        expect(rt.driver.queries.length).toBe(0);
        expect(rt.executed).toBe(0);
    });

    test("g-code still in the runtime's own stream counts as not delivered", () => {
        const rt = makeRuntime();
        rt.emit();
        rt.driver.acknowledged = true;
        rt.stream.readableLength = 12;
        rt._confirmStop();
        expect(rt.driver.queries.length).toBe(0);
    });
});

describe("a genuine stop", () => {
    test("everything acknowledged and G2 answers stopped: continue", () => {
        const rt = makeRuntime();
        rt.emit();
        rt.driver.acknowledged = true;
        rt._confirmStop();
        rt.driver.reply(STAT_STOP);
        expect(rt.executed).toBe(1);
        expect(rt.gcodesPending).toBe(false);
    });

    test("nothing pending: no query, nothing executed", () => {
        const rt = makeRuntime();
        rt._confirmStop();
        expect(rt.driver.queries.length).toBe(0);
        expect(rt.executed).toBe(0);
    });
});

describe("order flips", () => {
    test("a second stop while a query is in flight does not send a second query", () => {
        const rt = makeRuntime();
        rt.emit();
        rt.driver.acknowledged = true;
        rt._confirmStop();
        rt._confirmStop();
        expect(rt.driver.queries.length).toBe(1);
        rt.driver.reply(STAT_STOP);
        expect(rt.executed).toBe(1);
    });

    test("more g-code emitted while asking: the answer is not trusted, and is asked again once acknowledged", () => {
        const rt = makeRuntime();
        rt.emit();
        rt.driver.acknowledged = true;
        rt._confirmStop();
        rt.emit(); // emitted after the query went out
        rt.driver.reply(STAT_STOP); // answer predates the new line
        expect(rt.executed).toBe(0);
        expect(rt.gcodesPending).toBe(true);

        rt.driver.acknowledged = true;
        rt._onG2Response();
        rt.driver.reply(STAT_STOP);
        expect(rt.executed).toBe(1);
    });

    test("a reply arriving after the run was reset is ignored", () => {
        const rt = makeRuntime();
        rt.emit();
        rt.driver.acknowledged = true;
        rt._confirmStop();
        rt._cancelStopConfirm();
        rt.driver.reply(STAT_STOP);
        expect(rt.executed).toBe(0);
    });

    test("a lost reply times out so the next stop report can ask again", () => {
        jest.useFakeTimers();
        const rt = makeRuntime();
        rt.emit();
        rt.driver.acknowledged = true;
        rt._confirmStop();
        jest.advanceTimersByTime(1100);
        rt._confirmStop();
        expect(rt.driver.queries.length).toBe(2);
        // The late first reply is ignored; the second decides
        rt.driver.queries[0].callback(null, STAT_STOP);
        expect(rt.executed).toBe(0);
        rt.driver.queries[1].callback(null, STAT_STOP);
        expect(rt.executed).toBe(1);
    });

    test("acknowledgements that never arrive do not hang the file", () => {
        jest.useFakeTimers();
        const rt = makeRuntime();
        rt.emit();
        rt._confirmStop();
        expect(rt.driver.queries.length).toBe(0);
        jest.advanceTimersByTime(3100);
        rt._confirmStop(); // the nudge timer's stat:3
        expect(rt.driver.queries.length).toBe(1);
        rt.driver.reply(STAT_STOP);
        expect(rt.executed).toBe(1);
    });

    test("...but not while G2 is in a feedhold", () => {
        jest.useFakeTimers();
        const rt = makeRuntime();
        rt.emit();
        rt._confirmStop();
        rt.driver.pause_flag = true;
        jest.advanceTimersByTime(3100);
        rt._confirmStop();
        expect(rt.driver.queries.length).toBe(0);
    });
});
