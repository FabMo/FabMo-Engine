Engine = require('../engine').Engine;

var engine = new Engine();

var p0 = 4000;			// Motor 1 Unit Value
var p1 = 4000;			// Motor 2 Unit Value
var p2 = 3500.0123;		// Motor 3 Unit Value
var p3 = 2183.8548;		// Motor 4 Unit Value
var p4 = undefined;
var p5 = undefined;
var p6 = undefined;
var p7 = undefined;
var p8 = 2100.000;		// Motor 5 Unit Value
//var p9 = undefined;
//var p10 = undefined;
//var p11 = undefined;
//var p12 = undefined;
//var p13 = undefined;
//var p14 = undefined;
//var p15 = 33.3333;		// Motor 6 Unit Value

var outStr = ("VU," + p0 + "," + p1 + "," + p2 + "," + p3 + "," + 
					  p4 + "," + p5 + "," + p6 + "," + p7 + "," + 
					  p8 );   // + "," + p9 + "," + p10 + "," + p11 + "," + 
					  //p12 + "," + p13 + "," + p14 + "," + p15);

engine.start(function(error, result){ 
	engine.machine.sbp(outStr);
	setTimeout(process.exit,1000);
});