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

//const { SBPRuntime } = require("..");

// Model:  P_, target(absolute), feedrate, input

function probe(runtime, opts) {
    var name = "prbin";
    var input = opts.inp;
    var input_action = this.config.machine.get("di" + input + "_def");
    var cmd1 = {};
    cmd1[name] = opts.inp;

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
    for (var word in opts.dist) {
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
    probe(this, {
        inp: args[2],
        feed: args[1],
        dist: {
            X: args[0],
        },
    });
    callback();
};

exports.PY = function (args, callback) {
    this.cmd_posy = undefined;
    probe(this, {
        inp: args[2],
        feed: args[1],
        dist: {
            Y: args[0],
        },
    });
    callback();
};

exports.PZ = function (args, callback) {
    this.cmd_posz = undefined;
    probe(this, {
        inp: args[2],
        feed: args[1],
        dist: {
            Z: args[0],
        },
    });
    callback();
};

exports.PA = function (args, callback) {
    this.cmd_posa = undefined;
    probe(this, {
        inp: args[2],
        feed: args[1],
        dist: {
            A: args[0],
        },
    });
    callback();
};

exports.PB = function (args, callback) {
    this.cmd_posb = undefined;
    probe(this, {
        inp: args[2],
        feed: args[1],
        dist: {
            B: args[0],
        },
    });
    callback();
};

exports.PC = function (args, callback) {
    this.cmd_posc = undefined;
    probe(this, {
        inp: args[2],
        feed: args[1],
        dist: {
            C: args[0],
        },
    });
    callback();
};

exports.P2 = function (args, callback) {
    this.cmd_posx = undefined;
    this.cmd_posy = undefined;
    probe(this, {
        inp: args[3],
        feed: args[2],
        dist: {
            X: args[0],
            Y: args[1],
        },
    });
    callback();
};
