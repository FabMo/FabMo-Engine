Engine = require('../engine').Engine;

var engine = new Engine();

var p0 = 30.00;			// XY Jog Speed
var p1 = 8.00;			// Z Jog Speed
var p2 = 20;			// A Jog Speed
var p3 = 20;			// B Jog Speed
var p4 = 3;				// C Jog Speed

var outStr = ("JS," + p0 + "," + p1 + "," + p2 + "," + p3 + "," + p4);

engine.start(function(error, result){ 
	engine.machine.sbp(outStr);
	setTimeout(process.exit,1000);
});