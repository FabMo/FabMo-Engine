var opensbp = require('../opensbp');
var fs = require('fs');
var process = require('process');
var exec = require('child_process').exec;

sbp = new opensbp.SBPRuntime();

sbp.cmd_posx = 0;
sbp.cmd_posy = 0;
sbp.cmd_posz = 0.25;

p0 = 4;				// lenX (X)
p1 = 2;				// lenY (Y)
p2 = "T";			// O-I-T
p3 = -1;			// Dir
p4 = 4;				// Starting Corner
p5 = -0.1;	// Plunge
p6 = 2;				// Repetitions
p7 = 3;		// Options - 1-Tab, 2-Pocket Outside-In, 3-Pocket Inside-Out
p8 = 1;				// Start Plunge from Zero <0-NO, 1-YES>
p9 = 0;		// Rotation Angle
p10 = undefined;	// Plunge Axis
p11 = 1;			// Spiral Plunge <1-Yes>
p12 = 0;	// noPullUp at end

sbp.CR([p0,p1,p2,p3,p4,p5,p6,p7,p8,p9,p10,p11,p12]);

console.log(sbp.current_chunk);
var result= "";
for (var line in sbp.current_chunk)
{
	result+= sbp.current_chunk[line] +'\n';
}
fs.writeFile("testSBP.nc",result,function(err){
	if(err){console.log(err);return;}
	exec('"C:\\Program Files (x86)\\ShopBot\\ShopBot 3\\sb3.exe" C:\\Users\\gordon\\Documents\\GitHub\\FabMo-Engine\\tests\\testSBP.nc,,5',function(error,stdout,stderr){
		process.exit(0);
		if(err){console.log(err);return;}
		console.log(stdout);
		console.log(stderr);
	});
});