var log = require("../../../log").logger("sbp");
var g2 = require("../../../g2");
var sb3_commands = require("../sb3_commands");
var config = require("../../../config");

// Generic probe function
// opts:
//  inp : input number (int)
//  dist : map of axis word (X,Y,Z,A,B,C) to search distance
//  feed : feedrate in units/sec
//
////## modifying to work with v3-G2
////##  - input for probe now defined with {prbin:#}; so probing with input2 would be {prbin:2}
//          and {prbin:0} would turn it off

function probe(runtime, opts) {
    var name = "prbin";
    ////##	var name = 'di' + opts.inp + 'fn';

    var cmd1 = {};
    cmd1[name] = opts.inp;
    ////##	cmd1[name] = 4

    var cmd2 = ["G38.3"]; // no fault on miss for testing
    ////##	var cmd2 = ['G38.2']
    for (word in opts.dist) {
        cmd2.push(word + opts.dist[word].toFixed(5));
    }

    ////## restore back to no input number
    var cmd3 = {};
    cmd3[name] = 0;

    cmd2.push("F" + (opts.feed * 60.0).toFixed(3));
    runtime.emit_gcode("M100.1(" + JSON.stringify(cmd1) + ")");
    runtime.emit_gcode(cmd2.join(" "));
    runtime.emit_gcode("M100.1(" + JSON.stringify(cmd3) + ")");
    ////## runtime.emit_gcode('G4 P0');
}

exports.PX = function (args) {
    this.cmd_posx = undefined;
    probe(this, {
        inp: args[2],
        feed: args[1],
        dist: {
            X: args[0],
        },
    });
};

exports.PY = function (args) {
    this.cmd_posy = undefined;
    probe(this, {
        inp: args[2],
        feed: args[1],
        dist: {
            Y: args[0],
        },
    });
};

exports.PZ = function (args) {
    this.cmd_posz = undefined;
    probe(this, {
        inp: args[2],
        feed: args[1],
        dist: {
            Z: args[0],
        },
    });
};

exports.PA = function (args) {
    this.cmd_posa = undefined;
    probe(this, {
        inp: args[2],
        feed: args[1],
        dist: {
            A: args[0],
        },
    });
};

exports.PB = function (args) {
    this.cmd_posb = undefined;
    probe(this, {
        inp: args[2],
        feed: args[1],
        dist: {
            B: args[0],
        },
    });
};

exports.PC = function (args) {
    this.cmd_posc = undefined;
    probe(this, {
        inp: args[2],
        feed: args[1],
        dist: {
            C: args[0],
        },
    });
};

exports.P2 = function (args) {
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
};
