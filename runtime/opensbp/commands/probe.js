// Generic probe function
// opts:
//  inp : input number (int)
//  dist : map of axis word (X,Y,Z,A,B,C) to search distance
//  feed : feedrate in units/sec
//
//  UPDATED to work with v3-G2 ("edge-preview"; th, 3 years ago)
//   - G38.3 is used to probe;  this is the "No-fault-on-miss" version of the g-code probe command in G2
//       ... it is expected that a "miss" will be handled in the file or Macro
//   - Input for probe now defined with {prbin:#}; so probing with input2 would be {prbin:2}
//          and {prbin:0} would turn it off
//   - (NEW 6/15/23) If the input already has an LIMIT action defined, it is automatically turned off during probing by G2
//       ... but must be disabled here as well so that the input actions and displays in FabMo is are triggered by the probe
//       ... and we now intercept here "stop", "faststop", and "interlock" actions and generate an error and terminate file
//       ... if the input is already active (ON), we also generate an error and terminate file

var config = require("../../../config");
var log = require("../../../log").logger("sbp");

// Map axis words to runtime position properties
var axisPosMap = { X: "posx", Y: "posy", Z: "posz", A: "posa", B: "posb", C: "posc" };

// Model:  P_, target(absolute), feedrate, input

// Validate that all required arguments are present for a probe command
function validateProbeArgs(cmdName, args, expectedCount) {
    for (var i = 0; i < expectedCount; i++) {
        if (args[i] === undefined || args[i] === null) {
            throw cmdName + " requires " + expectedCount + " parameters but parameter " + (i + 1) + " is missing";
        }
    }
}

function probe(runtime, opts) {
    var name = "prbin";
    var input = opts.inp;
    var input_action = config.machine.get("di" + input + "ac");
    var cmd1 = {};
    cmd1[name] = opts.inp;

    // Determine tolerance for "already at target" check based on unit system
    var tolerance = runtime.units === "mm" ? 0.125 : 0.005;

    // Check if we're already at (or within tolerance of) the probe target location
    var allAtTarget = true;
    var word;
    for (word in opts.dist) {
        var currentPos = runtime[axisPosMap[word]] || 0.0;
        var targetPos = opts.dist[word];
        if (Math.abs(currentPos - targetPos) > tolerance) {
            allAtTarget = false;
            break;
        }
    }
    if (allAtTarget) {
        throw "Already at probe target location (within " + tolerance +
              (runtime.units === "mm" ? "mm" : "in") + ") so probe has no distance to travel";
    }

    // Determine if requested probe input already has a defined action then, except for "limit", generate an error and terminate file
    switch (input_action) {
        case "stop":
        case "faststop":
        case "interlock":
            throw (
                "Input#" +
                opts.inp +
                " already assigned to Action (" +
                input_action +
                ") so it cannot be used for Probing request "
            );
        case "limit":
        default:
    }
    // Or, the input is already active (ON); then, also generate an error and terminate file
    if (runtime.machine.status["in" + input]) {
        throw "Input#" + opts.inp + " is already active (ON) so cannot be used for Probing request ";
    }

    var cmd2 = ["G38.3"];
    for (word in opts.dist) {
        cmd2.push(word + opts.dist[word].toFixed(5));
    }
    cmd2.push("F" + (opts.feed * 60.0).toFixed(3));
    runtime.emit_gcode("M100.1(" + JSON.stringify(cmd1) + ")");
    runtime.emit_gcode(cmd2.join(" "));
    runtime.probingInitialized = true;
    runtime.probingPending = true;
    runtime.prime();
    //log.debug("PROBING INITIALIZED in P_ (set PENDING)============####");
}

exports.PX = function (args, callback) {
    this.cmd_posx = undefined;
    try {
        validateProbeArgs("PX", args, 3);
        probe(this, {
            inp: args[2],
            feed: args[1],
            dist: { X: args[0] },
        });
        callback();
    } catch (error) {
        var errorMsg = error.message || error;
        log.error("Probe error: " + errorMsg);
        setImmediate(function () {
            this._abort(new Error(errorMsg));
            callback();
        }.bind(this));
    }
};

exports.PY = function (args, callback) {
    this.cmd_posy = undefined;
    try {
        validateProbeArgs("PY", args, 3);
        probe(this, {
            inp: args[2],
            feed: args[1],
            dist: { Y: args[0] },
        });
        callback();
    } catch (error) {
        var errorMsg = error.message || error;
        log.error("Probe error: " + errorMsg);
        setImmediate(function () {
            this._abort(new Error(errorMsg));
            callback();
        }.bind(this));
    }
};

exports.PZ = function (args, callback) {
    this.cmd_posz = undefined;
    try {
        validateProbeArgs("PZ", args, 3);
        probe(this, {
            inp: args[2],
            feed: args[1],
            dist: { Z: args[0] },
        });
        callback();
    } catch (error) {
        var errorMsg = error.message || error;
        log.error("Probe error: " + errorMsg);
        setImmediate(function () {
            this._abort(new Error(errorMsg));
            callback();
        }.bind(this));
    }
};

exports.PA = function (args, callback) {
    this.cmd_posa = undefined;
    try {
        validateProbeArgs("PA", args, 3);
        probe(this, {
            inp: args[2],
            feed: args[1],
            dist: { A: args[0] },
        });
        callback();
    } catch (error) {
        var errorMsg = error.message || error;
        log.error("Probe error: " + errorMsg);
        setImmediate(function () {
            this._abort(new Error(errorMsg));
            callback();
        }.bind(this));
    }
};

exports.PB = function (args, callback) {
    this.cmd_posb = undefined;
    try {
        validateProbeArgs("PB", args, 3);
        probe(this, {
            inp: args[2],
            feed: args[1],
            dist: { B: args[0] },
        });
        callback();
    } catch (error) {
        var errorMsg = error.message || error;
        log.error("Probe error: " + errorMsg);
        setImmediate(function () {
            this._abort(new Error(errorMsg));
            callback();
        }.bind(this));
    }
};

exports.PC = function (args, callback) {
    this.cmd_posc = undefined;
    try {
        validateProbeArgs("PC", args, 3);
        probe(this, {
            inp: args[2],
            feed: args[1],
            dist: { C: args[0] },
        });
        callback();
    } catch (error) {
        var errorMsg = error.message || error;
        log.error("Probe error: " + errorMsg);
        setImmediate(function () {
            this._abort(new Error(errorMsg));
            callback();
        }.bind(this));
    }
};

exports.P2 = function (args, callback) {
    this.cmd_posx = undefined;
    this.cmd_posy = undefined;
    try {
        validateProbeArgs("P2", args, 4);
        probe(this, {
            inp: args[3],
            feed: args[2],
            dist: { X: args[0], Y: args[1] },
        });
        callback();
    } catch (error) {
        var errorMsg = error.message || error;
        log.error("Probe error: " + errorMsg);
        setImmediate(function () {
            this._abort(new Error(errorMsg));
            callback();
        }.bind(this));
    }
};

exports.P3 = function (args, callback) {
    this.cmd_posx = undefined;
    this.cmd_posy = undefined;
    this.cmd_posz = undefined;
    try {
        validateProbeArgs("P3", args, 5);
        probe(this, {
            inp: args[4],
            feed: args[3],
            dist: { X: args[0], Y: args[1], Z: args[2] },
        });
        callback();
    } catch (error) {
        var errorMsg = error.message || error;
        log.error("Probe error: " + errorMsg);
        setImmediate(function () {
            this._abort(new Error(errorMsg));
            callback();
        }.bind(this));
    }
};

exports.P4 = function (args, callback) {
    this.cmd_posx = undefined;
    this.cmd_posy = undefined;
    this.cmd_posz = undefined;
    this.cmd_posa = undefined;
    try {
        validateProbeArgs("P4", args, 6);
        probe(this, {
            inp: args[5],
            feed: args[4],
            dist: { X: args[0], Y: args[1], Z: args[2], A: args[3] },
        });
        callback();
    } catch (error) {
        var errorMsg = error.message || error;
        log.error("Probe error: " + errorMsg);
        setImmediate(function () {
            this._abort(new Error(errorMsg));
            callback();
        }.bind(this));
    }
};

exports.P5 = function (args, callback) {
    this.cmd_posx = undefined;
    this.cmd_posy = undefined;
    this.cmd_posz = undefined;
    this.cmd_posa = undefined;
    this.cmd_posb = undefined;
    try {
        validateProbeArgs("P5", args, 7);
        probe(this, {
            inp: args[6],
            feed: args[5],
            dist: { X: args[0], Y: args[1], Z: args[2], A: args[3], B: args[4] },
        });
        callback();
    } catch (error) {
        var errorMsg = error.message || error;
        log.error("Probe error: " + errorMsg);
        setImmediate(function () {
            this._abort(new Error(errorMsg));
            callback();
        }.bind(this));
    }
};
