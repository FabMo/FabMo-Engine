/* eslint-disable */
var log = require("../../../log").logger("sbp");

/* TOOLS */

// Set Up Spindle Control Tool; VFD, Spindle, RPM, etc. (Does not contorl RUN/STOP or optional FWD/REV)
// ... currently only managing a single spindle

exports.TR = function (args, callback) {
    // todo: Not currently managing spindle number or checking to make sure *not spinning before setting direction
    const spindle = require("../../../spindle1");

    // Incoming requests:
    var new_RPM = args[0];
    var spindle_num = args[1];
    var opts1 = args[2];
    var opts2 = args[3];

    // Defaults for Incoming requests
    if (!spindle_num) {
        spindle_num = 1;
    }
    if (!opts1) {
        opts = "";
    }
    if (!opts2) {
        opts2 = "";
    }

    // Set RPM; todo: check for change only (or deeper than here); update range
    if (new_RPM > 5000 && new_RPM < 30000) {
        try {
            log.info("----> new speed: " + new_RPM);
            spindle.setSpindleVFDFreq(new_RPM);
        } catch (error) {
            log.error("Failed to pass new RPM: " + error);
        }
    };

    callback();

};