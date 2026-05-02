#!/usr/bin/env node
// Reproduces the customer's "Duplicate labels RUN_MANUAL" error deterministically
// by leveraging the parseStream-leak mechanism proven in test_parsestream_race.js.
//
// Scenario: prior job was interrupted while parsing macro 23. When the new job
// later calls C23, the stale parser's pending events fire into macro 23's
// fresh program array — adding a second copy of RUN_MANUAL alongside the
// freshly-parsed one. _analyzeLabels then throws.
//
// We then show two fixes:
//   (a) the current _resetForTopLevelRun() guard — does NOT address this
//   (b) explicitly destroying the prior parser stream — DOES address it

var SBPRuntime = require("./opensbp").SBPRuntime;
var parser = require("./parser");
var stream = require("stream");

function macro23Src() {
    var lines = ["MS,3,3", "JS,10,10", "RUN_MANUAL:"];
    for (var i = 0; i < 18; i++) lines.push("MZ,-0.1");
    return lines.join("\n") + "\n";
}

function runScenario(label, applyFix) {
    console.log("\n========== " + label + " ==========");
    var rt = new SBPRuntime();

    // STAGE 1: Prior job is parsing macro 23. Interrupted mid-parse.
    rt.program = [];
    rt.currentFilename = "C23 (PROBE_HEAD)";
    var oldInput = new stream.PassThrough();
    var oldParser = parser.parseStream(oldInput);
    var oldHandler = function (data) { rt.program.push(data); }.bind(rt);
    oldParser.on("data", oldHandler);
    oldParser.on("error", function () {});

    // Write macro 23 — but never end the input. STOP fires here.
    oldInput.write(macro23Src());

    // STAGE 2: Customer's STOP/abort path. Maybe _end runs (clearing some state)
    // but the parser stream isn't explicitly destroyed.
    if (applyFix === "guard-state-only") {
        // What the guard used to do — clear state but leave the parser alive.
        rt.file_stack = [];
        rt.stack = [];
        rt.program = [];
        rt.label_index = {};
        rt.pc = 0;
        rt.currentFilename = null;
    } else if (applyFix === "guard-current") {
        // The current production guard, which now also destroys the parser.
        // BUT: in real code, the parser is tracked via _activeParser, set by
        // runStream. Here we manually wire it so the helper finds it.
        rt._activeInputStream = oldInput;
        rt._activeParser = oldParser;
        rt._resetForTopLevelRun();
    }
    // For "no-fix" we do nothing.

    // STAGE 3: New job runs. It eventually calls C23. runStream loads macro 23
    // fresh into rt.program. The OLD parser's pending events fire concurrently.
    rt.program = [];
    rt.currentFilename = "C23 (PROBE_HEAD)";
    var newInput = new stream.PassThrough();
    var newParser = parser.parseStream(newInput);
    newParser.on("data", function (data) { rt.program.push(data); }.bind(rt));
    newParser.on("error", function () {});
    newInput.write(macro23Src());
    newInput.end();
    oldInput.end();   // let any stale events drain

    setTimeout(function () {
        console.log("After both parses settle:");
        console.log("  rt.program.length = " + rt.program.length + " (expected 21 if clean)");
        var labels = [];
        for (var i = 0; i < rt.program.length; i++) {
            if (rt.program[i] && rt.program[i].type === "label" && rt.program[i].value === "RUN_MANUAL") {
                labels.push(i);
            }
        }
        console.log("  RUN_MANUAL indices = " + JSON.stringify(labels));
        try {
            rt._analyzeLabels();
            console.log("  _analyzeLabels: PASSED");
        } catch (e) {
            console.log("  _analyzeLabels: THREW → [" + rt.currentFilename + "] " + e.message);
        }
    }, 50);
}

// Sequence three runs — each independent, results print as they complete
runScenario("Scenario 1: NO FIX (baseline)",                            null);
setTimeout(function () {
    runScenario("Scenario 2: state cleanup only (insufficient)",        "guard-state-only");
}, 200);
setTimeout(function () {
    runScenario("Scenario 3: production guard (state + parser kill)",   "guard-current");
}, 400);
