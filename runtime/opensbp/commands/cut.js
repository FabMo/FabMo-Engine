var log = require('../../../log').logger('sbp');
var g2 = require('../../../g2');
var sb3_commands = require('../sb3_commands');
var config = require('../../../config');

/* CUTS */

exports.CA = function(args) {
  var startX = this.cmd_posx;
  var startY = this.cmd_posy;
  var startZ = this.cmd_posz;

  var len = args[0] !== undefined ? args[0] : undefined;
  var ht = args[1] !== undefined ? args[1] : undefined;
  var OIT = args[2] !== undefined ? args[2] : "T";
  var Dir = args[3] !== undefined ? args[3] : 1;
  var angle = args[4] !== undefined ? args[4] : undefined;
  var Plg = args[5] !== undefined ? args[5] : undefined;
  var reps = args[6] !== undefined ? args[6] : 1; 
  var propX = args[7] !== undefined ? args[7] : 1;
  var propY = args[8] !== undefined ? args[8] : 1;
  var tabs = args[9] !== undefined ? args[9] : undefined;
  var noPullUp = args[10] !== undefined ? [10] : 0;
  var plgFromZero = args[11] !== undefined ? args[11] : 0;
  var currentZ ;
  var outStr;
  

};

exports.CC = function(args) {
  var startX = this.cmd_posx;
  var startY = this.cmd_posy;
  var startZ = this.cmd_posz;

  var P0 = " ";
  var Dia = args[0] !== undefined ? args[0] : undefined;
  var OIT = args[1] !== undefined ? args[1] : "T";
  var Dir = args[2] !== undefined ? args[2] : 1;
  var Bang = args[3] !== undefined ? args[3] : 0;
  var Eang = args[4] !== undefined ? args[4] : 0;
  var Plg = args[5] !== undefined ? args[5] : undefined; 
  var reps = args[6] !== undefined ? args[6] : undefined;
  var propX = args[7] !== undefined ? args[7] : undefined;
  var propY = args[8] !== undefined ? args[8] : undefined;
  var optCC = args[9] !== undefined ? args[9] : undefined;
  var noPullUp = args[10] !== undefined ? args[10] : undefined;
  var plgFromZero = args[11] !== undefined ? args[11] : undefined;

  if ( Dia === undefined ){
    // Error: Zero diameter circle
  }

  var WBang = 450 - Bang;
  if ( WBang > 360 || WBang === 360 ) { 
    WBang -= 360;
  } 
  else if ( WBang < -360 || WBang === -360 ) {
    WBang += 360;
  }
  var Bradians = WBang/180*Math.PI;

  var WEang = 450 - Eang;
  if ( WEang > 360 || WEang === 360 ) { 
    WEang -= 360;
  }
  else if ( WEang < -360 || WEang === -360 ) {
    WEang += 360;
  }
  var Eradians = WEang/180*Math.PI;

  // Find Center offset
  var radius = Dia/2;
  var centerX = startX + (radius * Math.cos(Bradians + Math.PI));
  var centerY = startY + (radius * Math.sin(Bradians + Math.PI));
  var xOffset = centerX - startX;
  var yOffset = centerY - startY;

  // Find End point
  var endX = centerX + radius * Math.cos(Eradians);
  var endY = centerY + radius * Math.sin(Eradians);

  this.CG([P0,endX,endY,xOffset,yOffset,OIT,Dir,Plg,reps,propX,propY,optCC,noPullUp,plgFromZero]);

};

exports.CP = function(args) {

  var startZ = this.cmd_posz;

  var Dia = args[0] !== undefined ? args[0] : undefined;
  var centerX = args[1] !== undefined ? args[1] : this.cmd_posx;
  var centerY = args[2] !== undefined ? args[2] : this.cmd_posy;
  var OIT = args[3] !== undefined ? args[3] : "T";
  var Dir = args[4] !== undefined ? args[4] : 1;
  var Bangle = args[5] !== undefined ? args[5] : 0; 
  var Eangle = args[6] !== undefined ? args[6] : 0;
  var Plg = args[7] !== undefined ? args[7] : undefined;
  var reps = args[8] !== undefined ? args[8] : undefined;
  var propX = args[9] !== undefined ? [9] : undefined;
  var propY = args[10] !== undefined ? args[10] : undefined;
  var optCP = args[11] !== undefined ? args[11] : undefined;
  var noPullUp = args[12] !== undefined ? args[12] : undefined;
  var plgFromZero = args[13] !== undefined ? args[13] : undefined;
  var currentZ = startZ;
  var outStr;
  
  if ( Dia === undefined ){
    // Error: Zero diameter circle
  }

  var WBang = 450 - Bang;
  if ( WBang > 360 || WBang === 360 ) { 
    WBang -= 360;
  } 
  else if ( WBang < -360 || WBang === -360 ) {
    WBang += 360;
  }
  var Bradians = WBang/180*Math.PI;

  var WEang = 450 - Eang;
  if ( WEang > 360 || WEang === 360 ) { 
    WEang -= 360;
  }
  else if ( WEang < -360 || WEang === -360 ) {
    WEang += 360;
  }
  var Eradians = WEang/180*Math.PI;

  // Find Center offset
  var radius = Dia/2;
  var startX = centerX + (radius * Math.cos(Bradians));
  var startY = centerY + (radius * Math.sin(Bradians));
  var xOffset = centerX - startX;
  var yOffset = centerY - startY;

  // Find End point
  var endX = centerX + radius * Math.cos(Eradians);
  var endY = centerY + radius * Math.sin(Eradians);

  if( this.cmd_posx !== startX && this.cmd_posy !== startY ){
      var safeZ = config.opensbp.get('safeZpullUp');
      if( currentZ !== safeZ ){
        this.emit_gcode( "G1Z" + safeZ + "F" + ( 60 * config.opensbp.get('movez_speed')) );
        this.cmd_posz = safeZ;
      }
      this.emit_gcode("G0X" + (startX).toFixed(res) + "Y" + (startY).toFixed(res));             // Jog to the start point
      this.cmd_posx = startX;
      this.cmd_posy = startY;
  }

  this.CG([P0,endX,endY,xOffset,yOffset,OIT,Dir,Plg,reps,propX,propY,optCC,noPullUp,plgFromZero]);

};


//	The CG command will cut a circle. This command closely resembles a G-code circle (G02 or G03)
//		Though, this command has several added features that its G-code counterparts don't:
//			- Spiral plunge with multiple passes
//			- Pocketing
//			- Pocketing with multiple passes
//		Can also be used for Arcs and Arcs with multiple passes
//		
//	Usage: CG,<no used>,<X End>,<Y End>,<X Center>,<Y Center>,<I-O-T>,<Direction>,<Plunge Depth>,
//			  <Repetitions>,<>,<>,<Options-2=Pocket,3=Spiral Plunge,4=Spiral Plunge with Bottom pass>,
//			  <No Pull Up after cut>,<Plunge from Z zero>
//	
exports.CG = function(args) {

  log.debug("CG-args = " + args);

  var startX = this.cmd_posx;
  var startY = this.cmd_posy;
  var startZ = this.cmd_posz;
  var endX = args[1] !== undefined ? args[1] : undefined;
  var endY = args[2] !== undefined ? args[2] : undefined;
  var centerX = args[3] !== undefined ? args[3] : undefined;
  var centerY = args[4] !== undefined ? args[4] : undefined;
  var OIT = args[5] !== undefined ? args[5] : "T";
  var Dir = args[6] !== undefined ? args[6] : 1; 
  var Plg = args[7] !== undefined ? args[7] : 0;
  var reps = args[8] !== undefined ? args[8] : 1;
  var propX = args[9] !== undefined ? args[9] : 1;
  var propY = args[10] !== undefined ? [10] : 1;
  var optCG = args[11] !== undefined ? args[11] : 0;
  var noPullUp = args[12] !== undefined ? args[12] : 0;
  var plgFromZero = args[13] !== undefined ? args[13] : 0;
	var currentZ;
	var outStr;
  var res = 5;

  log.debug("start X:" + startX );
  log.debug("start Y:" + startY );
  log.debug("start Z:" + startZ );
  log.debug("end X:" + endX );
  log.debug("end Y:" + endY );
  log.debug("center X:" + centerX );
  log.debug("center Y:" + centerY );
  log.debug("I-O-T:" + OIT );
  log.debug("Dir:" + Dir );

  if (Plg !== 0 && plgFromZero == 1){ currentZ = 0; }
  else { currentZ = startZ; }
  var safeZCG = currentZ + config.opensbp.get('safeZpullUp');

  if ( optCG == 2 ) {    	
  	circRadius = Math.sqrt((centerX * centerX) + (centerY * centerY));
  	PocketAngle = Math.atan2(centerY, centerX);								// Find the angle of the step over between passes
  	stepOver = config.opensbp.get('cutterDia') * ((100 - config.opensbp.get('pocketOverlap')) / 100);	// Calculate the overlap
  	Pocket_StepX = stepOver * Math.cos(PocketAngle);						// Calculate the stepover in X based on the radius of the cutter * overlap
  	Pocket_StepY = stepOver * Math.sin(PocketAngle);						// Calculate the stepover in Y based on the radius of the cutter * overlap
  }

  if ( plgFromZero == 1 ) {										// If plunge depth is specified move to that depth * number of reps
   	this.emit_gcode( "G1Z" + currentZ + "F" + ( 60 * config.opensbp.get('movez_speed')) );
  }

  for (i=0; i<reps;i++){
  	if (Plg !== 0 && optCG < 3 ) {										// If plunge depth is specified move to that depth * number of reps
  		currentZ += Plg;
  		this.emit_gcode( "G1Z" + currentZ + "F" + ( 60 *  config.opensbp.get('movez_speed')) );
   	}
  
   	if (optCG == 2) { 															// Pocket circle from the outside inward to center
   		// Loop passes until overlapping the center
   		for (j=0; (Math.abs(Pocket_StepX * j) <= circRadius) && (Math.abs(Pocket_StepY * j) <= circRadius) ; j++){
  	   	if ( j > 0) {
  	   		this.emit_gcode( "G1X" + ((j * Pocket_StepX) + startX).toFixed(res) + 
   		   			               "Y" + ((j * Pocket_StepY) + startY).toFixed(res) + 
   		   			               "F" + ( 60 * config.opensbp.get('movexy_speed')));
  	   	}
  	   	if (Dir == 1 ) { outStr = "G2"; }	// Clockwise circle/arc
   			else {outStr = "G3"; }	// CounterClockwise circle/arc
   			outStr = outStr + "X" + (startX + (j * Pocket_StepX)).toFixed(res) + 
    		   		 		        "Y" + (startY + (j * Pocket_StepY)).toFixed(res) +
                           "I" + (centerX - (j*Pocket_StepX)).toFixed(res) +
                           "J" + (centerY - (j*Pocket_StepY)).toFixed(res) +
                           "F" + ( 60 * config.opensbp.get('movexy_speed'));
    		this.emit_gcode( outStr );										
    	}
    	this.emit_gcode("G0Z" + safeZCG );										// Pull up Z
    	this.emit_gcode("G0X" + (startX).toFixed(res) + "Y" + (startY).toFixed(res));							// Jog to the start point
    } 
    else {
    	if (Dir == 1 ) { outStr = "G2X" + (endX).toFixed(res) + "Y" + (endY).toFixed(res); }	// Clockwise circle/arc
    	else { outStr = "G3X" + (endX).toFixed(res) + "Y" + (endY).toFixed(res); }			// CounterClockwise circle/arc
			
			if (Plg !== 0 && optCG === 3 ) { 
		    	outStr = outStr + "Z" + (currentZ + Plg); 
		    	currentZ += Plg;
			} // Add Z for spiral plunge

			outStr += "I" + (centerX).toFixed(res) + "J" + (centerY).toFixed(res) + "F" + ( 60 * config.opensbp.get('movexy_speed'));	// Add Center offset
			this.emit_gcode(outStr); 
	    	
	   	if( i+1 < reps && ( endX != startX || endY != startY ) ){					//If an arc, pullup and jog back to the start position
    		this.emit_gcode( "G0Z" + safeZCG );
       	this.emit_gcode( "G0X" + (startX).toFixed(res) + "Y" + (startY).toFixed(res) );
			}
		}
  }

  if (optCG == 4 ) { // Add bottom circle if spiral with bottom clr is specified
    if( endX != startX || endY != startY ) {	//If an arc, pullup and jog back to the start position
    	this.emit_gcode( "G0Z" + safeZCG );
    	this.emit_gcode( "G0X" + (startX).toFixed(res) + "Y" + (startY).toFixed(res));
    	this.emit_gcode( "G1Z" + currentZ + " F" + ( 60 * config.opensbp.get('movez_speed')));		
    }
    if (Dir === 1 ){ outStr = "G2"; } 		// Clockwise circle/arc
    else { outStr = "G3"; }					// CounterClockwise circle/arc
		outStr += "X" + (endX).toFixed(res) + "Y" + (endY).toFixed(res) + "I" + (centerX).toFixed(res) + "J" + (centerY).toFixed(res) + "F" + ( 60 * config.opensbp.get('movexy_speed'));	// Add Center offset
		this.emit_gcode(outStr); 
  }

  if(noPullUp === 0 && currentZ != startZ){    	//If No pull-up is set to YES, pull up to the starting Z location
   	this.emit_gcode( "G0Z" + startZ);
   	this.cmd_posz = startZ;
  }
  else{				    						//If not, stay at the ending Z height
  	if ( optCG > 1 && optCG < 3) {
    	this.emit_gcode( "G1Z" + currentZ ); 
    }
  	this.cmd_posz = currentZ;
  }

  this.cmd_posx = endX;
	this.cmd_posy = endY;
};

//	The CG command will cut a rectangle. It will generate the necessary G-code to profile and
//		pocket a rectangle. The features include:
//			- Spiral plunge with multiple passes
//			- Pocketing
//			- Pocketing with multiple passes
//			- Rotation around the starting point
//		
//	Usage: CR,<X Length>,<Y Length>,<I-O-T>,<Direction>,<Plunge Depth>,<Repetitions>,
//			  <Options-2=Pocket OUT-IN,3=Pocket IN-OUT>,<Plunge from Z zero>,<Angle of Rotation>,
//			  <Sprial Plunge>
//	
exports.CR = function(args) {
	//calc and output commands to cut a rectangle
  var n = 0.0;
	var startX = this.cmd_posx;
  var startY = this.cmd_posy;
  var startZ = this.cmd_posz;
  var pckt_startX = startX;
  var pckt_startY = startY;
  var currentZ = startZ;
  var rotPtX = 0.0;
  var rotPtY = 0.0;
  var xDir = 1;
  var yDir = 1;

  var lenX = args[0] !== undefined ? args[0] : undefined; 	// X length
  var lenY = args[1] !== undefined ? args[1] : undefined;		// Y length
  var OIT = args[2] !== undefined ? args[2] : "T";			// Cutter compentsation (I=inside, T=no comp, O=outside)
  var Dir = args[3] !== undefined ? args[3] : 1; 				// Direction of cut (-1=CCW, 1=CW)
  var stCorner = args[4] !== undefined ? args[4] : 4;			// Start Corner - default is 4, the bottom left corner. 0=Center
  var Plg = args[5] !== undefined ? args[5] : 0.0;			// Plunge depth per repetion
  var reps = args[6] !== undefined ? args[6] : 1;				// Repetions
  var optCR = args[7] !== undefined ? args[7] : 0;			// Options - 1-Tab, 2-Pocket Outside-In, 3-Pocket Inside-Out
  var plgFromZero = args[8] !== undefined ? args[8] : 0;		// Start Plunge from Zero <0-NO, 1-YES>
  var RotationAngle = args[9] !== undefined ? args[9] : 0.0;	// Angle to rotate rectangle around starting point
  var PlgAxis = args[10] !== undefined ? args[10] : 'Z';		// Axis to plunge <Z or A>
	var spiralPlg = args[11] !== undefined ? args[11] : 0;		// Turn spiral plunge ON for first pass (0=OFF, 1=ON)

	var PlgSp = 0.0;
	var noPullUp = 0;
	var cosRA = 0.0;
	var sinRA = 0.0;
  var stepOver = 0.0;
  var pckt_offsetX = 0.0;
  var pckt_offsetY = 0.0;    
  var order = [1,2,3,4];
  var pckt_stepX = 0.0;
  var pckt_stepY = 0.0;
  var steps = 1.0;

  if (RotationAngle !== 0 ) { 
   	RotationAngle *= Math.PI / 180;							// Convert rotation angle in degrees to radians
   	cosRA = Math.cos(RotationAngle);						// Calculate the Cosine of the rotation angle
   	sinRA = Math.sin(RotationAngle);						// Calculate the Sine of the rotation angle
   	rotPtX = pckt_startX; 									// Rotation point X
   	rotPtY = pckt_startY;									// Rotation point Y
  }
    
  if (Plg !== 0 && plgFromZero === 1){ currentZ = 0; }
  else{ currentZ = startZ; }
  var safeZCG = currentZ + config.opensbp.get('safeZpullUp');

  // Set Order and directions based on starting corner
  if ( stCorner == 1 ) { 
  	yDir = -1;
   	if ( Dir == -1 ) { 
   		order = [3,2,1,4]; 
   	}
  }	
  else if ( stCorner == 2 ) {
   	xDir = -1;
   	yDir = -1;
   	if ( Dir == 1 ) { 
   		order = [3,2,1,4]; 
   	}
  }
  else if ( stCorner == 3 ) { 
   	xDir = -1; 
   	if ( Dir == -1 ) {
   		order = [3,2,1,4]; 
   	}
  }
  else { 
   	if ( Dir == 1 ) {
   		order = [3,2,1,4]; 
   	}
  }

  if ( OIT == "O" ) { 
   	lenX += config.opensbp.get('cutterDia') * xDir;
   	lenY += config.opensbp.get('cutterDia') * yDir;
  }
  else if ( OIT == "I" ) {
   	lenX -= config.opensbp.get('cutterDia') * xDir;
   	lenY -= config.opensbp.get('cutterDia') * yDir;
  }
  else {
   	lenX *= xDir;
   	lenY *= yDir;
  }

  if ( stCorner === 0 ) {
  	pckt_startX = startX - (lenX/2);
  	pckt_startY = startY - (lenY/2);    		
  }

	// If a pocket, calculate the step over and number of steps to pocket out the complete rectangle.
  if (optCR > 1) {
   	stepOver = config.opensbp.get('cutterDia') * ((100 - config.opensbp.get('pocketOverlap')) / 100);	// Calculate the overlap
   	pckt_stepX = pckt_stepY = stepOver;
  	pckt_stepX *= xDir;
  	pckt_stepY *= yDir;
   	// Base the numvber of steps on the short side of the rectangle.
	 	if ( Math.abs(lenX) < Math.abs(lenY) ) {
	 		steps = Math.floor((Math.abs(lenX)/2)/Math.abs(stepOver)) + 1; 
	 	}
	 	else {	// If a square or the X is shorter, use the X length.
	 		steps = Math.floor((Math.abs(lenY)/2)/Math.abs(stepOver)) + 1; 
	 	}   		
	  // If an inside-out pocket, reverse the step over direction and find the pocket start point near the center
    if ( optCR === 3 ) {
      pckt_stepX *= (-1);
      pckt_stepY *= (-1);
      pckt_offsetX = stepOver * (steps - 1) * xDir;
      pckt_offsetY = stepOver * (steps - 1) * yDir;

      nextX = pckt_startX + pckt_offsetX;
      nextY = pckt_startY + pckt_offsetY;

      if ( RotationAngle === 0.0 ) { 
		    outStr = "G0X" + nextX + "Y" + nextY;
      }
      else {
		    outStr = "G0X" + ((nextX * cosRA) - (nextY * sinRA) + (rotPtX * (1-cosRA)) + (rotPtY * sinRA)).toFixed(4) +
			    		   "Y" + ((nextX * sinRA) + (nextY * cosRA) + (rotPtX * (1-cosRA)) - (rotPtY * sinRA)).toFixed(4); 
      }
      this.emit_gcode( outStr);
    }
  }

  // If an inside-out pocket, move to the start point of the pocket
  if ( optCR == 3 || stCorner === 0 ) {
    this.emit_gcode( "G0Z" + safeZCG );

    nextX = pckt_startX + pckt_offsetX;
    nextY = pckt_startY + pckt_offsetY;

		if ( RotationAngle === 0.0 ) { 
			outStr = "G1X" + nextX + "Y" + nextY;
		}
		else {
			outStr = "G1X" + ((nextX * cosRA) - (nextY * sinRA) + (rotPtX * (1-cosRA)) + (rotPtY * sinRA)).toFixed(4) +
						   "Y" + ((nextX * sinRA) + (nextY * cosRA) + (rotPtX * (1-cosRA)) - (rotPtY * sinRA)).toFixed(4); 
		}
    this.emit_gcode( "G1Z" + startZ + "F" + ( 60 * config.opensbp.get('movez_speed')));
    this.emit_gcode( outStr );
  }

  for (i = 0; i < reps; i++) {  
   	if ( spiralPlg != 1 ) {								// If plunge depth is specified move to that depth * number of reps
    	currentZ += Plg;
    	this.emit_gcode( "G1Z" + currentZ + "F" + ( 60 * config.opensbp.get('movez_speed')) );    		
    }
    else {
    	this.emit_gcode( "G1Z" + currentZ + "F" + ( 60 * config.opensbp.get('movez_speed')) );    		
    }
    	
    pass = cnt = 0;
    var nextX = 0.0;
    var nextY = 0.0;

    for ( j = 0; j < steps; j++ ){
   		do {
	   		for ( k=0; k<4; k++ ){
	   			n = order[k];
	   			switch (n){
	   				case 1:
    				  nextX = (pckt_startX + lenX - pckt_offsetX) - (pckt_stepX * j);
    					nextY = (pckt_startY + pckt_offsetY) + (pckt_stepY * j);
    						
    					if ( RotationAngle === 0.0 ) { 
    						outStr = "G1X" + nextX + "Y" + nextY;
    					}
    					else {
    						outStr = "G1X" + ((nextX * cosRA) - (nextY * sinRA) + (rotPtX * (1-cosRA)) + (rotPtY * sinRA)).toFixed(4) +
    									   "Y" + ((nextX * sinRA) + (nextY * cosRA) + (rotPtX * (1-cosRA)) - (rotPtY * sinRA)).toFixed(4); 
    					}
    						
    					if ( spiralPlg == 1 && pass === 0 ) {
    						PlgSp = currentZ + (Plg * 0.25); 
    						outStr += "Z" + (PlgSp).toFixed(4);
    					}
    						
    					outStr += "F" + ( 60 * config.opensbp.get('movexy_speed'));
    					this.emit_gcode (outStr);
    				break;

    				case 2:
   						nextX = (pckt_startX + lenX - pckt_offsetX) - (pckt_stepX * j);
   						nextY = (pckt_startY + lenY - pckt_offsetY) - (pckt_stepY * j);

    					if ( RotationAngle === 0.0 ) { 
    						outStr = "G1X" + nextX + "Y" + nextY;
    					}	
   						else {
   							outStr = "G1X" + ((nextX * cosRA) - (nextY * sinRA) + (rotPtX * (1-cosRA)) + (rotPtY * sinRA)).toFixed(4) +
   										   "Y" + ((nextX * sinRA) + (nextY * cosRA) + (rotPtX * (1-cosRA)) - (rotPtY * sinRA)).toFixed(4); 
   						}

   						if ( spiralPlg === 1 && pass === 0 ) { 
   							PlgSp = currentZ + (Plg * 0.5);	
   							outStr += "Z" + (PlgSp).toFixed(4);
   						}

   						outStr += "F" + ( 60 * config.opensbp.get('movexy_speed'));
    					this.emit_gcode (outStr);
   					break;

   					case 3:
   						nextX = (pckt_startX + pckt_offsetX) + (pckt_stepX * j);
   						nextY = (pckt_startY + lenY - pckt_offsetY) - (pckt_stepY * j);

    					if ( RotationAngle === 0.0 ) { 
    						outStr = "G1X" + nextX + "Y" + nextY;
    					}
   						else {
   							outStr = "G1X" + ((nextX * cosRA) - (nextY * sinRA) + (rotPtX * (1-cosRA)) + (rotPtY * sinRA)).toFixed(4) +
   										   "Y" + ((nextX * sinRA) + (nextY * cosRA) + (rotPtX * (1-cosRA)) - (rotPtY * sinRA)).toFixed(4); 
   						}

   						if ( spiralPlg == 1 && pass === 0 ) { 
   							plgSp = currentZ + (Plg * 0.75);	
   							outStr += "Z" + (PlgSp).toFixed(4); 
   						}	

   						outStr += "F" + ( 60 * config.opensbp.get('movexy_speed'));
    					this.emit_gcode (outStr);
    				break;

    				case 4:
   						nextX = (pckt_startX + pckt_offsetX) + (pckt_stepX * j);
   						nextY = (pckt_startY + pckt_offsetY) + (pckt_stepY * j);

    					if ( RotationAngle === 0.0 ) { 
    						outStr = "G1X" + nextX + "Y" + nextY;
    					}
   						else {
   							outStr = "G1X" + ((nextX * cosRA) - (nextY * sinRA) + (rotPtX * (1-cosRA)) + (rotPtY * sinRA)).toFixed(4) +
   										   "Y" + ((nextX * sinRA) + (nextY * cosRA) + (rotPtX * (1-cosRA)) - (rotPtY * sinRA)).toFixed(4); 
   						}

   						if ( spiralPlg === 1 && pass === 0 ) {
   							currentZ += Plg; 
   							outStr += "Z" + (currentZ).toFixed(4);
                pass = 1;
                if ( i+1 < reps ){
								  cnt = 1;
                } 
   						}
   						else { 
   							cnt = 1;
   						}

   						outStr += "F" + ( 60 * config.opensbp.get('movexy_speed'));
   						this.emit_gcode (outStr);
   					break;

   					default:
   						throw "Unhandled operation: " + expr.op;

   				}
   			}
			} while ( cnt < 1 );
  
			if ( (j + 1) < steps && optCR > 1 ) {
				nextX = (pckt_startX + pckt_offsetX) + (pckt_stepX * (j+1));
   			nextY = (pckt_startY + pckt_offsetY) + (pckt_stepY * (j+1));
				if ( RotationAngle === 0 ) { 
			  	outStr = "G1X" + nextX + 
   							   "Y" + nextY;
   			}
   			else {
   				outStr = "G1X" + ((nextX * cosRA) - (nextY * sinRA) + (rotPtX * (1-cosRA)) + (rotPtY * sinRA)).toFixed(4) +
   							   "Y" + ((nextX * sinRA) + (nextY * cosRA) + (rotPtX * (1-cosRA)) - (rotPtY * sinRA)).toFixed(4); 
   			}
   			outStr += "F" + ( 60 * config.opensbp.get('movexy_speed'));
    		this.emit_gcode (outStr);
   		}

   	}

   	// If a pocket, move to the start point of the pocket
	  if ( optCR > 1 || stCorner === 0 ) {
    	this.emit_gcode( "G0Z" + safeZCG );
    	outStr = "G1X" + startX + "Y" + startY;
			outStr += "F" + ( 60 * config.opensbp.get('movexy_speed'));
     	this.emit_gcode( outStr );
     	if ( ( i + 1 ) != reps ) { 
     		this.emit_gcode( "G1Z" + currentZ ); 
     	}
   	}
  }

  if( noPullUp === 0 && currentZ !== startZ ){    //If No pull-up is set to YES, pull up to the starting Z location
    this.emit_gcode( "G0Z" + startZ);
    this.cmd_posz = startZ;
  }
  else{										//If not, stay at the ending Z height
  	this.cmd_posz = currentZ;
  }

  if ( optCR === 3 ) {
    this.emit_gcode( "G0X" + startX + "Y" + startY );
  }

  this.cmd_posx = startX;
	this.cmd_posy = startY;

};