/* eslint-disable */
var log = require("../../../log").logger("sbp");
//var config = require("../../../config");
var spindle1 = require("../../../spindle1");

/* TOOLS */

// Set Up Spindle Control Tool; VFD, Spindle, RPM, etc. (Does not contorl RUN/STOP or optional FWD/REV)

exports.TR = function (args, callback) {
    // todo: Not currently managing spindle number or checking to make sure *not spinning before setting direction
    // Need to read config

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

    // Current State: (not all used yet, but may be in future)
    // var spindle_now_spinning = false; // We may want to make sure it is STOPPED; may not be a standard implementation
    // var spindle_now_RUN = false;
    // var vfdstatus = this.machine.status.spindleVFD.vfdStatus
    // var spin = "not-spinning"
    // var run = "not-running"

    // // Detect still spinning as not 00
    // if ((vfdstatus & 1) || (vfdstatus & 2)) {
    //     spindle_now_spinning = true;
    //     spin = "SPINNING";
    // }
    // // Detect at full RUN condition, e.g. spun-up
    // if ((vfdstatus & 1) && (vfdstatus & 2)) {
    //     spindle_now_RUN = true;
    //     run = "RUN";
    // }
    // // Detect DIRECTION either in process of aready shifting to
    // if (this.machine.status.spindleVFD.vfdStatus & 8) {
    //     spindle_DIR_set = "R";
    // } else {
    //     spindle_DIR_set = "F";
    // }

    // log.info(">>> Current spindle condition: ", spindle_DIR_set);
    //     log.info(spindle_DIR_set + ", " + run + ", " + spin);


    // Set RPM; todo: check for change only, update range
    if (new_RPM > 500 && new_RPM < 30000) {
        spindle1.setSpindleVFDFreq(new_RPM, function (err) {
            if (err) {
                log.error(err);
            }
            callback();
        });
    }

    // // Only set new DIRECTION is there is a change
    // if (spindle_direction === "R" && spindle_DIR_set === "F") {
    //     spindle.setSpindleVFDDirection("R", function (err) {
    //         if (err) {
    //             log.error(err);
    //         }
    //         callback();
    //     });
    // } else if (spindle_direction === "F" && spindle_DIR_set === "R") {
    //     spindle.setSpindleVFDDirection("F", function (err) {
    //         if (err) {
    //             log.error(err);
    //         }
    //         callback();
    //     });
    // }

    callback();

};