var log = require("../../../log").logger("sbp");
var config = require("../../../config");

// location.js provides 2 functions for the manipulation of location by several different commands
// These functions serve the VA Command, all the ZERO Commands, and ST
// ... Calls from the manual Keypad to to "Set Location" or "Zero" are still handled from there because of its quirkiness
// These functions are initiated with raw MPO values for location to be most universal
// In files, location requests from system variables are based on the immediate update to locations from here
// ... and do not depend on return of the updated location from G2.
// NOTES:
// {"mpo":""}  return absolute machine positions fox XYZABC axes.
// !!!!!!!!!!!! Always in mm, regardless of G20/G21 setting
// {"pos":""}  return work coordinate positions fox XYZABC axes.
//              In mm or inches depending on G20 or G21
// {"g55":""}  returns the current offset to the UCS origin
//              In mm or inches depending on G20 or G21

// Process G55 Offsets for a location change
//   * Started first, but this function completed only after Machine Base Location (from upper register) is set with G28.3
//   ... because the final offset needs to be applied after machine zeroing or location setting (e.g. ZT requires both)
function offsets(args, callback) {
    log.debug("Initiating location changes by getting CONFIG.MPO");
    //  this.driver.get(
    this.driver.get(
        //machine.driver??
        "mpo",
        async function (err, MPO) {
            log.debug("First part of  Offset Work");
            var setVA_G2 = {};
            var unitConv = 1;
            let updtG55axes = "";
            if (this.CUR_RUNTIME.units === "in") {
                // to inches
                unitConv = 0.039370079;
            }

            if (args[0] !== undefined) {
                // offset X location
                if (args[6] !== undefined) MPO.x = args[6] / unitConv;
                //                if (typeof args[6] === "number" && isFinite(args[6])) MPO.x = args[6] / unitConv;  // First handle any G28.3 adjustments from upper register
                setVA_G2.g55x = Number((MPO.x * unitConv - args[0]).toFixed(5));
                log.debug("   NEW g55X" + JSON.stringify(setVA_G2.g55x));
                updtG55axes += "X" + setVA_G2.g55x + " "; // start building axis request for G10 call
                this.cmd_posx = this.posx = args[0];
            }
            if (args[1] !== undefined) {
                //Y location
                if (args[7] !== undefined) MPO.y = args[7] / unitConv;
                setVA_G2.g55y = Number((MPO.y * unitConv - args[1]).toFixed(5));
                updtG55axes += "Y" + setVA_G2.g55y + " ";
                this.cmd_posy = this.posy = args[1];
            }
            if (args[2] !== undefined) {
                //Z location
                if (args[8] !== undefined) MPO.z = args[8] / unitConv;
                setVA_G2.g55z = Number((MPO.z * unitConv - args[2]).toFixed(5));
                updtG55axes += "Z" + setVA_G2.g55z + " ";
                this.cmd_posz = this.posz = args[2];
            }
            if (args[3] !== undefined) {
                //A location
                if (args[9] !== undefined) MPO.a = args[9];
                setVA_G2.g55a = Number(
                    (MPO.a * 1.0 /*unitConv*/ - args[3]).toFixed(5) // no units for rotary
                );
                updtG55axes += "A" + setVA_G2.g55a + " ";
                this.cmd_posa = this.posa = args[3];
            }
            if (args[4] !== undefined) {
                //B location
                if (args[10] !== undefined) MPO.b = args[10];
                setVA_G2.g55b = Number(
                    (MPO.b * 1.0 /*unitConv*/ - args[4]).toFixed(5)
                );
                updtG55axes += "B" + setVA_G2.g55b + " ";
                this.cmd_posb = this.posb = args[4];
            }
            if (args[5] !== undefined) {
                //C location
                if (args[11] !== undefined) MPO.c = args[11];
                setVA_G2.g55c = Number(
                    (MPO.c * 1.0 /*unitConv*/ - args[5]).toFixed(5)
                );
                updtG55axes += "C" + setVA_G2.g55c + " ";
                this.cmd_posc = this.posc = args[5];
            }

            try {
                await machineLoc(args); // Do the upper register updates first if there are any!
                log.debug("Completed machine location setting");
                if (updtG55axes != "") {
                    this.CUR_RUNTIME.emit_gcode("G10 L2 P2 " + updtG55axes);
                    this.CUR_RUNTIME.gcodesPending = false;
                    await config.driver.setManyWrapper(setVA_G2); // syncs FabMo and G2 configs
                }
                this.CUR_RUNTIME.emit_gcode("M0");
                if (callback) {
                    callback(log.debug("Completed offsets setting"));
                }
            } catch (error) {
                log.error(error);
            }
            return;
        }
    );
}

// Process Machine Base Location to set Zero or other Value
//   * This (upper register) function completed first in a location change call before final offsetting (lower register)
async function machineLoc(args) {
    log.debug("STARTING machineLoc change - UPPER Register > " + args);
    // Process Upper Register for Setting Machine Location (needs to be done before offsets if there are any)
    const subArgs = args.slice(6, 11); // Check to see if there are any values in top of array
    if (subArgs.some((val) => val !== undefined)) {
        log.debug("Found Machine Base Changes now being Processed First!");
        let updtMachineLoc = "";

        if (args[6] !== undefined) {
            // set X Machine Base Coordinate
            updtMachineLoc += "X" + args[6];
        }
        if (args[7] !== undefined) {
            // set Y Machine Base Coordinate
            updtMachineLoc += "Y" + args[7];
        }
        if (args[8] !== undefined) {
            // set Z Machine Base Coordinate
            updtMachineLoc += "Z" + args[8];
        }
        if (args[9] !== undefined) {
            // set A Machine Base Coordinate
            updtMachineLoc += "A" + args[9];
        }
        if (args[10] !== undefined) {
            // set B Machine Base Coordinate
            updtMachineLoc += "B" + args[10];
        }
        if (args[11] !== undefined) {
            // set C Machine Base Coordinate
            updtMachineLoc += "C" + args[11];
        }

        try {
            await this.CUR_RUNTIME.emit_gcode("G28.3 " + updtMachineLoc);
            this.CUR_RUNTIME.emit_gcode("M0");
        } catch (error) {
            log.debug(error);
        }
    } else {
        log.debug("--> No Machine Base Value Changes in this location command");
    }
}

exports.offsets = offsets;
exports.machineLoc = machineLoc;
