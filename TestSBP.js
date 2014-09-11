var opensbp = require('./opensbp');

sbp = new opensbp.SBPRuntime();

sbp.cmd_posx = 4;
sbp.cmd_posy = 3;
sbp.cmd_posz = 3;

p0 = undefined;		// dia
p1 = 7;				// endX
p2 = 0;				// endY
p3 = 0;				// centerX
p4 = -3;			// centerY
p5 = undefined;		// O-I-T
p6 = 1;			// Dir
p7 = -.125;		// Plunge
p8 = 1;		// Passes
p9 = undefined;		// PropX
p10 = undefined;	// PropY	
p11 = 0;	// Options 1-tab, 2-pocket, 3-spiral plunge & 4-spiral plunge with bottom pass
p12 = 0;			// No Pull Up after cut
p13 = 1;			// Start plunge from Zero

sbp.CG([p0,p1,p2,p3,p4,p5,p6,p7,p8,p9,p10,p11,p12,p13]);

//sbp.Z2

console.log(sbp.current_chunk);
