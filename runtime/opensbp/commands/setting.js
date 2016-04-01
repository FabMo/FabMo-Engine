var log = require('../../../log').logger('sbp');
var g2 = require('../../../g2');
var sb3_commands = require('../sb3_commands');
var config = require('../../../config');
var openSBP = require('../opensbp.js');

/* SETTINGS */

// Set to Absolute coordinates
exports.SA = function(args) {
	this.emit_gcode("G90");
};

//  Set to Relative coordinates
exports.SR = function(args) {
	this.emit_gcode("G91");
};

// Set to MOVE mode
// exports.SM = function(args) {
	
// };

// Set to PREVIEW mode
// exports.SP = function(args) {
	
// };

// Set to table base coordinates
exports.ST = function(args, callback) {
	this.machine.driver.get('mpo', function(err, MPO) {
		log.debug("ST-MPO = " + JSON.stringify(MPO));
		if(err) { return callback(err); }
		var stObj = {};
		unitConv = 1.0;
		if ( this.machine.driver.status.unit === 'in' ) {  // inches
			unitConv = 0.039370079;
		}
		stObj.g55x = 0.0;
		stObj.g55y = 0.0;
		stObj.g55z = 0.0;
		stObj.g55a = 0.0;
		stObj.g55b = 0.0;
		stObj.g55c = 0.0;
		config.driver.setMany(stObj, function(err, value) {
			if(err) { return callback(err); }
			this.cmd_posx = this.posx = stObj.g55x;
			this.cmd_posy = this.posy = stObj.g55y;
			this.cmd_posz = this.posz = stObj.g55z;
			this.cmd_posa = this.posa = stObj.g55a;
			this.cmd_posb = this.posb = stObj.g55b;
			this.cmd_posc = this.posc = stObj.g55c;
			callback();
		}.bind(this));
	}.bind(this));
};

exports.SO = function(args) {
	outnum = parseInt(args[0]);
	state = parseInt(args[1]);
	if(outnum === 1) {
		switch(state) {
			case 1:
				this.emit_gcode("M4");
				this.emit_gcode("M8");
				break;
			case 0:
				this.emit_gcode("M5");
				this.emit_gcode("M9");
				break;
		}
	}
};

exports.SV = function(args, callback){
	if (this.vs_change !== 0){
        this.savePersistVals(function(return_value){
    	    this.vs_change = return_value;
            callback();
        }.bind(this));
    }
};

exports.savePersistVals = function(callback){
    var g2_values = {};
    var sbp_values = {};
    // Permanently set move speeds
    sbp_values.movexy_speed = this.movespeed_xy;
    sbp_values.movez_speed = this.movespeed_z;
    sbp_values.movea_speed = this.movespeed_a;
    sbp_values.moveb_speed = this.movespeed_b;
    sbp_values.movec_speed = this.movespeed_c;
    // Permanently set jog speeds
    sbp_values.jogxy_speed = this.jogspeed_xy;
    g2_values.xvm = (60 * this.jogspeed_xy);
    g2_values.yvm = (60 * this.jogspeed_xy);
    sbp_values.jogz_speed = this.jogspeed_z;
    g2_values.zvm = (60 * this.jogspeed_z);
    sbp_values.joga_speed = this.jogspeed_a;
    // g2_values.avm = (60 * this.jogspeed_a);
    sbp_values.jogb_speed = this.jogspeed_b;
    // g2_values.bvm = (60 * this.jogspeed_b);
    sbp_values.jogc_speed = this.jogspeed_c;
    // g2_values.cvm = (60 * this.jogspeed_c);
    // Permanently set ramp max (jerk)
    g2_values.xjm = this.maxjerk_xy;
    g2_values.yjm = this.maxjerk_xy;
    g2_values.zjm = this.maxjerk_z;
    // g2_values.ajm = this.maxjerk_a;
    // g2_values.bjm = this.maxjerk_b;
    // g2_values.cjm = this.maxjerk_c;
    log.debug("sbp_values = " + JSON.stringify(sbp_values));
    log.debug("g2_values = " + JSON.stringify(g2_values));

    config.opensbp.setMany(sbp_values, function(err, values) {
 	    if(err) {
 		    log.error(err);
 	    }
 	    config.driver.setMany(g2_values, function(err, values) {
//            this.vs_change = 0;
            callback(0);    
        }.bind(this));
    }.bind(this));
};