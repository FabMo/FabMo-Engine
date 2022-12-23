var log = require("../../../log").logger("sbp");
var g2 = require("../../../g2");
var sb3_commands = require("../sb3_commands");
var config = require("../../../config");
/* VALUES */

exports.VA = function (args, callback) {
    log.debug("VA Command: " + args);

    this.machine.driver.get(
        "mpo",
        async function (err, MPO) {
            var setVA_G2 = {};
            var setVA_SBP = {};
            var newLocation = 0;
            var unitConv = 1;
            var offset = 0;

            if (this.machine.driver.status.unit === "in") {
                // inches
                unitConv = 0.039370079;
            }

            if (args[6] !== undefined) {
                //X Base Coordinate
                this.emit_gcode("G28.3 X" + args[6]);
                MPO.x = args[6] / unitConv;
            }
            if (args[7] !== undefined) {
                //Y Base Coordinate
                this.emit_gcode("G28.3 Y" + args[7]);
                MPO.y = args[7] / unitConv;
            }
            if (args[8] !== undefined) {
                //Z Base Coordinate
                this.emit_gcode("G28.3 Z" + args[8]);
                MPO.z = args[8] / unitConv;
            }
            if (args[9] !== undefined) {
                //A Base Coordinate
                this.emit_gcode("G28.3 A" + args[9]);
                MPO.a = args[9]; // / unitConv; // No unit conversion for rotary
            }
            if (args[10] !== undefined) {
                //B Base Coordinate
                this.emit_gcode("G28.3 B" + args[10]);
                MPO.b = args[10]; // / unitConv; // No unit conversion for rotary
            }
            if (args[11] !== undefined) {
                //C Base Coordinate
                this.emit_gcode("G28.3 C" + args[11]);
                MPO.c = args[11]; // / unitConv; // No unit conversion for rotary
            }
            if (args[0] !== undefined) {
                //X location
                setVA_G2.g55x = Number((MPO.x * unitConv - args[0]).toFixed(5));
                log.debug(
                    "    g55X" +
                        JSON.stringify(setVA_G2.g55x) +
                        "  MPO.x = " +
                        MPO.x +
                        " args[0] = " +
                        args[0]
                );
                this.cmd_posx = this.posx = args[0];
            }
            if (args[1] !== undefined) {
                //Y location
                setVA_G2.g55y = Number((MPO.y * unitConv - args[1]).toFixed(5));
                log.debug(
                    "    g55Y" +
                        JSON.stringify(setVA_G2.g55y) +
                        "  MPO.y = " +
                        MPO.y +
                        " args[1] = " +
                        args[1]
                );
                this.cmd_posy = this.posy = args[1];
            }
            if (args[2] !== undefined) {
                //Z location
                setVA_G2.g55z = Number((MPO.z * unitConv - args[2]).toFixed(5));
                this.cmd_posz = this.posz = args[2];
            }
            if (args[3] !== undefined) {
                //A location
                setVA_G2.g55a = Number(
                    (MPO.a * 1.0 /*unitConv*/ - args[3]).toFixed(5)
                );
                this.cmd_posa = this.posa = args[3];
            }
            if (args[4] !== undefined) {
                //B location
                setVA_G2.g55b = Number(
                    (MPO.b * 1.0 /*unitConv*/ - args[4]).toFixed(5)
                );
                this.cmd_posb = this.posb = args[4];
            }
            if (args[5] !== undefined) {
                //C location
                setVA_G2.g55c = Number(
                    (MPO.c * 1.0 /*unitConv*/ - args[5]).toFixed(5)
                );
                this.cmd_posc = this.posc = args[5];
            }

            try {
                let values = await config.driver.setManyWrapper(setVA_G2);
                callback();
            } catch (error) {
                callback(error);
            }
        }.bind(this)
    );
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
        var unitType = args[2];
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
                break;
        }
        log.debug("VD:Converted X = " + this.cmd_posx);
        log.debug("VD:Converted Y = " + this.cmd_posy);
        log.debug("VD:Converted Z = " + this.cmd_posz);
    }
    // A Unit type
    // 	if ( args[3] !== undefined ) {
    // 		var unitType = args[3];
    // 		if ( unitType === 0 || unitType === 1 ){
    // 			if ( unitType === 0 ){
    // 				this.emit_gcode("G20"); // inches
    // 				log.debug("Changing units to inch");
    // 			}
    // 			else if ( unitType == 1 ){
    // 				this.emit_gcode=("G21"); // mm
    // 				log.debug("Changing units to mm");
    // 			}
    // 			else if ( unitType === 3 ){
    // // *************** Need output to set to degrees *************
    // 				this.emit_gcode("G21"); // deg
    // 				log.debug("Changing units to mm");
    // 			}
    // 		}
    // 	}
    // B Unit type
    // 	if ( args[4] !== undefined ) {
    // 		var unitType = args[4];
    // 		if ( unitType === 0 || unitType === 1 ){
    // 			if ( unitType === 0 ){
    // 				this.emit_gcode("G20"); // inches
    // 				log.debug("Changing units to inch");
    // 			}
    // 			else if ( unitType === 1 ){
    // 				this.emit_gcode("G21"); // mm
    // 				log.debug("Changing units to mm");
    // 			}
    // 			else if ( unitType === 3 ){
    // // *************** Need output to set to degrees *************
    // 				this.emit_gcode("G21"); // deg
    // 				log.debug("Changing units to mm");
    // 			}
    // 		}
    // 	}
    // C Unit type
    // 	if ( args[5] !== undefined ) {
    // 		var unitType = args[5];
    // 		if ( unitType === 0 || unitType === 1 ){
    // 			if ( unitType === 0 ){
    // 				this.emit_gcode("G20"); // inches
    // 				log.debug("Changing units to inch");
    // 			}
    // 			else if ( unitType === 1 ){
    // 				this.emit_gcode("G21"); // mm
    // 				log.debug("Changing units to mm");
    // 			}
    // 			else if ( unitType === 3 ){
    // // *************** Need output to set to degrees *************
    // 				this.emit_gcode("G21"); // deg
    // 				log.debug("Changing units to mm");
    // 			}
    // 		}
    // 	}

    // Show control console
    // Display File Comments
    // Keypad fixed distance
    // 	if ( args[8] !== undefined ){
    // 		var fDist = args[8];
    // //		log.debug("Keypad fixed distance set to: " + fDist );
    // 		log.debug("Fixed Distance setting not implemented" );
    // 	}
    // Keypad remote
    // Keypad Switch AutoOff
    // Write Part File Log
    // Write System File Log
    // Message Screen Location X
    // Message Screen Location Y
    // Message Screen Size X
    // Message Screen Size Y
    // Keypad outputs Auto-Off
    // Show file Progress
    // Main Display Type
    //	config.driver.setMany(g2_VD, function(err, values) {
    //		callback();
    //	});
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
        let values = await config.driver.setManyWrapper(g2_VI);
        callback();
    } catch (error) {
        callback(error);
    }
};

exports.VU = async function (args, callback) {
    var g2_VU = {};
    g2_VU[args[0]] = args[1];
    try {
        let values = await config.driver.setManyWrapper(g2_VU);
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
        let values = await config.driver.setManyWrapper(g2_VL);
        callback();
    } catch (error) {
        callback(error);
    }
};

//exports.VN = function(args) {
// Limits 0-OFF, 1-ON
// Input #4 Switch mode 0-Nrm Closed Stop, 1-Nrm Open Stop, 2-Not Used
// Enable Torch Height Controller, Laser or Analog Control
//		0-Off, 1-Torch, 2-Laser, 3-An1 Control, 4-An2 Control, 5-An1 & An2 Control

// Input Switch Modes = 0-Standard Switch, 1-Nrm Open Limit, 2-Nrm Closed Limit, 3-Nrm Open Stop, 4-Nrm Closed Stop
// Input #1 Switch mode
// Input #2 Switch mode
// Input #3 Switch mode
// Input #5 Switch mode
// Input #6 Switch mode
// Input #7 Switch mode
// Input #8 Switch mode
// Input #9 Switch mode
// Input #10 Switch mode
// Input #11 Switch mode
// Input #12 Switch mode
// Output Switch Modes = 0-StdON/FileOFF, 1-StdON/NoOFF, 2-StdON/LIStpOFF, 3-AutoON/FileOFF, 4-AutoON/NoOFF, 5-AutoON/FIStpOFF
// Output #1 Mode
// Output #2 Mode
// Output #3 Mode
// Output #5 Mode
// Output #6 Mode
// Output #7 Mode
// Output #8 Mode
// Output #9 Mode
// Output #10 Mode
// Output #11 Mode
// Output #12 Mode

//};

exports.VP = function (args) {
    // Grid
    // Table Size X
    // Table Size Y
    // Table Size Z
    // Simulate Cutting
    // Draw Tool
    // Start Actual Location
    // Show Jugs
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
    vs_change = 1;
    callback();
};

// exports.VS = function(args,callback) {
exports.VS = function (args) {
    var speed_change = 0.0;

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

//exports.VU = function(args,callback) {

//	var G2_2get = [	'1sa','1mi',
//					'2sa','2mi',
//					'3sa','3mi',
//					'4sa','4mi',
//					'5sa','5mi',
//					'6sa','6mi' ];

//	var SBP_2get = ['gearBoxRatio1',
//				    'gearBoxRatio2',
//				    'gearBoxRatio3',
//				    'gearBoxRatio4',
//				    'gearBoxRatio5',
//				    'gearBoxRatio6' ];

//	var SBunitVal = 0.0;
//	var g2_VU = {};
//	var sbp_VU = {};
//	var getG2_VU = config.driver.getMany(G2_2get);
//	var getSBP_VU = config.opensbp.getMany(SBP_2get);

//	log.debug("getG2_VU: " + JSON.stringify(getG2_VU));
//	log.debug("getSBP_VU: " + JSON.stringify(getSBP_VU));

// Channel 1 unit value
//	if (args[0] !== undefined){
//		sbp_VU.units1 = args[0];
//		g2_VU['1tr'] = ((360/getG2_VU['1sa']) * getG2_VU['1mi']) / sbp_VU.units1;
//	}
//	// Channel 2 unit value
//	if (args[1] !== undefined){
//		sbp_VU.units2 = args[1];
//		g2_VU['2tr'] = ((360/getG2_VU['2sa']) * getG2_VU['2mi']) / sbp_VU.units2;
//	}
// Channel 3 unit value
//	if (args[2] !== undefined){
//		sbp_VU.units3 = args[2];
//		g2_VU['3tr'] = ((360/getG2_VU['3sa']) * getG2_VU['3mi']) / sbp_VU.units3;
//	}
// Channel 4 unit value
//	if (args[3] !== undefined){
//		sbp_VU.units4 = args[3];
//		g2_VU['4tr'] = ((360/getG2_VU['4sa']) * getG2_VU['4mi']) / sbp_VU.units4;
//	}
// Channel 5 unit value
//	if (args[4] !== undefined){
//		sbp_VU.units5 = args[4];
//		g2_VU['5tr'] = ((360/getG2_VU['5sa']) * getG2_VU['5mi']) / sbp_VU.units5;
//	}
// Channel 6 unit value
// if (args[5] !== undefined){
// 	sbp_VU.units6 = args[5];
// 	g2_VU['6tr'] = ((360/getG2_VU['6sa']) * getG2_VU['6mi']) / sbp_VU.units6;
// }
// // Channel 1 multiplier
// if (args[6] !== undefined){}
// // Channel 2 multiplier
// if (args[7] !== undefined){}
// // Channel 3 multiplier
// if (args[8] !== undefined){}
// // Channel 4 multiplier
// if (args[9] !== undefined){}
// // Channel 5 multiplier
// if (args[10] !== undefined){}
// // Channel 6 multiplier
// if (args[11] !== undefined){}

// log.debug(JSON.stringify(sbp_VU));
// log.debug(JSON.stringify(g2_VU));

// We set the g2 config (Which updates the g2 hardware but also our persisted copy of its settings)
// 	config.opensbp.setMany(sbp_VU, function(err, values) {
// 		config.driver.setMany(g2_VU, function(err, values) {
// 			callback();
// 		});
// 	});
// };
