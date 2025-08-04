var log = require("../../../log").logger("sbp");
var config = require("../../../config");

/* SETTINGS */

// Set to Absolute coordinates
exports.SA = function (args, callback) {
    this.absoluteMode = true;
    this.emit_gcode("G90");
    callback();
};

// Set Active coordinate system (not erasing either)
exports.SC = function (args, callback) {
    try {
        switch (args[0]) {
            case 0:
                var cs = "G54";
                break;
            case 1:
                cs = "G55";
                break;
            default:
                throw new Error("Invalid coordinate system specified: " + args[0]);
        }
        this.emit_gcode(cs);
        this.coordinateSystem = cs;
    } catch (e) {
        return callback(e);
    }
    this.cmd_posx = null;
    this.cmd_posy = null;
    this.cmd_posz = null;
    this.cmd_posa = null;
    this.cmd_posb = null;
    this.cmd_posc = null;

    callback();
};

// Set/Open Manual Keypay (for calling up in files)
exports.SK = function (args, callback) {
    this.manualEnter(args[0], callback);
};

//  Set to Relative coordinates  ////## made stack-breaking, see SA above
exports.SR = function (args, callback) {
    this.absoluteMode = false;
    this.emit_gcode("G91");
    callback();
};

// Set (restore) table (machine) base coordinates by zeroing G55s
exports.ST = function (args, callback) {
    this.machine.driver.get(
        "mpo",
        async function (err, MPO) {
            log.debug("ST-MPO = " + JSON.stringify(MPO));
            if (err) {
                return callback(err);
            }
            var stObj = {};
            stObj.g55x = 0.0;
            stObj.g55y = 0.0;
            stObj.g55z = 0.0;
            stObj.g55a = 0.0;
            stObj.g55b = 0.0;
            stObj.g55c = 0.0;
            try {
                await config.driver.setManyWrapper(stObj);
                this.cmd_posx = this.posx = stObj.g55x;
                this.cmd_posy = this.posy = stObj.g55y;
                this.cmd_posz = this.posz = stObj.g55z;
                this.cmd_posa = this.posa = stObj.g55a;
                this.cmd_posb = this.posb = stObj.g55b;
                this.cmd_posc = this.posc = stObj.g55c;
                callback();
            } catch (error) {
                callback(error);
            }
        }.bind(this)
    );
};

// Set an Output On or Off (note M-codes only for output 1)
////## Experimentally allow sending outputs to 18 to allow using the enable line, etc
////## ... monitoring will need to be done via G2
exports.SO = function (args) {
    var outnum = parseInt(args[0]);
    var state = parseInt(args[1]);
    if (outnum >= 1 && outnum <= 18) {
        ////## allow outputs 1-18
        if (state == 1 || state == 0) {
            if (outnum === 1) {
                if (state === 1) {
                    this.emit_gcode("M3");
                } else {
                    this.emit_gcode("M5");
                }
            } else {
                this.emit_gcode("M100 ({out" + outnum + ":" + state + "})");
            }
        } else {
            log.warn("Value passed to SO that's not a 1 or 0");
        }
    }
};

// Output a PWM Signal *not implemented in FabMo ???
exports.SP = function (args) {
    var outnum = parseInt(args[0]);
    var state = parseFloat(args[1]);
    if (outnum >= 0 && outnum <= 1) {
        outnum += 11;
        if (state >= 0.0 && state <= 1.0) {
            this.emit_gcode("M100 ({out" + outnum + ":" + state + "})");
        } else {
            log.warn("Value passed to SP that's not between 0 and 1");
        }
    } else {
        log.warn("PWM number passed to SP thats not 0 or 1");
    }
};

// Set Units
exports.SU = function (args) {
    var units = ((args[0] || "in") + "").toLowerCase();

    switch (units) {
        case "in":
        case "inch":
        case "inches":
        case "0":
            this.emit_gcode("G20");
            this.emit_gcode("G4 P0.001");
            break;
        case "mm":
        case "millimeter":
        case "millimeters:":
        case "1":
            this.emit_gcode("G21");
            this.emit_gcode("G4 P0.001");
            break;
        default:
            log.warn("Unknown unit specified: " + units);
            break;
    }
};

// Save driver settings to settings files  *Utility ???
exports.SV = function (args, callback) {
    this._saveDriverSettings(
        // eslint-disable-next-line no-unused-vars
        function (err, values) {
            if (err) {
                log.error(err);
            }
            this._saveConfig(
                // eslint-disable-next-line no-unused-vars
                function (err, values) {
                    if (err) {
                        log.error(err);
                    }
                    ////## this seemed to be an issue with individual commands & messing up units; WATCH
                    // config.machine.set(
                    //     "units",
                    //     this.units,
                    //     // eslint-disable-next-line no-unused-vars
                    //     function (err, data) {
                    callback();
                    //     }
                    // );
                }.bind(this)
            );
        }.bind(this)
    );
};
