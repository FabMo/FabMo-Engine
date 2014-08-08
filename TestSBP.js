var opensbp = require('./opensbp');

sbp = new opensbp.SBPRuntime();

sbp.cmd_posx = 4;
sbp.cmd_posy = 3;
sbp.cmd_posz = 3;

p0 = undefined;
p1 = 4;
p2 = 3;
p3 = 0;
p4 = -1;
p5 = undefined;
p6 = 1;
p7 = undefined;
p8 = undefined;
p9 = undefined;
p10 = undefined;
p11 = undefined;
p12 = undefined;
p13 = undefined;

sbp.CG([p0,p1,p2,p3,p4,p5,p6,p7,p8,p9,p10,p11,p12]);

console.log(sbp.current_chunk);
