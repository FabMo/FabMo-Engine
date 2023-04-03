//var log = require("../../../log").logger("sbp");
var config = require("../../../config");

const { offsets } = require("./location");

/* ZERO */

// See Notes in location.js for offsetting and zeroing commands and functions
// U,V,W not yet covered!

exports.ZX = function (args, callback) {
    log.debug("####-> Calling Offsets for ZX");
    args = [];
    args[0] = 0;
    offsets.call(this, args, callback);
};

exports.ZY = function (args, callback) {
    args = [];
    args[1] = 0;
    offsets.call(this, args, callback);
};

exports.ZZ = function (args, callback) {
    log.debug("####-> Calling Offsets for ZZ");
    args = [];
    args[2] = 0;
    offsets.call(this, args, callback);
};

exports.ZA = function (args, callback) {
    args = [];
    args[3] = 0;
    offsets.call(this, args, callback);
};

exports.ZB = function (args, callback) {
    args = [];
    args[4] = 0;
    offsets.call(this, args, callback);
};

exports.ZC = function (args, callback) {
    args = [];
    args[5] = 0;
    offsets.call(this, args, callback);
};

exports.Z2 = function (args, callback) {
    args = [];
    args[0] = 0;
    args[1] = 0;
    offsets.call(this, args, callback);
};

exports.Z3 = function (args, callback) {
    log.debug("####-> Calling Offsets for Z3");
    args = [];
    args[0] = 0;
    args[1] = 0;
    args[2] = 0;
    offsets.call(this, args, callback);
};

exports.Z4 = function (args, callback) {
    args = [];
    args[0] = 0;
    args[1] = 0;
    args[2] = 0;
    args[3] = 0;
    offsets.call(this, args, callback);
};

exports.Z5 = function (args, callback) {
    args = [];
    args[0] = 0;
    args[1] = 0;
    args[2] = 0;
    args[3] = 0;
    args[4] = 0;
    offsets.call(this, args, callback);
};

exports.Z6 = function (args, callback) {
    args = [];
    args[0] = 0;
    args[1] = 0;
    args[2] = 0;
    args[3] = 0;
    args[4] = 0;
    args[5] = 0;
    offsets.call(this, args, callback);
};

// // Will need to attend to U,V,W at some point
// exports.ZT = async function (args, callback) {
//     var ztObj = {};
//     ztObj.g55x = 0.0;
//     ztObj.g55y = 0.0;
//     ztObj.g55z = 0.0;
//     ztObj.g55a = 0.0;
//     ztObj.g55b = 0.0;
//     ztObj.g55c = 0.0;
//     this.emit_gcode("G28.3 X0 Y0 Z0 A0 B0 C0");
//     try {
//         await config.driver.setManyWrapper(ztObj);
//         this.cmd_posx = this.posx = 0.0;
//         this.cmd_posy = this.posy = 0.0;
//         this.cmd_posz = this.posz = 0.0;
//         this.cmd_posa = this.posa = 0.0;
//         this.cmd_posb = this.posb = 0.0;
//         this.cmd_posc = this.posc = 0.0;
//         // TODO: Do we need this report on ZT CMD?
//         // If so and callback should follow report we will need to async/await wrapper that as well.
//         this.driver.requestStatusReportWrapper(function(report) {
//         	log.debug("report = " + JSON.stringify(report));
//         	callback();
//         });
//         callback();
//     } catch (error) {
//         callback(error);
//     }
// };

exports.ZT = async function (args, callback) {
    var ztObj = {};
    ztObj.g55x = 0.0;
    ztObj.g55y = 0.0;
    ztObj.g55z = 0.0;
    ztObj.g55a = 0.0;
    ztObj.g55b = 0.0;
    ztObj.g55c = 0.0;
    this.emit_gcode("G28.3 X0 Y0 Z0 A0 B0 C0");
    try {
        await config.driver.setManyWrapper(ztObj);
        this.cmd_posx = this.posx = 0.0;
        this.cmd_posy = this.posy = 0.0;
        this.cmd_posz = this.posz = 0.0;
        this.cmd_posa = this.posa = 0.0;
        this.cmd_posb = this.posb = 0.0;
        this.cmd_posc = this.posc = 0.0;
        // TODO: Do we need this report on ZT CMD?
        // If so and callback should follow report we will need to async/await wrapper that as well.
        //        log.debug("Ready for Status Report request ... waiting");
        //        await this.driver.requestStatusReportWrapper(function(report) {
        //        	log.debug("report = " + JSON.stringify(report));
        //        	callback();
        //        });
        callback();
    } catch (error) {
        callback(error);
    }
};
