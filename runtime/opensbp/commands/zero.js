//var log = require("../../../log").logger("sbp");
var config = require("../../../config");

const { offsets } = require("./location");

/* ZERO */

// See Notes in location.js for offsetting and zeroing commands and functions
// U,V,W not yet covered!

//const axes = []; // X=0

exports.ZX = function (args, callback) {
    // x=0
    const axes = [];
    axes[0] = 0;
    offsets.call(this, axes, callback);
};

exports.ZY = function (args, callback) {
    const axes = [];
    axes[1] = 0;
    offsets.call(this, axes, callback);
};

exports.ZZ = function (args, callback) {
    const axes = [];
    axes[2] = 0;
    offsets.call(this, axes, callback);
};

exports.ZA = function (args, callback) {
    const axes = [];
    axes[3] = 0;
    offsets.call(this, axes, callback);
};

exports.ZB = function (args, callback) {
    const axes = [];
    axes[4] = 0;
    offsets.call(this, axes, callback);
};

exports.ZC = function (args, callback) {
    const axes = [];
    axes[5] = 0;
    offsets.call(this, axes, callback);
};

exports.Z2 = function (args, callback) {
    const axes = [];
    axes[0] = 0;
    axes[1] = 0;
    offsets.call(this, axes, callback);
};

exports.Z3 = function (args, callback) {
    const axes = [];
    axes[0] = 0;
    axes[1] = 0;
    axes[2] = 0;
    offsets.call(this, axes, callback);
};

exports.Z4 = function (args, callback) {
    const axes = [];
    axes[0] = 0;
    axes[1] = 0;
    axes[2] = 0;
    axes[3] = 0;
    offsets.call(this, axes, callback);
};

exports.Z5 = function (args, callback) {
    const axes = [];
    axes[0] = 0;
    axes[1] = 0;
    axes[2] = 0;
    axes[3] = 0;
    axes[4] = 0;
    offsets.call(this, axes, callback);
};

exports.Z6 = function (args, callback) {
    const axes = [];
    axes[0] = 0;
    axes[1] = 0;
    axes[2] = 0;
    axes[3] = 0;
    axes[4] = 0;
    axes[5] = 0;
    offsets.call(this, axes, callback);
};

// Will need to attend to U,V,W at some point
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
