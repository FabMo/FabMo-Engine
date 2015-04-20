var log = require('../../../log').logger('sbp');
var g2 = require('../../../g2');
var sb3_commands = require('../sb3_commands');
var config = require('../../../config');

/* ZERO */

// {"mpo":""}  return absolute machine positions fox XYZABC axes. 
// !!!!!!!!!!!! Always in mm, regardless of G20/G21 setting

// {"pos":""}  return work coordinate positions fox XYZABC axes. 
//              In mm or inches depending on G20 or G21

// {"g55":""}  returns the current offset to the UCS origin
//              In mm or inches depending on G20 or G21


exports.ZX = function(args, callback) {
	this.machine.driver.get('mpox', function(err, MPO) {
		var zxObj = {};
		log.debug( JSON.stringify(MPO) );
		if ( this.machine.driver.status.unit === 0 ) {  // inches
			unitConv = 0.039370079;
		}
		zxObj.g55x = Number((MPO * unitConv).toFixed(5));
		config.driver.setMany(zxObj, function(err, value) {
			this.cmd_posx = this.posx = 0;
			this.driver.requestStatusReport(function(report) {
				callback();
			});
		}.bind(this));
	}.bind(this));
};

exports.ZY = function(args, callback) {
	this.machine.driver.get('mpoy', function(err, MPO) {
		var zyObj = {};
		if ( this.machine.driver.status.unit === 0 ) {  // inches
			unitConv = 0.039370079;
		}
		zyObj.g55y = Number((MPO * unitConv).toFixed(5));
		config.driver.setMany(zyObj, function(err, value) {
			this.cmd_posy = this.posy = 0;
			this.driver.requestStatusReport(function(report) {
				callback();
			});
		}.bind(this));
	}.bind(this));
};

exports.ZZ = function(args, callback) {
	this.machine.driver.get('mpoz', function(err, MPO) {
		var zzObj = {};
		if ( this.machine.driver.status.unit === 0 ) {  // inches
			unitConv = 0.039370079;
		}
		zzObj.g55z = Number((MPO * unitConv).toFixed(5));
		config.driver.setMany(zzObj, function(err, value) {
			this.cmd_posz = this.posz = 0;
			callback();
		}.bind(this));
	}.bind(this));
};

exports.ZA = function(args, callback) {
	this.machine.driver.get('mpoa', function(err, MPO) {
		var zaObj = {};
		if ( this.machine.driver.status.unit === 0 ) {  // inches
			unitConv = 0.039370079;
		}
		zaObj.g55a = Number((MPO * unitConv).toFixed(5));
		config.driver.setMany(zaObj, function(err, value) {
			this.cmd_posa = this.posa = 0;
			callback();
		}.bind(this));
	}.bind(this));
};

exports.ZB = function(args, callback) {
	this.machine.driver.get('mpob', function(err, MPO) {
		var zbObj = {};
		if ( this.machine.driver.status.unit === 0 ) {  // inches
			unitConv = 0.039370079;
		}
		zaObj.g55a = Number((MPO * unitConv).toFixed(5));
		config.driver.setMany(zbObj, function(err, value) {
			this.cmd_posb = this.posb = 0;
			callback();
		}.bind(this));
	}.bind(this));
};

exports.ZC = function(args, callback) {
	this.machine.driver.get('mpoc', function(err, MPO) {
		var zcObj = {};
		if ( this.machine.driver.status.unit === 0 ) {  // inches
			unitConv = 0.039370079;
		}
		zcObj.g55c = Number((MPO * unitConv).toFixed(5));
		config.driver.setMany(zcObj, function(err, value) {
			this.cmd_posc = this.posc = 0;
			callback();
		}.bind(this));
	}.bind(this));
};

exports.Z2 = function(args, callback)  {
	this.machine.driver.get('mpo', function(err, MPO) {
		var z2Obj = {};
		if ( this.machine.driver.status.unit === 0 ) {  // inches
			unitConv = 0.039370079;
		}
		z2Obj.g55x = Number((MPO.x * unitConv).toFixed(5));
		z2Obj.g55y = Number((MPO.y * unitConv).toFixed(5));
		config.driver.setMany(z2Obj, function(err, value) {
			this.cmd_posx = this.posx = 0;
			this.cmd_posy = this.posy = 0;
			callback();
		}.bind(this));
	}.bind(this));
};

exports.Z3 = function(args,callback) {
	this.machine.driver.get('mpo', function(err, MPO) {
		if(err) {
			log.error(err);
		}
		var z3Obj = {};
		log.debug(JSON.stringify(MPO));
		if ( this.machine.driver.status.unit === 0 ) {  // inches
			unitConv = 0.039370079;
		}
		z3Obj.g55x = Number((MPO.x * unitConv).toFixed(5));
		z3Obj.g55y = Number((MPO.y * unitConv).toFixed(5));
		z3Obj.g55z = Number((MPO.z * unitConv).toFixed(5));
		log.debug(JSON.stringify(z3Obj));
		config.driver.setMany(z3Obj, function(err, value) {
			this.cmd_posx = this.posx = 0.0;
			this.cmd_posy = this.posy = 0.0;
			this.cmd_posz = this.posz = 0.0;
			callback();
		}.bind(this));
	}.bind(this));
};

exports.Z4 = function(args,callback) {
	this.machine.driver.get('mpo', function(err, MPO) {
		var z4Obj = {};
		if ( this.machine.driver.status.unit === 0 ) {  // inches
			unitConv = 0.039370079;
		}
		z4Obj.g55x = Number((MPO.x * unitConv).toFixed(5));
		z4Obj.g55y = Number((MPO.y * unitConv).toFixed(5));
		z4Obj.g55z = Number((MPO.z * unitConv).toFixed(5));
		z4Obj.g55a = Number((MPO.a * unitConv).toFixed(5));
		config.driver.setMany(z4Obj, function(err, value) {
			this.cmd_posx = this.posx = 0.0;
			this.cmd_posy = this.posy = 0.0;
			this.cmd_posz = this.posz = 0.0;
		 	this.cmd_posa = this.posa = 0.0;
			callback();
		}.bind(this));
	}.bind(this));
};

exports.Z5 = function(args,callback) {
	this.machine.driver.get('mpo', function(err, MPO) {
		var z5Obj = {};
		if ( this.machine.driver.status.unit === 0 ) {  // inches
			unitConv = 0.039370079;
		}
		z5Obj.g55x = Number((MPO.x * unitConv).toFixed(5));
		z5Obj.g55y = Number((MPO.y * unitConv).toFixed(5));
		z5Obj.g55z = Number((MPO.z * unitConv).toFixed(5));
		z5Obj.g55a = Number((MPO.a * unitConv).toFixed(5));
		z5Obj.g55b = Number((MPO.b * unitConv).toFixed(5));
		config.driver.setMany(z5Obj, function(err, value) {
			this.cmd_posx = this.posx = 0.0;
			this.cmd_posy = this.posy = 0.0;
			this.cmd_posz = this.posz = 0.0;
		 	this.cmd_posa = this.posa = 0.0;
		 	this.cmd_posb = this.posb = 0.0;
			callback();
		}.bind(this));
	}.bind(this));
};

exports.Z6 = function(args,callback) {
	this.machine.driver.get('mpo', function(err, MPO) {
		var z6Obj = {};
		if ( this.machine.driver.status.unit === 0 ) {  // inches
			unitConv = 0.039370079;
		}
		z6Obj.g55x = Number((MPO.x * unitConv).toFixed(5));
		z6Obj.g55y = Number((MPO.y * unitConv).toFixed(5));
		z6Obj.g55z = Number((MPO.z * unitConv).toFixed(5));
		z6Obj.g55a = Number((MPO.a * unitConv).toFixed(5));
		z6Obj.g55b = Number((MPO.b * unitConv).toFixed(5));
		z6Obj.g55c = Number((MPO.c * unitConv).toFixed(5));
		config.driver.setMany(z6Obj, function(err, value) {
			this.cmd_posx = this.posx = 0.0;
			this.cmd_posy = this.posy = 0.0;
			this.cmd_posz = this.posz = 0.0;
			this.cmd_posa = this.posa = 0.0;
			this.cmd_posb = this.posb = 0.0;
			this.cmd_posc = this.posc = 0.0;
			callback();
		}.bind(this));
	}.bind(this));
};

exports.ZT = function(args) {
    this.emit_gcode("G54");
};