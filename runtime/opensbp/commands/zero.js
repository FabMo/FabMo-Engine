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
		if(err) { return callback(err); }
		var zxObj = {};
		var unitConv = 1.0;
		if ( this.machine.driver.status.unit === 'in' ) {  // inches
			unitConv = 0.039370079;
		}
		zxObj.g55x = Number((MPO * unitConv).toFixed(5));
		config.driver.setMany(zxObj, function(err, value) {
			if(err) { return callback(err); }
			this.cmd_posx = this.posx = 0;
			callback();
		}.bind(this));
	}.bind(this));

	//this.emit_gcode("G10 L20 P2 X0");
	//callback()
};

exports.ZY = function(args, callback) {
	this.machine.driver.get('mpoy', function(err, MPO) {
		if(err) { return callback(err); }
		var zyObj = {};
		var unitConv = 1.0;
		if ( this.machine.driver.status.unit === 'in' ) {  // inches
			unitConv = 0.039370079;
		}
		zyObj.g55y = Number((MPO * unitConv).toFixed(5));
		config.driver.setMany(zyObj, function(err, value) {
			if(err) { return callback(err); }
			this.cmd_posy = this.posy = 0;
				callback();
		}.bind(this));
	}.bind(this));
	//this.emit_gcode("G10 L20 P2 Y0");
	//callback()

};

exports.ZZ = function(args, callback) {
	this.machine.driver.get('mpoz', function(err, MPO) {
		var zzObj = {};
		var unitConv = 1.0;
		if ( this.machine.driver.status.unit === 'in' ) {  // inches
			unitConv = 0.039370079;
		}
		zzObj.g55z = Number((MPO * unitConv).toFixed(5));
		config.driver.setMany(zzObj, function(err, value) {
			this.cmd_posz = this.posz = 0;
			callback();
		}.bind(this));
	}.bind(this));

	//this.emit_gcode("G10 L20 P2 Z0");
	//callback()
};

exports.ZA = function(args, callback) {
	this.machine.driver.get('mpoa', function(err, MPO) {
		if(err) { return callback(err); }
		var zaObj = {};
		var unitConv = 1.0;
		/*??????????????????????????????????????????????????????????
		              How is unit conversion handled
		              if the A is a linear axis?
		????????????????????????????????????????????????????????????*/
		// if ( this.machine.driver.status.unit === 'in' ) {  // inches
		// 	unitConv = 0.039370079;
		// }
		zaObj.g55a = Number((MPO * unitConv).toFixed(5));
		config.driver.setMany(zaObj, function(err, value) {
			if(err) { return callback(err); }
			this.cmd_posa = this.posa = 0;
			callback();
		}.bind(this));
	}.bind(this));
};

exports.ZB = function(args, callback) {
	this.machine.driver.get('mpob', function(err, MPO) {
		if(err) { return callback(err); }
		var zbObj = {};
		zbObj.g55b = Number((MPO).toFixed(5));
		config.driver.setMany(zbObj, function(err, value) {
			if(err) { return callback(err); }
			this.cmd_posb = this.posb = 0;
			callback();
		}.bind(this));
	}.bind(this));
};

exports.ZC = function(args, callback) {
	this.machine.driver.get('mpoc', function(err, MPO) {
		if(err) { return callback(err); }
		var zcObj = {};
		zcObj.g55c = Number((MPO).toFixed(5));
		config.driver.setMany(zcObj, function(err, value) {
			if(err) { return callback(err); }
			this.cmd_posc = this.posc = 0;
			callback();
		}.bind(this));
	}.bind(this));
};

exports.Z2 = function(args, callback)  {
	this.machine.driver.get('mpo', function(err, MPO) {
		if(err) { return callback(err); }
		var z2Obj = {};
		var unitConv = 1.0;
		if ( this.machine.driver.status.unit === 'in' ) {  // inches
			unitConv = 0.039370079;
		}
		z2Obj.g55x = Number((MPO.x * unitConv).toFixed(5));
		z2Obj.g55y = Number((MPO.y * unitConv).toFixed(5));
		config.driver.setMany(z2Obj, function(err, value) {
			if(err) { return callback(err); }
			this.cmd_posx = this.posx = 0;
			this.cmd_posy = this.posy = 0;
			callback();
		}.bind(this));
	}.bind(this));
};

exports.Z3 = function(args,callback) {
	this.machine.driver.get('mpo', function(err, MPO) {
		if(err) { return callback(err); }
		var z3Obj = {};
		log.debug(JSON.stringify(MPO));
		var unitConv = 1.0;
		if ( this.machine.driver.status.unit === 'in' ) {  // inches
			unitConv = 0.039370079;
		}
		z3Obj.g55x = Number((MPO.x * unitConv).toFixed(5));
		z3Obj.g55y = Number((MPO.y * unitConv).toFixed(5));
		z3Obj.g55z = Number((MPO.z * unitConv).toFixed(5));
		log.debug(JSON.stringify(z3Obj));
		config.driver.setMany(z3Obj, function(err, value) {
			if(err) { return callback(err); }
			this.cmd_posx = this.posx = 0.0;
			this.cmd_posy = this.posy = 0.0;
			this.cmd_posz = this.posz = 0.0;
			callback();
		}.bind(this));
	}.bind(this));
};

exports.Z4 = function(args,callback) {
	this.machine.driver.get('mpo', function(err, MPO) {
		if(err) { return callback(err); }
		var z4Obj = {};
		unitConv = 1.0;
		if ( this.machine.driver.status.unit === 'in' ) {  // inches
			unitConv = 0.039370079;
		}
		// Unit conversion
		z4Obj.g55x = Number((MPO.x * unitConv).toFixed(5));
		z4Obj.g55y = Number((MPO.y * unitConv).toFixed(5));
		z4Obj.g55z = Number((MPO.z * unitConv).toFixed(5));
		// No unit conversion (rotary)
		z4Obj.g55a = Number((MPO.a).toFixed(5));
		config.driver.setMany(z4Obj, function(err, value) {
			if(err) { return callback(err); }
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
		if(err) { return callback(err); }
		var z5Obj = {};
		unitConv = 1.0;
		if ( this.machine.driver.status.unit === 'in' ) {  // inches
			unitConv = 0.039370079;
		}
		// Unit conversion
		z5Obj.g55x = Number((MPO.x * unitConv).toFixed(5));
		z5Obj.g55y = Number((MPO.y * unitConv).toFixed(5));
		z5Obj.g55z = Number((MPO.z * unitConv).toFixed(5));
		// No unit conversion (rotary)
		z5Obj.g55a = Number((MPO.a).toFixed(5));
		z5Obj.g55b = Number((MPO.b).toFixed(5));
		config.driver.setMany(z5Obj, function(err, value) {
			if(err) { return callback(err); }
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
		if(err) { return callback(err); }
		var z6Obj = {};
		unitConv = 1.0;
		if ( this.machine.driver.status.unit === 'in' ) {  // inches
			unitConv = 0.039370079;
		}
		z6Obj.g55x = Number((MPO.x * unitConv).toFixed(5));
		z6Obj.g55y = Number((MPO.y * unitConv).toFixed(5));
		z6Obj.g55z = Number((MPO.z * unitConv).toFixed(5));
		// No unit conversion
		z6Obj.g55a = Number((MPO.a).toFixed(5));
		z6Obj.g55b = Number((MPO.b).toFixed(5));
		z6Obj.g55c = Number((MPO.c).toFixed(5));
		config.driver.setMany(z6Obj, function(err, value) {
			if(err) { return callback(err); }
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

exports.ZT = function(args, callback) {
	ztObj = {};
	ztObj.g55x = 0.0;
	ztObj.g55y = 0.0;
	ztObj.g55z = 0.0;
    this.emit_gcode("G28.3 X0 Y0 Z0");
	config.driver.setMany(ztObj, function(err, value) {
		if(err) { return callback(err); }
		this.cmd_posx = this.posx = 0.0;
		this.cmd_posy = this.posy = 0.0;
		this.cmd_posz = this.posz = 0.0;
		this.driver.requestStatusReport(function(report) {
			log.debug("report = " + JSON.stringify(report));
			callback();
		});
	}.bind(this));
};
