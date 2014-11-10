var log = require('../../../log').logger('sbp');
var g2 = require('../../../g2');
var sb3_commands = require('../sb3_commands');
var config = require('../../../config');

/* VALUES */

exports.VA = function(args, callback) {
	// ?????????? Needs work to make function like VA in ShopBot	
	log.debug("VA Command: " + args);
	var zoffset = -args[2];
	if(zoffset !== undefined) {
		this.machine.driver.get('g55z', function(err, value) {
			this.machine.driver.set('g55z',(value + this.machine.status.posz + zoffset), function(err, value) {
				callback();
			});
		}.bind(this));
	} else {
		log.error("NO Z OFFSET");
	}
};

exports.VC = function(args) {

	log.debug( "VC - args = " + args );

	var sbp_values = {};

	if (args[0] !== undefined) { 	//args[0] = sbp_settings.cutterDia	// Cutter Diameter

		sbp_values.cutterDia = args[0];
	}
	// args[1] = Obsolete
	// args[2] = Obsolete
	if (args[3] !== undefined) { 	//Safe Z Pull Up
		sbp_values.safeZpullUp = args[3];		
	}
	if (args[4] !== undefined) { 	// Plunge Direction
	//	sbp_values.plungeDir = args[4];   // ????? Is this still relevant
	}
	if (args[5] !== undefined) { 	// % Pocket Overlap for CR and CG commands
		sbp_values.pocketOverlap = args[5];
	}
	if (args[6] !== undefined) { 	// Safe A Pull Up
		sbp_values.safeApullUp = args[6];
	}
	// args[7] = triggeredOutput		// triggered output switch
	// args[8] = triggerONthreshold		// trigger ON threshold
	// args[9] = triggerOFFthreshold	// trigger OFF threshold
	// args[10] = vertAxisMonitor		// vertical axis monitored
	// args[11] = triggerOutputNum		// triggered output switch #

	config.opensbp.setMany(sbp_values, function(err, values) {
		log.debug( "VC-sbp_values = " + JSON.stringify(sbp_values) );
		callback();
	});
};

exports.VD = function(args) {
	// Number of Axes
	// XYZ Unit type
	// A Unit type
	// B Unit type
	// Show control console
	// Display File Comments
	// Keypad fixed distance
	// Keypad remote
	// Keypad Switch AutoOff
	// Write Part File Log
	// Write System File Log
	// Message Screen Location X
	// Message Screen Location Y
	// Message Screen Size X
	// Message Screen Size Y
	// Keypad switches Auto-Off
	// Show file Progress
	// Main Display Type

};	

exports.VL = function(args) {

	var setValues = {};
	
	// X - Low Limit
	if (args[0] !== undefined){
		setValues.xtn = args[0];
	}
	// X - High Limit
	if (args[1] !== undefined){
		setValues.xtm = args[1];
	}
	// Y - Low Limit
	if (args[2] !== undefined){
		setValues.ytn = args[2];
	}
	// Y - High Limit
	if (args[3] !== undefined){
		setValues.ytm = args[3];
	}
	// Z - Low Limit
	if (args[4] !== undefined){
		setValues.ztn = args[4];
	}
	// Z - High Limit
	if (args[5] !== undefined){
		setValues.ztm = args[5];
	}
	// A - Low Limit
	if (args[6] !== undefined){
		setValues.atn = args[6];
	}
	// A - High Limit
	if (args[7] !== undefined){
		setValues.atm = args[7];
	}
	// Soft limit checking ON-OFF

	// B - Low Limit
	if (args[9] !== undefined){
		setValues.btn = args[9];
	}
	// B - High Limit
	if (args[10] !== undefined){
		setValues.btm = args[10];
	}
	// Number of axes limits to check
	
	// C - Low Limit
	if (args[12] !== undefined){
		setValues.ctn = args[12];
	}
	// C - High Limit
	if (args[13] !== undefined){
		setValues.ctm = args[13];
	}

	config.opensbp.setMany(sbp_values, function(err, values) {
		log.debug( "VL-sbp_values = " + JSON.stringify(sbp_values) );
		callback();
	});

};	

exports.VN = function(args) {
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

};	

exports.VP = function(args) {
	// Grid
	// Table Size X
	// Table Size Y
	// Table Size Z
	// Simulate Cutting
	// Draw Tool
	// Start Actual Location
	// Show Jugs

};	

exports.VR = function(args) {
	// XY Move Ramp Speed
	// Z Move Ramp Speed
	// A Move Ramp Speed
	// B Move Ramp Speed
	// C Move Ramp Speed
	// XY Jog Ramp Speed
	// Z Jog Ramp Speed
	// A Jog Ramp Speed
	// B Jog Ramp Speed
	// C Jog Ramp Speed
	// Move Ramp Rate
	// Jog Ramp Rate
	// 3D Threshold
	// Minimum Distance to Check
	// Slow Corner Speed
	// Keypad Ramp Rate
};	

exports.VS = function(args) {
	
	var speed_change = 0.0;

	var g2_values = {};
	var sbp_values = {};

	if (args[0] !== undefined) {
		speed_change = args[0];
		g2_values.xfr = (60*speed_change);
		g2_values.yfr = (60*speed_change);
		sbp_values.movexy_speed = speed_change;
	}
	if (args[1] !== undefined) {
		speed_change = args[1];
		g2_values.zfr = (60*speed_change);
		sbp_values.movez_speed = speed_change;
	}
	if (args[2] !== undefined) {
		speed_change = args[2];
		g2_values.afr = (60*speed_change);
		sbp_values.movea_speed = speed_change;
	}
	if (args[3] !== undefined) {
		speed_change = args[3];
		g2_values.bfr = (60*speed_change);
		sbp_values.moveb_speed = speed_change;
	}
	if (args[4] !== undefined) {
		speed_change = args[4];
		g2_values.cfr = (60*speed_change);
		sbp_values.movec_speed = speed_change;
	}
	if (args[5] !== undefined) {
		speed_change = args[5];
		g2_values.xvm = (60*speed_change);
		g2_values.yvm = (60*speed_change);
		sbp_values.jogxy_speed = speed_change;
	}
	if (args[6] !== undefined) {
		speed_change = args[6];
		g2_values.zvm = (60*speed_change);
		sbp_values.jogz_speed = speed_change;
	}
	if (args[7] !== undefined) {
		speed_change = args[7];
		g2_values.avm = (60*speed_change);
		sbp_values.joga_speed = speed_change;
	}
	if (args[8] !== undefined) {
		speed_change = args[8];
		g2_values.bvm = (60*speed_change);
		sbp_values.jogb_speed = speed_change;
	}
	if (args[9] !== undefined) {
		speed_change = args[9];
		g2_values.cvm = (60*speed_change);
		sbp_values.jogc_speed = speed_change;
	}
		
	config.opensbp.setMany(sbp_values, function(err, values) {
		config.driver.setMany(g2_values, function(err, values) {
			callback();
		});
	});

};

exports.VU = function(args, callback) {

	var G2_2get = ['1sa','1mi','1tr',
				   '2sa','2mi','2tr',
				   '3sa','3mi','3tr',
				   '4sa','4mi','4tr',
				   '5sa','5mi','5tr',
				   '6sa','6mi','6tr' ];

	var SBP_2get = ['gearBoxRatio1',
				    'gearBoxRatio2',
				    'gearBoxRatio3',
				    'gearBoxRatio4',
				    'gearBoxRatio5',
				    'gearBoxRatio6' ];

	var getG2_Values = [];
	var getSBP_values = [];

	var g2_VU = {};
	var sbp_VU = {};

	var SBunitVal = 0.0;
	var unitsSa = 0.0;
	var unitsMi = 0.0;
	var unitsTr = 0.0;
	var unitsGb = 0.0;
				
	config.driver.getMany(G2_2get, function(err,getG2_Values) {
		config.opensbp.getMany(SBP_2get, function(err,getSBP_values) {
			// motor 1 unit value
			if (args[0] !== undefined){
				SBunitVal = args[0];
				unitsSa = 360/getG2_Values[0];
				unitsMi = getG2_Values[1];
				unitsTr = getG2_Values[2];
				unitsGb = getSBP_values[0];
				g2_VU.1tr = unitsSa * unitsMi * unitsGb / SBunitVal;
				sbp_VU.units1 = SBunitVal;
			}
			// motor 2 unit value
			if (args[1] !== undefined){
				SBunitVal = args[1];
				unitsSa = 360/getG2_Values[3];
				unitsMi = getG2_Values[4];
				unitsTr = getG2_Values[5];
				unitsGb = getSBP_values[0];
				g2_VU.2tr = unitsSa * unitsMi * unitsGb / SBunitVal;
				sbp_VU.units2 = SBunitVal;
			}
			// motor 3 unit value
			if (args[2] !== undefined){
				SBunitVal = args[2];
				unitsSa = 360/getG2_Values[6];
				unitsMi = getG2_Values[7];
				unitsTr = getG2_Values[8];
				unitsGb = getSBP_values[0];
				g2_VU.3tr = unitsSa * unitsMi * unitsGb / SBunitVal;
				sbp_VU.units3 = SBunitVal;
			}
			// motor 4 unit value
			if (args[3] !== undefined){
				SBunitVal = args[3];				
				unitsSa = 360/getG2_Values[9];
				unitsMi = getG2_Values[10];
				unitsTr = getG2_Values[11];
				unitsGb = getSBP_values[0];
				g2_VU.4tr = unitsSa * unitsMi * unitsGb) / SBunitVal;
				sbp_VU.units4 = SBunitVal;
			}
			// motor 5 unit value
			if (args[8] !== undefined){
				SBunitVal = args[8];
				unitsSa = 360/getG2_Values[12];
				unitsMi = getG2_Values[13];
				unitsTr = getG2_Values[14];
				unitsGb = getSBP_values[0];
				g2_VU.5tr = unitsSa * unitsMi * unitsGb / SBunitVal;
				sbp_VU.units5 = SBunitVal;
			}
			// motor 6 unit value
			if (args[6] !== undefined){
				SBunitVal = args[6];
				unitsSa = 360/getG2_Values[15];
				unitsMi = getG2_Values[16];
				unitsTr = getG2_Values[17];
				unitsGb = getSBP_values[0];
				g2_VU.6tr = unitsSa * unitsMi * unitsGb / SBunitVal;
				sbp_VU.units6 = SBunitVal;
			}

		// We set the g2 config (Which updates the g2 hardware but also our persisted copy of its settings)
			config.opensbp.setMany(sbp_VU, function(err, values) {
				config.driver.setMany(g2_VU, function(err, values) {
					console.debug("Sent VU to g2 and sbp_settings");
					callback();
				});
			});
		});
	});
};