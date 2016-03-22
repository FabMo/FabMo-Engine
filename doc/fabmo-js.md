fabmo.js

Write apps for CNC

# Overview
FabMo is a software framework for next generation CNC.  fabmo.js connects app developers to their tool by way of the FabMo API.  Don't know FabMo?  [Go FabMo!](https://gofabmo.org/)

# Features
fabmo.js provides the complete API needed to communicate with a FabMo tool from your app.  Key functions include:
 
 1. Submit jobs to the tool
 1. Run CNC code directly on the tool
 1. Recieve run-time information from the tool. (Tool position, Tool status, Job progress, etc.)
 1. Manage tool and app configuration data.
 1. Drive the tool manually.
 1. Interact with the FabMo dashboard. (Post notifications, Display the DRO, Prompt the user)


# Usage

Get started
```
var fabmo = new FabMoDashboard();
console.log(fabmo.version);
```

Run some code (right away!)
```
fabmo.runGCode('G0 X0 Y0');
```

Start a job
```
var gcodes = [
	'G0 X0 Y0 (Go Home)',
	'G0 Z0.5 (Pull Up)',
	'G0 X1 Y1 (Go to 1,1)',
	'(Cut a square)',
	'M4 (SPINDLE ON)',
	'G1 Z-0.125 (Plunge 1/8")',
	'G1 X2',
	'G1 Y2',
	'G1 X1',
	'G1 Y1',
	'G0 Z0.5 (Pull Up)',
	'M8 (Spindle off)',
	'G0 X0 Y0 (Go Home)'
];

fabmo.submitJob({
	file : gcodes,
	filename : "square.nc",
	description : "Cuts a 1-inch square at 1,1"
});
```

Get notified
```
fabmo.on('status', function(status) {
	document.getElementById('x-display').innerHTML = status.posx;
	document.getElementById('y-display').innerHTML = status.posy;
	document.getElementById('z-display').innerHTML = status.posz;
});
```

# Examples
There are lots of good examples online!
 * [The Official FabMo Example App](http://fabmo.github.io/fabmo-example-app/) - Covers a lot of the API in simple examples
 * [FabMo Touch-And-Go](http://fabmo.github.io/fabmo-touchandgo-app/) - Runs immediate code, interacts with configuration, responds to status reports
 * [Hole Cutter](http://fabmo.github.io/fabmo-holecutter-app/) - Submits a job based on input parameters
 * [Terrainman](http://fabmo.github.io/fabmo-terrainman-app/) - More complex job based on input parameters

# Browser Compatibility
The FabMo dashboard runs in Chrome, Firefox and Safari (TODO include tested versions)

