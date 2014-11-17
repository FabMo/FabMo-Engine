var opensbp = require('../runtime/opensbp');

sbp = new opensbp.SBPRuntime();

sbp.cmd_posx = 2.010577;
sbp.cmd_posy = 3.405769;
sbp.cmd_posz = -0.2;

p0 = undefined;		// dia
p1 = 1.510577;				// endX (X)
p2 = 3.905769;				// endY (Y)
p3 = 0;				// centerX (I)
p4 = 0.5;				// centerY (J)
p5 = 'T';		// O-I-T
p6 = 1;			// Dir
p7 = undefined;		// Plunge
p8 = undefined;		// Passes
p9 = undefined;		// PropX
p10 = undefined;	// PropY	
p11 = undefined;	// Options 1-tab, 2-pocket, 3-spiral plunge & 4-spiral plunge with bottom pass
p12 = undefined;			// No Pull Up after cut
p13 = undefined;			// Start plunge from Zero

sbp.CG([p0,p1,p2,p3,p4,p5,p6,p7,p8,p9,p10,p11,p12,p13]);

//sbp.Z2

console.log(sbp.current_chunk);
