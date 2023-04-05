//var log = require("../../../log").logger("sbp");

const { offsets } = require("./location");

/* ZERO */

// See Notes in location.js for zeroing commands and location-setting functions
// ... Except for ZT, zeroing commands do a local zero by appropriately changing the G55 offset of the requested axis
// .... as would be done in g-code with a G10 L2 P2 commant
// U,V,W not yet covered!

exports.ZX = function (args, callback) {
    log.debug("Calling Offsets for ZX");
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
    log.debug("Calling Offsets for ZZ");
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
    log.debug("Calling Offsets for Z3");
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

exports.ZT = async function (args, callback) {
    args = [];
    args[0] = 0;
    args[1] = 0;
    args[2] = 0;
    args[3] = 0;
    args[4] = 0;
    args[5] = 0;
    args[6] = 0;
    args[7] = 0;
    args[8] = 0;
    args[9] = 0;
    args[10] = 0;
    args[11] = 0;
    offsets.call(this, args, callback);
};
