// Generic probe function
// opts:
//  inp : input number (int)
//  dist : map of axis word (X,Y,Z,A,B,C) to search distance
//  feed : feedrate in units/sec
//
//  UPDATED to work with v3-G2
//   - input for probe now defined with {prbin:#}; so probing with input2 would be {prbin:2}
//          and {prbin:0} would turn it off

//const { SBPRuntime } = require("..");

function probe(runtime, opts) {
    var name = "prbin";
    var cmd1 = {};
    cmd1[name] = opts.inp;
    var cmd2 = ["G38.3"]; // USE > No-fault on Miss Version (handle errors outside G2)
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
