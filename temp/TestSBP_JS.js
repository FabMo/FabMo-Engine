var config = require('../config');
var opensbp = require('../runtime/opensbp');

console.log("test JS");

config.configure_opensbp(function (error, result){

	sbp = new opensbp.SBPRuntime();

	console.log("made sbp");

	var p0 = 30.00;			// XY Jog Speed
	var p1 = 8.00;			// Z Jog Speed
	var p2 = 20;			// A Jog Speed
	var p3 = 20;			// B Jog Speed
	var p4 = 3;				// C Jog Speed

	sbp.JS([p0,p1,p2,p3,p4]);

	//console.log(sbp.current_chunk);

} );
