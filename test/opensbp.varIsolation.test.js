/*jshint esversion: 6 */
//
// Regression tests for SBP variable isolation during simulation.
//
// Bug: SBP user (&) and system ($) variables live in the process-global
// config.opensbp._cache, shared by every SBPRuntime instance. The soft-limit
// bounds pre-check (analyzeJobBounds -> simulateString) spins up a second
// runtime and steps the whole file asynchronously. On long files that sim was
// still running when the live job started, and its &tool writes raced the live
// job's C9 toolchange read — picking up the wrong tool.
//
// Fix: a simulation runtime routes variable reads/writes through an isolated
// per-instance store (_enterIsolatedVars / _varStore / _exitIsolatedVars) so it
// can never mutate the global store a live job depends on.

const config = require("../config");
const { SBPRuntime } = require("../runtime/opensbp/opensbp");

// Stub the global variable cache the runtime reads/writes. Mirrors the shape
// config.opensbp._cache has at runtime (set up via opensbp_config load()).
function stubCache(cache) {
    config.opensbp = config.opensbp || {};
    config.opensbp._cache = cache;
}

describe("SBP variable isolation during simulation", () => {
    test("_varStore returns the global cache when not isolated", () => {
        const cache = { tempVariables: { TOOL: 2 }, variables: {} };
        stubCache(cache);
        const rt = new SBPRuntime();
        expect(rt._varStore()).toBe(cache);
    });

    test("entering isolation snapshots current global values so the sim sees real state", () => {
        stubCache({ tempVariables: { TOOL: 2 }, variables: { SB_TOOLCURRENT: 4 } });
        const rt = new SBPRuntime();
        rt._enterIsolatedVars();
        // Sim starts from a copy of the live state, not an empty store.
        expect(rt._varStore().tempVariables.TOOL).toBe(2);
        expect(rt._varStore().variables.SB_TOOLCURRENT).toBe(4);
    });

    test("writes made while isolated do NOT leak into the global store a live job reads", () => {
        const cache = { tempVariables: { TOOL: 2 }, variables: {} };
        stubCache(cache);
        const rt = new SBPRuntime();

        rt._enterIsolatedVars();
        // Simulate the bounds pre-check advancing &tool deep into a long file.
        rt._varStore().tempVariables.TOOL = 99;

        // The live job's view of &tool is untouched — this is the whole fix.
        expect(cache.tempVariables.TOOL).toBe(2);
        // ...while the sim sees its own value.
        expect(rt._varStore().tempVariables.TOOL).toBe(99);
    });

    test("the snapshot is deep — mutating nested sim state does not touch the live store", () => {
        const cache = { tempVariables: {}, variables: { TOOLSUU: [{ x: 1 }, { x: 2 }] } };
        stubCache(cache);
        const rt = new SBPRuntime();

        rt._enterIsolatedVars();
        rt._varStore().variables.TOOLSUU[0].x = 12345;

        expect(cache.variables.TOOLSUU[0].x).toBe(1);
    });

    test("exiting isolation restores routing to the global store", () => {
        const cache = { tempVariables: { TOOL: 2 }, variables: {} };
        stubCache(cache);
        const rt = new SBPRuntime();

        rt._enterIsolatedVars();
        rt._varStore().tempVariables.TOOL = 99;
        rt._exitIsolatedVars();

        // Back on the global store, so a subsequent real run reads live values.
        expect(rt._varStore()).toBe(cache);
        expect(rt._varStore().tempVariables.TOOL).toBe(2);
    });
});
