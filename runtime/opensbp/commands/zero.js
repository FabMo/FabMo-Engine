//var log = require("../../../log").logger("sbp");
var config = require("../../../config");

const { offsets } = require("./location");

/* ZERO */

// See Notes in location.js for offsetting and zeroing commands and functions
// U,V,W not yet covered!

const axes = []; // X=0

exports.ZX = function (args, callback) {
    axes[0] = 0;
    offsets.call(this, axes, callback);
};

exports.ZY = function (args, callback) {
    axes[1] = 0;
    offsets.call(this, axes, callback);
};

exports.ZZ = function (args, callback) {
    axes[2] = 0;
    offsets.call(this, axes, callback);
};

exports.ZA = function (args, callback) {
    axes[3] = 0;
    offsets.call(this, axes, callback);
};

exports.ZB = function (args, callback) {
    axes[4] = 0;
    offsets.call(this, axes, callback);
};

exports.ZC = function (args, callback) {
    axes[5] = 0;
    offsets.call(this, axes, callback);
};

exports.Z2 = function (args, callback) {
    axes[0] = 0;
    axes[1] = 0;
    offsets.call(this, axes, callback);
};

exports.Z3 = function (args, callback) {
    axes[0] = 0;
    axes[1] = 0;
    axes[2] = 0;
    offsets.call(this, axes, callback);
};

exports.Z4 = function (args, callback) {
    axes[0] = 0;
    axes[1] = 0;
    axes[2] = 0;
    axes[3] = 0;
    offsets.call(this, axes, callback);
};

exports.Z5 = function (args, callback) {
    axes[0] = 0;
    axes[1] = 0;
    axes[2] = 0;
    axes[3] = 0;
    axes[4] = 0;
    offsets.call(this, axes, callback);
};

exports.Z6 = function (args, callback) {
    axes[0] = 0;
    axes[1] = 0;
    axes[2] = 0;
    axes[3] = 0;
    axes[4] = 0;
    axes[5] = 0;
    offsets.call(this, axes, callback);
};

// exports.Z2 = function (args, callback) {
//     this.machine.driver.get(
//         "mpo",
//         async function (err, MPO) {
//             if (err) {
//                 return callback(err);
//             }
//             var z2Obj = {};
//             var unitConv = 1.0;
//             if (this.machine.driver.status.unit === "in") {
//                 // inches
//                 unitConv = 0.039370079;
//             }
//             z2Obj.g55x = Number((MPO.x * unitConv).toFixed(5));
//             z2Obj.g55y = Number((MPO.y * unitConv).toFixed(5));
//             try {
//                 await config.driver.setManyWrapper(z2Obj);
//                 this.cmd_posx = this.posx = 0;
//                 this.cmd_posy = this.posy = 0;
//                 callback();
//             } catch (error) {
//                 callback(error);
//             }
//         }.bind(this)
//     );
// };

// exports.Z3 = function (args, callback) {
//     this.machine.driver.get(
//         "mpo",
//         async function (err, MPO) {
//             if (err) {
//                 return callback(err);
//             }
//             var z3Obj = {};
//             log.debug(JSON.stringify(MPO));
//             var unitConv = 1.0;
//             if (this.machine.driver.status.unit === "in") {
//                 // inches
//                 unitConv = 0.039370079;
//             }
//             z3Obj.g55x = Number((MPO.x * unitConv).toFixed(5));
//             z3Obj.g55y = Number((MPO.y * unitConv).toFixed(5));
//             z3Obj.g55z = Number((MPO.z * unitConv).toFixed(5));
//             log.debug(JSON.stringify(z3Obj));
//             try {
//                 await config.driver.setManyWrapper(z3Obj);
//                 this.cmd_posx = this.posx = 0.0;
//                 this.cmd_posy = this.posy = 0.0;
//                 this.cmd_posz = this.posz = 0.0;
//                 callback();
//             } catch (error) {
//                 callback(error);
//             }
//         }.bind(this)
//     );
// };

// exports.Z4 = function (args, callback) {
//     this.machine.driver.get(
//         "mpo",
//         async function (err, MPO) {
//             if (err) {
//                 return callback(err);
//             }
//             var z4Obj = {};
//             var unitConv = 1.0;
//             if (this.machine.driver.status.unit === "in") {
//                 // inches
//                 unitConv = 0.039370079;
//             }
//             // Unit conversion
//             z4Obj.g55x = Number((MPO.x * unitConv).toFixed(5));
//             z4Obj.g55y = Number((MPO.y * unitConv).toFixed(5));
//             z4Obj.g55z = Number((MPO.z * unitConv).toFixed(5));
//             // No unit conversion (rotary)
//             z4Obj.g55a = Number(MPO.a.toFixed(5));
//             try {
//                 await config.driver.setManyWrapper(z4Obj);
//                 this.cmd_posx = this.posx = 0.0;
//                 this.cmd_posy = this.posy = 0.0;
//                 this.cmd_posz = this.posz = 0.0;
//                 this.cmd_posa = this.posa = 0.0;
//                 callback();
//             } catch (error) {
//                 callback(error);
//             }
//         }.bind(this)
//     );
// };

// exports.Z5 = function (args, callback) {
//     this.machine.driver.get(
//         "mpo",
//         async function (err, MPO) {
//             if (err) {
//                 return callback(err);
//             }
//             var z5Obj = {};
//             var unitConv = 1.0;
//             if (this.machine.driver.status.unit === "in") {
//                 // inches
//                 unitConv = 0.039370079;
//             }
//             // Unit conversion
//             z5Obj.g55x = Number((MPO.x * unitConv).toFixed(5));
//             z5Obj.g55y = Number((MPO.y * unitConv).toFixed(5));
//             z5Obj.g55z = Number((MPO.z * unitConv).toFixed(5));
//             // No unit conversion (rotary)
//             z5Obj.g55a = Number(MPO.a.toFixed(5));
//             z5Obj.g55b = Number(MPO.b.toFixed(5));
//             try {
//                 await config.driver.setManyWrapper(z5Obj);
//                 this.cmd_posx = this.posx = 0.0;
//                 this.cmd_posy = this.posy = 0.0;
//                 this.cmd_posz = this.posz = 0.0;
//                 this.cmd_posa = this.posa = 0.0;
//                 this.cmd_posb = this.posb = 0.0;
//                 callback();
//             } catch (error) {
//                 callback(error);
//             }
//         }.bind(this)
//     );
// };

// exports.Z6 = function (args, callback) {
//     this.machine.driver.get(
//         "mpo",
//         async function (err, MPO) {
//             if (err) {
//                 return callback(err);
//             }
//             var z6Obj = {};
//             var unitConv = 1.0;
//             if (this.machine.driver.status.unit === "in") {
//                 // inches
//                 unitConv = 0.039370079;
//             }
//             z6Obj.g55x = Number((MPO.x * unitConv).toFixed(5));
//             z6Obj.g55y = Number((MPO.y * unitConv).toFixed(5));
//             z6Obj.g55z = Number((MPO.z * unitConv).toFixed(5));
//             // No unit conversion
//             z6Obj.g55a = Number(MPO.a.toFixed(5));
//             z6Obj.g55b = Number(MPO.b.toFixed(5));
//             z6Obj.g55c = Number(MPO.c.toFixed(5));
//             try {
//                 await config.driver.setManyWrapper(z6Obj);
//                 this.cmd_posx = this.posx = 0.0;
//                 this.cmd_posy = this.posy = 0.0;
//                 this.cmd_posz = this.posz = 0.0;
//                 this.cmd_posa = this.posa = 0.0;
//                 this.cmd_posb = this.posb = 0.0;
//                 this.cmd_posc = this.posc = 0.0;
//                 callback();
//             } catch (error) {
//                 callback(error);
//             }
//         }.bind(this)
//     );
// };

////## update ZT to cover all axes 2/4/22, will still need to attend to U,V,W
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
        // this.driver.requestStatusReport(function(report) {
        // 	log.debug("report = " + JSON.stringify(report));
        // 	callback();
        // });
        callback();
    } catch (error) {
        callback(error);
    }
};
