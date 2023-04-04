var log = require("../../../log").logger("sbp");
var config = require("../../../config");

const { offsets } = require("./location");
//const { machineLoc } = require("./location");

/* VALUES */

exports.VA = function (args, callback) {
    log.debug("VA Command: " + args);
    // VA Command is complex because in gcode terms it is two commands: the lower "args" register of 6 parameters emits a
    //   ... G10 L2 P2 (setting g55 offsets) and the upper register emits a G28.3 (setting axes to absolute locations,
    //   ... optionally zero). If it has changes, the upper register is executed first; then changes to the g55 values
    //   ... are applied, if there are any.
    // New values included in the command replace existing G55 values.
    // Note that the number entered into the offset register is not the new g55 value itself, but is the new desired
    //   ... location, from which a new g55 is computed.

    // // Process Upper Register for Setting Machine Location (needs to be done before offsets if there are any)
    // const subArgs = args.slice(6, 11); // Check to see if there are any in top of array
    // if (subArgs.some((val) => val !== undefined)) {
    //     log.debug("Machine Base Changes being Processed First!");
    //     machineLoc.call(this, args, callback);
    // } else {
    //     log.debug("--> No Machine Base Value Changes in this VA");
    // }
    //    log.debug("####-> Calling machineLoc for VA");
    //    machineLoc.call(this, args, callback);
    log.debug("####-> Calling offsets for VA");
    offsets.call(this, args, callback);

    // }
    // if (axes !== undefined) {         // then pass this to the location.js functions
    //     //X Base Coordinate
    //     machineLoc.call(this, axes, callback);
    //     //    this.emit_gcode("G28.3 X" + args[6]);
    //     //    MPO.x = args[6] / unitConv;
    // }

    //Process Lower Register for Required G55 Offset (needs to follow after machine base location is reset, if reset)
    //    if (args[0] !== undefined) {
    // //X location
    //    axes[0] = args[0];
    //        offsets.call(this, args, callback);

    // setVA_G2.g55x = Number((MPO.x * unitConv - args[0]).toFixed(5));
    // log.debug(
    //     "    g55X" +
    //         JSON.stringify(setVA_G2.g55x) +
    //         "  MPO.x = " +
    //         MPO.x +
    //         " args[0] = " +
    //         args[0]
    // );
    // updtG55axes += "X" + setVA_G2.g55x + " ";    // start building axis request for G10 call
    // this.cmd_posx = this.posx = args[0];
    //    }
    // if (args[1] !== undefined) {
    //     //Y location
    //     setVA_G2.g55y = Number((MPO.y * unitConv - args[1]).toFixed(5));
    //     updtG55axes += "Y" + setVA_G2.g55y + " ";
    //     this.cmd_posy = this.posy = args[1];
    // }
    // if (args[2] !== undefined) {
    //     //Z location
    //     setVA_G2.g55z = Number((MPO.z * unitConv - args[2]).toFixed(5));
    //     updtG55axes += "Z" + setVA_G2.g55z + " ";
    //     this.cmd_posz = this.posz = args[2];
    // }
    // if (args[3] !== undefined) {
    //     //A location
    //     setVA_G2.g55a = Number(
    //         (MPO.a * 1.0 /*unitConv*/ - args[3]).toFixed(5)
    //     );
    //     updtG55axes += "A" + setVA_G2.g55a + " ";
    //     this.cmd_posa = this.posa = args[3];
    // }
    // if (args[4] !== undefined) {
    //     //B location
    //     setVA_G2.g55b = Number(
    //         (MPO.b * 1.0 /*unitConv*/ - args[4]).toFixed(5)
    //     );
    //     updtG55axes += "B" + setVA_G2.g55b + " ";
    //     this.cmd_posb = this.posb = args[4];
    // }
    // if (args[5] !== undefined) {
    //     //C location
    //     setVA_G2.g55c = Number(
    //         (MPO.c * 1.0 /*unitConv*/ - args[5]).toFixed(5)
    //     );
    //     updtG55axes += "C" + setVA_G2.g55c + " ";
    //     this.cmd_posc = this.posc = args[5];
    // }

    // if (updtG55axes != "") {
    //     // Make G10 update request if values present
    //     log.debug("G10 L2 P2 " + updtG55axes);
    //     this.emit_gcode("G10 L2 P2 " + updtG55axes);
    // }

    //         try {
    //             await config.driver.setManyWrapper(setVA_G2);
    //             callback();
    //         } catch (error) {
    //             callback(error);
    //         }
    //     }.bind(this)
    // );
};

exports.VC = function (args, callback) {
    var sbp_values = {};

    if (args[0] !== undefined) {
        //args[0] = sbp_settings.cutterDia	// Cutter Diameter
        sbp_values.cutterDia = args[0];
    }
    // args[1] = Obsolete
    // args[2] = Obsolete
    if (args[3] !== undefined) {
        //Safe Z Pull Up
        sbp_values.safeZpullUp = args[3];
    }
    //	if (args[4] !== undefined) { 	// Plunge Direction
    //	}
    if (args[5] !== undefined) {
        // % Pocket Overlap for CR and CG commands
        sbp_values.pocketOverlap = args[5];
    }
    if (args[6] !== undefined) {
        // Safe A Pull Up
        sbp_values.safeApullUp = args[6];
    }
    // args[7] = triggeredOutput		// triggered output switch
    // args[8] = triggerONthreshold		// trigger ON threshold
    // args[9] = triggerOFFthreshold	// trigger OFF threshold
    // args[10] = vertAxisMonitor		// vertical axis monitored
    // args[11] = triggerOutputNum		// triggered output switch #

    // eslint-disable-next-line no-unused-vars
    config.opensbp.setMany(sbp_values, function (err, values) {
        log.debug("VC-sbp_values = " + JSON.stringify(sbp_values));
        callback();
    });
};

exports.VD = function (args) {
    // For all axes - the values are:
    //    0=Disable; 1=Standard Mode; 2=Inhibited; 3=Radius Mode
    // XYZ Unit type
    if (args[2] !== undefined) {
        log.debug("VD:Current X = " + this.cmd_posx);
        log.debug("VD:Current Y = " + this.cmd_posy);
        log.debug("VD:Current Z = " + this.cmd_posz);
        switch (args[2]) {
            case 0:
                this.emit_gcode("G20"); // inches
                this._setUnits("in");
                log.debug("VD: returned from setting units to in");
                break;

            case 1:
                this.emit_gcode("G21");
                this._setUnits("mm");
                log.debug("VD: returned from setting units to mm");
                break;
            default:
                throw new Error("Invalid unit setting: " + args[2]);
        }
        log.debug("VD:Converted X = " + this.cmd_posx);
        log.debug("VD:Converted Y = " + this.cmd_posy);
        log.debug("VD:Converted Z = " + this.cmd_posz);
    }
};

exports.VI = async function (args, callback) {
    var g2_VI = {};

    // Driver 1 Channel
    if (args[0] !== undefined) {
        var res1 = "xyzabcXYZABC".indexOf(String(args[0]));
        if (res1 >= 0 && res1 <= 5) {
            g2_VI["1ma"] = res1;
        } else if (res1 >= 6 && res1 <= 11) {
            g2_VI["1ma"] = res1 - 6;
        } else {
            throw new Error("VI-CH1: parameter " + args[0] + " out of range!");
        }
    }
    // Driver 2 Channel
    if (args[1] !== undefined) {
        var res2 = "xyzabcXYZABC".indexOf(String(args[1]));
        if (res2 >= 0 && res2 <= 5) {
            g2_VI["2ma"] = res2;
        } else if (res2 >= 6 && res2 <= 11) {
            g2_VI["2ma"] = res2 - 6;
        } else {
            throw new Error("VI-CH1: parameter " + args[1] + " out of range!");
        }
    }
    // Driver 3 Channel
    if (args[2] !== undefined) {
        var res3 = "xyzabcXYZABC".indexOf(String(args[2]));
        if (res3 >= 0 && res3 <= 5) {
            g2_VI["3ma"] = res3;
        } else if (res3 >= 6 && res3 <= 11) {
            g2_VI["3ma"] = res3 - 6;
        } else {
            throw new Error("VI-CH1: parameter " + args[2] + " out of range!");
        }
    }
    // Driver 4 Channel
    if (args[3] !== undefined) {
        var res4 = "xyzabcXYZABC".indexOf(String(args[3]));
        if (res4 >= 0 && res4 <= 5) {
            g2_VI["4ma"] = res4;
        } else if (res4 >= 6 && res4 <= 11) {
            g2_VI["4ma"] = res4 - 6;
        } else {
            throw new Error("VI-CH1: parameter " + args[3] + " out of range!");
        }
    }
    // Driver 5 Channel
    if (args[4] !== undefined) {
        var res5 = "xyzabcXYZABC".indexOf(String(args[4]));
        if (res5 >= 0 && res5 <= 5) {
            g2_VI["5ma"] = res5;
        } else if (res5 >= 6 && res5 <= 11) {
            g2_VI["5ma"] = res5 - 6;
        } else {
            throw new Error("VI-CH1: parameter " + args[4] + " out of range!");
        }
    }
    // Driver 6 Channel
    if (args[5] !== undefined) {
        var res6 = "xyzabcXYZABC".indexOf(String(args[5]));
        if (res6 >= 0 && res6 <= 5) {
            g2_VI["6ma"] = res6;
        } else if (res6 >= 6 && res6 <= 11) {
            g2_VI["6ma"] = res6 - 6;
        } else {
            throw new Error("VI-CH1: parameter " + args[5] + " out of range!");
        }
    }
    try {
        await config.driver.setManyWrapper(g2_VI);
        callback();
    } catch (error) {
        callback(error);
    }
};

exports.VU = async function (args, callback) {
    var g2_VU = {};
    g2_VU[args[0]] = args[1];
    try {
        await config.driver.setManyWrapper(g2_VU);
        callback();
    } catch (error) {
        callback(error);
    }
};

exports.VL = async function (args, callback) {
    var g2_VL = {};

    // X - Low Limit
    if (args[0] !== undefined) {
        g2_VL.xtn = args[0];
    }
    // X - High Limit
    if (args[1] !== undefined) {
        g2_VL.xtm = args[1];
    }
    // Y - Low Limit
    if (args[2] !== undefined) {
        g2_VL.ytn = args[2];
    }
    // Y - High Limit
    if (args[3] !== undefined) {
        g2_VL.ytm = args[3];
    }
    // Z - Low Limit
    if (args[4] !== undefined) {
        g2_VL.ztn = args[4];
    }
    // Z - High Limit
    if (args[5] !== undefined) {
        g2_VL.ztm = args[5];
    }
    // A - Low Limit
    if (args[6] !== undefined) {
        g2_VL.atn = args[6];
    }
    // A - High Limit
    if (args[7] !== undefined) {
        g2_VL.atm = args[7];
    }
    // Soft limit checking ON-OFF

    // B - Low Limit
    if (args[9] !== undefined) {
        g2_VL.btn = args[9];
    }
    // B - High Limit
    if (args[10] !== undefined) {
        g2_VL.btm = args[10];
    }
    // Number of axes limits to check

    // C - Low Limit
    if (args[12] !== undefined) {
        g2_VL.ctn = args[12];
    }
    // C - High Limit
    if (args[13] !== undefined) {
        g2_VL.ctm = args[13];
    }

    try {
        await config.driver.setManyWrapper(g2_VL);
        callback();
    } catch (error) {
        callback(error);
    }
};

exports.VR = function (args, callback) {
    // XY Move Ramp Speed
    if (args[0] !== undefined) {
        this.maxjerk_xy = args[0];
        this.machine.driver.command({ xjm: this.maxjerk_xy });
        this.machine.driver.command({ yjm: this.maxjerk_xy });
    }
    // Z Move Ramp Speed = args[0];
    if (args[1] !== undefined) {
        this.maxjerk_z = args[1];
        this.machine.driver.command({ zjm: this.maxjerk_z });
    }
    // A Move Ramp Speed
    if (args[2] !== undefined) {
        this.maxjerk_a = args[2];
        this.machine.driver.command({ ajm: this.maxjerk_a });
    }
    // B Move Ramp Speed
    if (args[3] !== undefined) {
        this.maxjerk_b = args[3];
        this.machine.driver.command({ bjm: this.maxjerk_b });
    }
    // C Move Ramp Speed
    if (args[4] !== undefined) {
        this.maxjerk_c = args[4];
        this.machine.driver.command({ cjm: this.maxjerk_c });
    }
    // [JT] Junction Integration Time
    if (args[5] !== undefined) {
        this.jt = args[5];
        this.machine.driver.command({ jt: this.jt });
    }
    // [CT] Chordal Tolerance
    if (args[6] !== undefined) {
        this.chordalTol = args[6];
        this.machine.driver.command({ ct: this.chordalTol });
    }
    callback();
};

exports.VS = function (args) {
    //Set XY move speed
    if (args[0] !== undefined) {
        this.movespeed_xy = args[0];
    }
    //Set Z move speed
    if (args[1] !== undefined) {
        this.movespeed_z = args[1];
    }
    //Set A move speed
    if (args[2] !== undefined) {
        this.movespeed_a = args[2];
    }
    //Set B move speed
    if (args[3] !== undefined) {
        this.movespeed_b = args[3];
    }
    //Set C move speed
    if (args[4] !== undefined) {
        this.movespeed_c = args[4];
    }
    //Set XY jog speed
    if (args[5] !== undefined) {
        this.jogspeed_xy = args[5];
    }
    //Set Z jog speed
    if (args[6] !== undefined) {
        this.jogspeed_z = args[6];
    }
    //Set A jog speed
    if (args[7] !== undefined) {
        this.jogspeed_a = args[7];
    }
    //Set B jog speed
    if (args[8] !== undefined) {
        this.jogspeed_b = args[8];
    }
    //Set C jog speed
    if (args[9] !== undefined) {
        this.jogspeed_c = args[9];
    }

    this.vs_change = 1;
};
