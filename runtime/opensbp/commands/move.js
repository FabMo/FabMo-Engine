var log = require("../../../log").logger("sbp");
var config = require("../../../config");

// ...TESTING::th aliased macros concept ... Bender: commands (hardcoded here at moment)
exports._A = function (args, callback) {
    var alias_name = args[0];

    log.debug(" _A args: " + JSON.stringify(args));
    if (alias_name == "BEND") {
        this.runCustomCut("31", callback);
    }
    if (alias_name == "FEED") {
        this.runCustomCut("32", callback);
    }
    if (alias_name == "HOME") {
        this.runCustomCut("35", callback);
    }
    if (alias_name == "CONFIGURE") {
        this.runCustomCut("36", callback);
    }
};

// Move X axis
exports.MX = function (args) {
    var x = args[0];
    if (isNaN(x)) {
        throw "Invalid MX argument: " + x;
    }
    var feedrate = this.movespeed_xy * 60;
    this.cmd_posx = x;
    this.emit_move("G1", { X: x, F: feedrate });
};

// Move Y axis
exports.MY = function (args) {
    var y = args[0];
    if (isNaN(y)) {
        throw "Invalid MY argument: " + y;
    }
    var feedrate = this.movespeed_xy * 60;
    this.cmd_posy = y;
    this.emit_move("G1", { Y: y, F: feedrate });
};

// Move Z axis
exports.MZ = function (args) {
    var z = args[0];
    if (isNaN(z)) {
        throw "Invalid MZ argument: " + z;
    }
    var feedrate = this.movespeed_z * 60;
    this.cmd_posz = z;
    this.emit_move("G1", { Z: z, F: feedrate });
};

// Move A axis
exports.MA = function (args) {
    var a = args[0];
    if (isNaN(a)) {
        throw "Invalid MA argument: " + a;
    }
    var feedrate = this.movespeed_a * 60;
    this.cmd_posa = a;
    this.emit_move("G1", { A: a, F: feedrate });
};

// Move B axis
exports.MB = function (args) {
    var b = args[0];
    if (isNaN(b)) {
        throw "Invalid MB argument: " + b;
    }
    var feedrate = this.movespeed_b * 60;
    this.cmd_posb = b;
    this.emit_move("G1", { B: b, F: feedrate });
};

// Move C axis
exports.MC = function (args) {
    var c = args[0];
    if (isNaN(c)) {
        throw "Invalid MC argument: " + c;
    }
    var feedrate = this.movespeed_c * 60;
    this.cmd_posc = c;
    this.emit_move("G1", { C: c, F: feedrate });
};

// Move 2 axes (XY). This is a modal command, any axis location that is left out
//   of the command will default to it's current position and not move
exports.M2 = function (args) {
    //log.debug("  X param = " + args[0] + "  Y param = " + args[1]);
    var params = process_move.bind(this)(args);
    if (this.cmd_result < 2) {
        this.emit_move("G1", params);
    }
};

// Move 3 axes (XYZ). This is a modal command, any axis location that is left out
//   of the command will default to it's current position and not move
exports.M3 = function (args) {
    var params = process_move.bind(this)(args);
    if (this.cmd_result < 3) {
        this.emit_move("G1", params);
    }
};

// Move 4 axes (XYZA). This is a modal command, any axis location that is left out
//   of the command will default to it's current position and not move
exports.M4 = function (args) {
    var params = process_move.bind(this)(args);
    if (this.cmd_result < 4) {
        this.emit_move("G1", params);
    }
};

// Move 5 axes (XYZAB). This is a modal command, any axis location that is left out
//   of the command will default to it's current position and not move
exports.M5 = function (args) {
    var params = process_move.bind(this)(args);
    if (this.cmd_result < 5) {
        this.emit_move("G1", params);
    }
};

// Move all 6 axes (XYZABC). This is a modal command, any axis location that is left out
//   of the command will default to it's current position and not move
exports.M6 = function (args) {
    var params = process_move.bind(this)(args);
    if (this.cmd_result < 6) {
        this.emit_move("G1", params);
    }
};

var process_move = function (args) {
    this.cmd_result = 0;
    var params = {};
    if (args[0] === 0 || (args[0] && typeof args[0] === "number")) {
        params.X = args[0];
        if (params.X === this.cmd_posx) {
            this.cmd_result += 1;
        }
    }
    if (args[1] === 0 || (args[1] && typeof args[1] === "number")) {
        params.Y = args[1];
        if (params.Y === this.cmd_posy) {
            this.cmd_result += 1;
        }
    }
    if (args[2] === 0 || (args[2] && typeof args[2] === "number")) {
        params.Z = args[2];
        if (params.Z === this.cmd_posz) {
            this.cmd_result += 1;
        }
    }
    if (args[3] === 0 || (args[3] && typeof args[3] === "number")) {
        params.A = args[3];
        if (params.A === this.cmd_posa) {
            this.cmd_result += 1;
        }
    }
    if (args[4] === 0 || (args[4] && typeof args[4] === "number")) {
        params.B = args[4];
        if (params.B === this.cmd_posb) {
            this.cmd_result += 1;
        }
    }
    if (args[5] === 0 || (args[5] && typeof args[5] === "number")) {
        params.C = args[5];
        if (params.C === this.cmd_posc) {
            this.cmd_result += 1;
        }
    }

    // Determine which axes are actually moving so we can select the correct feedrate.
    // In absolute mode (the default, SA command), an axis moves only if its target
    // differs from the current commanded position. In relative mode (SR command), a
    // displacement of 0 (or a blank, which arrives as undefined) means no motion.
    var isMoving;
    if (this.absoluteMode) {
        isMoving = {
            X: params.X !== undefined && params.X !== this.cmd_posx,
            Y: params.Y !== undefined && params.Y !== this.cmd_posy,
            Z: params.Z !== undefined && params.Z !== this.cmd_posz,
            A: params.A !== undefined && params.A !== this.cmd_posa,
            B: params.B !== undefined && params.B !== this.cmd_posb,
            C: params.C !== undefined && params.C !== this.cmd_posc,
        };
    } else {
        // Relative mode: blank (undefined) or 0 displacement means no motion
        isMoving = {
            X: params.X !== undefined && params.X !== 0,
            Y: params.Y !== undefined && params.Y !== 0,
            Z: params.Z !== undefined && params.Z !== 0,
            A: params.A !== undefined && params.A !== 0,
            B: params.B !== undefined && params.B !== 0,
            C: params.C !== undefined && params.C !== 0,
        };
    }

    // Select feedrate to send to G2 based on which axes are actually moving, in priority
    // order: XY > Z > A > B > C.
    //
    // G2 implements NIST RS274NGC §2.1.2.5: F is the XYZ Euclidean path speed. Rotary
    // axes (ABC) are excluded from the feed_time distance sum and are instead synchronized
    // to finish with the linear segment, automatically rate-limited by their individual
    // feedrate_max (bvm/avm/cvm) firmware setting. For pure rotary moves (no XYZ) G2
    // falls back to treating F as degrees/min for the rotary path.
    //
    // This means we simply send the configured speed for the dominant linear axis and let
    // G2 handle rotary coordination. The isMoving check correctly skips axes whose target
    // equals their current position in absolute mode (or equals zero in relative mode), so
    // a repeated XY position in a multi-axis sequence no longer incorrectly overrides the
    // rotary feedrate.

    var speedXY = this.movespeed_xy * 60;
    var speedZ  = this.movespeed_z  * 60;
    var speedA  = this.movespeed_a  * 60;
    var speedB  = this.movespeed_b  * 60;
    var speedC  = this.movespeed_c  * 60;

    var feedrate;
    if (isMoving.X || isMoving.Y) {
        feedrate = speedXY;
    } else if (isMoving.Z) {
        feedrate = speedZ;
    } else if (isMoving.A) {
        feedrate = speedA;
    } else if (isMoving.B) {
        feedrate = speedB;
    } else if (isMoving.C) {
        feedrate = speedC;
    } else {
        feedrate = speedXY; // no-op fallback
    }
    params.F = feedrate;

    return params;
};

// Move to the XY home position (0,0)
// eslint-disable-next-line no-unused-vars
exports.MH = function (args) {
    var x = 0;
    var y = 0;
    var z = this.cmd_posz;
    var safeZ = config.opensbp.get("safeZpullUp");
    var feedrateXY = this.movespeed_xy * 60;
    var feedrateZ = this.movespeed_z * 60;

    log.debug("MH");
    if (z < safeZ) {
        this.emit_move("G1", { Z: safeZ, F: feedrateZ });
        this.emit_move("G1", { X: x, Y: y, F: feedrateXY });
    } else {
        this.emit_move("G1", { X: x, Y: y, F: feedrateXY });
    }
    this.cmd_posx = 0;
    this.cmd_posy = 0;
    this.cmd_posz = safeZ;
};

// Set the Move (cut) speed for any of the 6 axes
//    The changes to speed made by this command are not permanent
//    - use the SV command to make these changes permanent
exports.MS = function (args, callback) {
    var speed_change = 0.0;

    if (args[0] !== undefined) {
        speed_change = args[0];
        if (isNaN(speed_change)) {
            throw "Invalid MS-XY argument: " + speed_change;
        }
        this.movespeed_xy = speed_change;
    }
    if (args[1] !== undefined) {
        speed_change = args[1];
        if (isNaN(speed_change)) {
            throw "Invalid MS-Z argument: " + speed_change;
        }
        this.movespeed_z = speed_change;
    }
    if (args[2] !== undefined) {
        speed_change = args[2];
        if (isNaN(speed_change)) {
            throw "Invalid MS-A argument: " + speed_change;
        }
        this.movespeed_a = speed_change;
    }
    if (args[3] !== undefined) {
        speed_change = args[3];
        if (isNaN(speed_change)) {
            throw "Invalid MS-B argument: " + speed_change;
        }
        this.movespeed_b = speed_change;
    }
    if (args[4] !== undefined) {
        speed_change = args[4];
        if (isNaN(speed_change)) {
            throw "Invalid MS-C argument: " + speed_change;
        }
        this.movespeed_c = speed_change;
    }

    this.vs_change = 1;
    //    log.debug("  MS: vs_change = " + this.vs_change);
    callback();
};

// Override current move speed in G2
// Have not implemented MO, might be for some sort of override; OR M0 to turn off motors (because we can't do it consistently for all tools)
