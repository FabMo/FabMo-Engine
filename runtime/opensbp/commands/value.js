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
	// TODO CONVERT THESE TO NEW SETTINGS
	/*
	if (args[0] !== undefined) sbp_settings.cutterDia = args[0];		// Cutter Diameter
	// args[1] = Obsolete
	// args[2] = Obsolete
	if (args[3] !== undefined) sbp_settings.safeZpullUp = args[3];	// safe-Z-pull-up
	if (args[4] !== undefined) sbp_settings.plungeDir = args[4];		// plunge direction
	if (args[5] !== undefined) sbp_settings.pocketOverlap = args[5];	// % pocket overlap
	if (args[6] !== undefined) sbp_settings.safeApullUp = args[6];	// safe-A-pull-up
//	if (args[7] !== undefined) sbp_settings.triggeredOutput = args[7];	// triggered output switch
//	if (args[8] !== undefined) sbp_settings.triggerONthreshold = args[8];	// trigger ON threshold
//	if (args[9] !== undefined) sbp_settings.triggerOFFthreshold = args[9];	// trigger OFF threshold
//	if (args[10] !== undefined) sbp_settings.vertAxisMonitor = args[10];	// vertical axis monitored
//	if (args[11] !== undefined) sbp_settings.triggerOutputNum = args[11];	// triggered output switch #
	*/
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

	var getValues = [];
	
	// Get existing limts from Engine, to be used in case new parameters aren't sent
	this.machine.driver.get (['xtn','xtm',
							  'ytn','ytm',
							  'ztn','ztm',
							  'atn','atm',
							  'btn','btm',
							  'ctn','ctm' ], function(err,getValues) {
	 	// X - Low Limit
		var nLimX = getValues[0];
		if (args[0] !== undefined){
			nLimX = args[0];
 		}
 		// X - High Limit
		var mLimX = getValues[1];
		if (args[1] !== undefined){
			mLimX = args[1];
		}
		// Y - Low Limit
		var nLimY = getValues[2];
		if (args[2] !== undefined){
			nLimY = args[2];
		}
		// Y - High Limit
		var mLimY = getValues[3];
		if (args[3] !== undefined){
			mLimY = args[3];
		}
		// Z - Low Limit
		var nLimZ = getValues[4];
		if (args[4] !== undefined){
			nLimZ = args[4];
		}
		// Z - High Limit
		var mLimZ = getValues[5];
		if (args[5] !== undefined){
			mLimZ = args[5];
		}
		// A - Low Limit
		var nLimA = getValues[6];
		if (args[6] !== undefined){
			nLimA = args[6];
 		}
 		// A - High Limit
		var mLimA = getValues[7];
		if (args[7] !== undefined){
			mLimA = args[7];
		}
		// Soft limit checking ON-OFF

		// B - Low Limit
		var nLimB = getValues[8];
		if (args[9] !== undefined){
			nLimB = args[9];
		}
		// B - High Limit
		var mLimB = getValues[9];
		if (args[10] !== undefined){
			mLimB = args[10];
		}
		// Number of axes limits to check
		
		// C - Low Limit
		var nLimC = getValues[10];
		if (args[12] !== undefined){
			nLimC = args[12];
		}
		// C - High Limit
		var mLimC = getValues[11];
		if (args[13] !== undefined){
			mLimC = args[13];
		}

		var VLstr = { 'xtn':nLimX, 'xtm':mLimX,
					  'ytn':nLimY, 'ytm':mLimY,
					  'ztn':nLimZ, 'ztm':mLimZ,
					  'atn':nLimA, 'atm':mLimA,
					  'btn':nLimB, 'btm':mLimB,
					  'ctn':nLimC, 'ctm':mLimC };
		
		this.machine.driver.set( VLstr, function(err, values) {
			console.log("set:values = " + values );
		});	

	}.bind(this));
	
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

	var VSstr = {};

	if (args[0] !== undefined) {
		speed_change = args[0];
		VSstr.xfr = (60*speed_change);
		VSstr.yfr = (60*speed_change);
		config.opensbp.set('movexy_speed', speed_change);
	}
	if (args[1] !== undefined) {
		speed_change = args[1];
		VSstr.zfr = (60*speed_change);
		config.opensbp.set('movez_speed', speed_change);
	}
	if (args[2] !== undefined) {
		speed_change = args[2];
		VSstr.afr = (60*speed_change);
		config.opensbp.set('movea_speed', speed_change);
	}
	if (args[3] !== undefined) {
		speed_change = args[3];
		VSstr.bfr = (60*speed_change);
		config.opensbp.set('moveb_speed', speed_change);
	}
	if (args[4] !== undefined) {
		speed_change = args[4];
		VSstr.cfr = (60*speed_change);
		config.opensbp.set('movec_speed', speed_change);
	}
	if (args[5] !== undefined) {
		speed_change = args[5];
		VSstr.xvm = (60*speed_change);
		VSstr.yvm = (60*speed_change);
		config.opensbp.set('jogxy_speed', speed_change);
	}
	if (args[6] !== undefined) {
		speed_change = args[6];
		VSstr.zvm = (60*speed_change);
		config.opensbp.set('jogz_speed', speed_change);
	}
	if (args[7] !== undefined) {
		speed_change = args[7];
		VSstr.avm = (60*speed_change);
		config.opensbp.set('joga_speed', speed_change);
	}
	if (args[8] !== undefined) {
		speed_change = args[8];
		VSstr.bvm = (60*speed_change);
		config.opensbp.set('jogb_speed', speed_change);
	}
	if (args[9] !== undefined) {
		speed_change = args[9];
		VSstr.cvm = (60*speed_change);
		config.opensbp.set('jogc_speed', speed_change);
	}
	config.driver.setMany(VSstr);

};

exports.VU = function(args, callback) {
	var axes = ['X','Y','Z','A','B','C'];
	var axesNum = [0,1,2,3,4,5];
	var getValues = [];
	var setValues = [];
	var value;

	// motor 1 unit value
	this.machine.driver.get (['1sa','1mi','1tr',
							  '2sa','2mi','2tr',
							  '3sa','3mi','3tr',
							  '4sa','4mi','4tr',
							  '5sa','5mi','5tr',
							  '6sa','6mi','6tr'], function(err,getValues) {

		var nTr1 = getValues[2];
		var nTr2 = getValues[5];
		var nTr3 = getValues[8];
		var nTr4 = getValues[11];
		var nTr5 = getValues[14];
		var nTr6 = getValues[17];

		if (args[0] !== undefined){
			var SBunitVal1 = args[0];
				console.log(err);
			var unitsSa1 = 360/getValues[0];
			var unitsMi1 = getValues[1];
			var unitsTr1 = getValues[2];
			nTr1 = ((unitsSa1 * unitsMi1 * config.opensbp.get('gearBoxRatio1')) / SBunitVal1);
			//TODO UPDATE TO NEW SETTINGS
			//sbp_settings.units1 = SBunitVal1;
		}
		if (args[1] !== undefined){
			var SBunitVal2 = args[1];
				console.log(err);
			var unitsSa2 = 360/getValues[3];
			var unitsMi2 = getValues[4];
			var unitsTr2 = getValues[5];
			nTr2 = ((unitsSa2 * unitsMi2 * config.opensbp.get('gearBoxRatio2')) / SBunitVal2);
			//TODO UPDATE TO NEW SETTINGS
			//sbp_settings.units2 = SBunitVal2;
		}
		if (args[2] !== undefined){
			var SBunitVal3 = args[2];
				console.log(err);
			var unitsSa3 = 360/getValues[6];
			var unitsMi3 = getValues[7];
			var unitsTr3 = getValues[8];
			nTr3 = ((unitsSa3 * unitsMi3 * config.opensbp.get('gearBoxRatio3')) / SBunitVal3);
			//TODO UPDATE TO NEW SETTINGS
			//sbp_settings.units3 = SBunitVal3;
		}
		if (args[3] !== undefined){
			var SBunitVal4 = args[3];				
				console.log(err);
			var unitsSa4 = 360/getValues[9];
			var unitsMi4 = getValues[10];
			var unitsTr4 = getValues[11];
			nTr4 = ((unitsSa4 * unitsMi4 * config.opensbp.get('gearBoxRatio4')) / SBunitVal4);
			//TODO UPDATE TO NEW SETTINGS
			//sbp_settings.units4 = SBunitVal4;
		}
		if (args[8] !== undefined){
			var SBunitVal5 = args[8];
				console.log(err);
			var unitsSa5 = 360/getValues[12];
			var unitsMi5 = getValues[13];
			var unitsTr5 = getValues[14];
			nTr5 = ((unitsSa5 * unitsMi5 * config.opensbp.get('gearBoxRatio5')) / SBunitVal5);
			//TODO UPDATE TO NEW SETTINGS
			//sbp_settings.units5 = SBunitVal5;
		}
		if (args[6] !== undefined){
			var SBunitVal6 = args[6];
				console.log(err);
			var unitsSa6 = 360/getValues[15];
			var unitsMi6 = getValues[16];
			var unitsTr6 = getValues[17];
			nTr6 = ((unitsSa6 * unitsMi6 * config.opensbp.get('gearBoxRatio6')) / SBunitVal6); 	console.log("6tr = " + nTr6 );
			//TODO UPDATE TO NEW SETTINGS
			//sbp_settings.units6 = SBunitVal6;
		}

		var VUstr = { '1tr':nTr1, '2tr':nTr2, '3tr':nTr3, '4tr':nTr4, '5tr':nTr5, '6tr':nTr6 };

		// We set the g2 config (Which updates the g2 hardware but also our persisted copy of its settings)
		config.driver.setMany(VUstr, function(err, values) {
			console.log("set:values = " + values );
			callback();
		});
// Write SA, MA & TR to configuration.json
	}.bind(this));
	
//	if ( args[5] !== undefined ) { circRes = args[5]; }
//	if ( args[8] !== undefined ) { circSml = args[8]; }
	// X resolution multiplier - currently not supported
//	if ( args[10] !== undefined ) {
//		sbp_settings.resMX = args[10];
//	}
	// Y resolution multiplier - currently not supported
//	if ( args[11] !== undefined ) {
//		sbp_settings.resMY = args[11];
//	}
	// Z resolution multiplier - currently not supported
//	if ( args[12] !== undefined ) {
//		sbp_settings.resMZ = args[12];
//	}
	// A resolution multiplier - currently not supported
//	if ( args[13] !== undefined ) {
//		sbp_settings.resMA = args[13];
//	}
	// B resolution multiplier - currently not supported
//	if ( args[14] !== undefined ) {
//		sbp_settings.resMB = args[14];
//	}
	// C resolution multiplier - currently not supported
//	if ( args[15] !== undefined ) {
//		sbp_settings.resMC = args[15];
//	}

};