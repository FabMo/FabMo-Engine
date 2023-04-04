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
    //  this.driver.get(
    this.driver.get(
        //machine.driver??
        "mpo",
        async function (err, MPO) {
            log.debug("##->Then Returning Offset Work as AS ASYNC FUNCTION");
            var setVA_G2 = {};
            var unitConv = 1;
            let updtG55axes = "";
            if (this.CUR_RUNTIME.units === "in") {
                // kludge for machine.driver
                // to inches
                unitConv = 0.039370079;
            }

            if (args[0] !== undefined) {
                // offset X location
                setVA_G2.g55x = Number((MPO.x * unitConv - args[0]).toFixed(5));
                log.debug("   NEW g55X" + JSON.stringify(setVA_G2.g55x));
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
                    await machineLoc(args);
                    this.CUR_RUNTIME.emit_gcode("G10 L2 P2 " + updtG55axes);
                    this.CUR_RUNTIME.gcodesPending = false;
                    await config.driver.setManyWrapper(setVA_G2); // syncs FabMo and G2 configs
                    log.debug("##-> FINISHED AWAIT CONFIG SYNC - LOWER");
                    //log.debug("##-> FINISHED setup for G55 Offseting");
                    log.debug("writing > M0");
                    this.CUR_RUNTIME.emit_gcode("M0");

                    if (callback) {
                        // kludge to deal with calls coming from manual driver
                        callback(
                            log.debug(
                                "####-> Returning main callback from OFFSETS"
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
async function machineLoc(args) {
    log.debug("##-> STARTING machineLoc - UPPER > " + args);

    let updtMachineLoc = "X0";
    if (updtMachineLoc != "") {
        //try {
        //    await config.driver.setManyWrapper(setVA_G2);
        //    log.debug("##-> FINISHED AWAIT CONFIG - UPPER");
        // await this.driver.requestStatusReport();
        try {
            await this.CUR_RUNTIME.emit_gcode("G28.3 " + updtMachineLoc);
            this.CUR_RUNTIME.emit_gcode("M0");
            // if (callback) {
            //     callback(offsets.call(this, args, callback));
            //     callback(offsets.call(this, args, callback));
            // }
        } catch (error) {
            log.debug(error);
            //callback(error);
        }
    }
}

//     this.CUR_RUNTIME.driver.get(
//         //machine.driver??
//         "mpo",

//         async function (err, MPO) {
//             log.debug("##->RETURNING this work from UPPER AS ASYNC FUNCTION");
//             var setVA_G2 = {};
//             var unitConv = 1;
//             let updtMachineLoc = "";
//             if (this.CUR_RUNTIME.units === "in") {
//                 //machine.driver??
//                 // to inches
//                 unitConv = 0.039370079;
//             }

//             if (args[6] !== undefined) {
//                 // set X Machine Base Coordinate
//                 updtMachineLoc += "X" + args[6];
//                 MPO.x = args[6] / unitConv;
//             }
//             if (args[7] !== undefined) {
//                 //Y Machine Base Coordinate
//                 updtMachineLoc += "Y" + args[7];
//                 MPO.y = args[7] / unitConv;
//             }
//             if (args[8] !== undefined) {
//                 //Z Machine Base Coordinate
//                 updtMachineLoc += "Z" + args[8];
//                 MPO.z = args[8] / unitConv;
//             }
//             if (args[9] !== undefined) {
//                 //A Machine Base Coordinate
//                 updtMachineLoc += "A" + args[9];
//                 MPO.a = args[9]; // / unitConv; // No unit conversion for rotary
//             }
//             if (args[10] !== undefined) {
//                 //B Machine Base Coordinate
//                 updtMachineLoc += "B" + args[10];
//                 MPO.b = args[10];
//             }
//             if (args[11] !== undefined) {
//                 //C Machine Base Coordinate
//                 updtMachineLoc += "C" + args[11];
//                 MPO.c = args[11];
//             }

//             // // Make G28.3 update request for G2 if values present
//             // if (updtMachineLoc != "") {
//             //     log.debug("G28.3 " + updtMachineLoc);
//             //     this.CUR_RUNTIME.emit_gcode("G28.3 " + updtMachineLoc);
//             // }

//             if (updtMachineLoc != "") {
//                 try {
//                     await this.CUR_RUNTIME.emit_gcode("G28.3 " + updtMachineLoc);
//                 //    await config.driver.setManyWrapper(setVA_G2);
//                 //    log.debug("##-> FINISHED AWAIT CONFIG - UPPER");
//                     // await this.driver.requestStatusReport();
//                     if (callback) {
//                         // kludge to deal with calls coming from manual driver
//                         //log.debug("##-> CALLBACK at return from MACHINELOC");
//                         //callback(offsets.call(this, args, callback));
//                         callback(log.debug("##-> CALLBACK return from MACHINELOC"));
//                     }
//                 } catch (error) {
//                     callback(error);
//                 }
//             }

exports.offsets = offsets;
exports.machineLoc = machineLoc;
