Engine = require('../engine').Engine;

var engine = new Engine();

var p0 = 4.00;			// XY Jog Speed
var p1 = 2.00;			// Z Jog Speed
var p2 = 10;			// A Jog Speed
var p3 = 10;			// B Jog Speed
var p4 = 360;			// C Jog Speed

var outStr = ("MS," + p0 + "," + p1 + "," + p2 + "," + p3 + "," + p4);

engine.start(function(error, result){ 
	engine.machine.sbp(outStr);
	setTimeout(process.exit,1000);
});