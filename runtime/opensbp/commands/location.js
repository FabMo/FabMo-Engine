var log = require("../../../log").logger("sbp");
var config = require("../../../config");

// location.js provides 2 functions for the common manipulation of location
// These functions serve the VA Command, all the ZERO Commands, and calls to "Set Location" or
//     "Zero" an axis in the manual Keypad
// These functions are done with raw MPO values for location to be most universal

// NOTES:

// {"mpo":""}  return absolute machine positions fox XYZABC axes.
// !!!!!!!!!!!! Always in mm, regardless of G20/G21 setting

// {"pos":""}  return work coordinate positions fox XYZABC axes.
//              In mm or inches depending on G20 or G21

// {"g55":""}  returns the current offset to the UCS origin
//              In mm or inches depending on G20 or G21

// Process for G55 Offsets
//   *This function called second in VA if Machine Base Location is also being set (upper register)
//   ... because the G55 needs to be applied after; full zeroing (ZT) requires both
function offsets(args, callback) {
    log.debug("##-> GETTING CONFIG.MPO FIRST");
    this.driver.get(
        //machine.driver??
        "mpo",
        async function (err, MPO) {
            log.debug("##->RETURNING this work from LOWER AS ASYNC FUNCTION");
            var setVA_G2 = {};
            var unitConv = 1;
            var updtG55axes = "";
            if (this.CUR_RUNTIME.units === "in") {
                // kludge for machine.driver
                // to inches
                unitConv = 0.039370079;
            }

            if (args[0] !== undefined) {
                // offset X location
                setVA_G2.g55x = Number((MPO.x * unitConv - args[0]).toFixed(5));
                /*log.debug(
                    "    g55X" +
                        JSON.stringify(setVA_G2.g55x) +
                        "  MPO.x = " +
                        MPO.x +
                        " args[0] = " +
                        args[0]
                );*/
                updtG55axes += "X" + setVA_G2.g55x + " "; // start building axis request for G10 call
                this.cmd_posx = this.posx = args[0];
            }
            if (args[1] !== undefined) {
                //Y location
                setVA_G2.g55y = Number((MPO.y * unitConv - args[1]).toFixed(5));
                updtG55axes += "Y" + setVA_G2.g55y + " ";
                this.cmd_posy = this.posy = args[1];
            }
            if (args[2] !== undefined) {
                //Z location
                setVA_G2.g55z = Number((MPO.z * unitConv - args[2]).toFixed(5));
                updtG55axes += "Z" + setVA_G2.g55z + " ";
                this.cmd_posz = this.posz = args[2];
            }
            if (args[3] !== undefined) {
                //A location
                setVA_G2.g55a = Number(
                    (MPO.a * 1.0 /*unitConv*/ - args[3]).toFixed(5) // no units for rotary
                );
                updtG55axes += "A" + setVA_G2.g55a + " ";
                this.cmd_posa = this.posa = args[3];
            }
            if (args[4] !== undefined) {
                //B location
                setVA_G2.g55b = Number(
                    (MPO.b * 1.0 /*unitConv*/ - args[4]).toFixed(5)
                );
                updtG55axes += "B" + setVA_G2.g55b + " ";
                this.cmd_posb = this.posb = args[4];
            }
            if (args[5] !== undefined) {
                //C location
                setVA_G2.g55c = Number(
                    (MPO.c * 1.0 /*unitConv*/ - args[5]).toFixed(5)
                );
                updtG55axes += "C" + setVA_G2.g55c + " ";
                this.cmd_posc = this.posc = args[5];
            }

            if (updtG55axes != "") {
                try {
                    //this.CUR_RUNTIME.machine.executeRuntimeCode("gcode", ("G10 L2 P2 " + updtG55axes));
                    await this.CUR_RUNTIME.emit_gcode(
                        "G10 L2 P2 " + updtG55axes
                    );
                    log.debug("##-> FINISHED AWAIT G10");
                    //await this.CUR_RUNTIME.driver._write("G10 L2 P2 " + updtG55axes);
                    await config.driver.setManyWrapper(setVA_G2); // syncs FabMo and G2 configs
                    log.debug("##-> FINISHED AWAIT CONFIG - LOWER");
                    // This command updates G55 settings in FabMo and makes sure they are synced with G2.
                    // ... They have already been redundantly (temporarily) set in G2 by the G10 call.
                    //await this.CUR_RUNTIME.driver.requestStatusReport("stat");
                    if (callback) {
                        log.debug("##-> at CALLBACK at END OF OFFSET");
                        // kludge to deal with calls coming from manual driver
                        callback(
                            log.debug(
                                "##-> CALLBACK at return to call for OFFSET"
                            )
                        );
                    }
                } catch (error) {
                    log.error(error);
                }
                return;
            }
        }
    );
}

// Setting Machine Base Location to Zero or other Value
//   * This function called first by VA for case of also having G55 Offsets (lower register)
function machineLoc(args, callback) {
    log.debug("##-> GETTING CONFIG.MPO - UPPER");

    this.driver.get(
        //machine.driver??
        "mpo",

        async function (err, MPO) {
            log.debug("##->RETURNING this work from UPPER AS ASYNC FUNCTION");
            var setVA_G2 = {};
            var unitConv = 1;
            var updtMachineLoc = "";
            if (this.driver.status.unit === "in") {
                //machine.driver??
                // to inches
                unitConv = 0.039370079;
            }

            if (args[6] !== undefined) {
                // set X Machine Base Coordinate
                updtMachineLoc += "X" + args[6];
                MPO.x = args[6] / unitConv;
            }
            if (args[7] !== undefined) {
                //Y Machine Base Coordinate
                updtMachineLoc += "Y" + args[7];
                MPO.y = args[7] / unitConv;
            }
            if (args[8] !== undefined) {
                //Z Machine Base Coordinate
                updtMachineLoc += "Z" + args[8];
                MPO.z = args[8] / unitConv;
            }
            if (args[9] !== undefined) {
                //A Machine Base Coordinate
                updtMachineLoc += "A" + args[9];
                MPO.a = args[9]; // / unitConv; // No unit conversion for rotary
            }
            if (args[10] !== undefined) {
                //B Machine Base Coordinate
                updtMachineLoc += "B" + args[10];
                MPO.b = args[10];
            }
            if (args[11] !== undefined) {
                //C Machine Base Coordinate
                updtMachineLoc += "C" + args[11];
                MPO.c = args[11];
            }

            // Make G28.3 update request for G2 if values present
            if (updtMachineLoc != "") {
                log.debug("G28.3 " + updtMachineLoc);
                this.stream.write("G28.3 " + updtMachineLoc);
            }

            // Update the FabMo config system including redundant post to G2
            try {
                await config.driver.setManyWrapper(setVA_G2);
                log.debug("##-> FINISHED AWAIT CONFIG - UPPER");
                // await this.driver.requestStatusReport();
                if (callback) {
                    // kludge to deal with calls coming from manual driver
                    log.debug("##-> CALLBACK at return from MACHINELOC");
                    callback(offsets.call(this, args, callback));
                    //callback(log.debug("##-> CALLBACK return from MACHINELOC"));
                }
            } catch (error) {
                callback(error);
            }
        }.bind(this)
    );
}

exports.offsets = offsets;
exports.machineLoc = machineLoc;
