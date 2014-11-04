console.log("test JS");

var opensbp = require('../runtime/opensbp');

console.log("made opensbp");

sbp = new opensbp.SBPRuntime();

console.log("made sbp");

p0 = 30.00;			// XY Jog Speed
p1 = 8.00;			// Z Jog Speed
p2 = 20;			// A Jog Speed
p3 = 20;			// B Jog Speed
p4 = 3;				// C Jog Speed

sbp.JS([p0,p1,p2,p3,p4]);

//console.log(sbp.current_chunk);
