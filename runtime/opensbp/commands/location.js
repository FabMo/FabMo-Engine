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

function offsets(args, callback) {
    this.driver.get(
        //machine.driver??
        "mpo",

        async function (err, MPO) {
            var setVA_G2 = {};
            var unitConv = 1;
            var updtG55axes = "";
            if (this.driver.status.unit === "in") {
                //machine.driver
                // inches
                unitConv = 0.039370079;
            }
            // Process Lower Register for Required G55 Offset
            if (args[0] !== undefined) {
                // //X location
                setVA_G2.g55x = Number((MPO.x * unitConv - args[0]).toFixed(5));
                log.debug(
                    "    g55X" +
                        JSON.stringify(setVA_G2.g55x) +
                        "  MPO.x = " +
                        MPO.x +
                        " args[0] = " +
                        args[0]
                );
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
                    (MPO.a * 1.0 /*unitConv*/ - args[3]).toFixed(5) // no units for ABC
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

            // Make G10 update request for G2 if values present
            if (updtG55axes != "") {
                log.debug("G10 L2 P2 " + updtG55axes);
                this.stream.write("G10 L2 P2 " + updtG55axes);
                //this.emit_gcode("G10 L2 P2 " + updtG55axes);
            }
            // Update the FabMo config system including redundant post to G2
            try {
                await config.driver.setManyWrapper(setVA_G2);
                if (callback) {
                    // kludge to deal with calls coming from manual driver
                    callback();
                }
            } catch (error) {
                callback(error);
            }
        }.bind(this)
    );
}

exports.offsets = offsets;
