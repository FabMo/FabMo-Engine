var log = require('../../../log').logger('sbp');
var g2 = require('../../../g2');
var sb3_commands = require('../sb3_commands');
var config = require('../../../config');


//  Interpolate_Circle - is used to interpolate a circle that has uneven proportions as an ellipse.
//    
//  Usage: interpolate_circle(<startX>,<startY>,<startZ>,<endX>,<endY>,<plunge>,
//                            <centerX>,<centerY>,<propX>,<propY>);
exports.circleInterpolate = function(startX,startY,startZ,endX,endY,Dir,plunge,centerX,centerY,propX,propY) {

  var SpiralPlunge = 0;
  if ( plunge !== 0 ) { SpiralPlunge = 1; }

  // Find the beginning and ending angles in radians. We'll use only radians from here on.
  var Bang = Math.atan2((centerY*(-1)), (centerX*(-1)));
  var Eang = Math.atan2(endY+(startY+centerY),endX+(startX+centerX));
  var inclAng;

  if (Dir === 1) {
    if (Bang < Eang) { inclAng  = 6.28318530717959 - (Eang - Bang); }
    if (Bang > Eang) { inclAng = Eang - Bang; }
  }
  else {
    if (Bang < Eang) { inclAng = Eang + Bang; }
    if (Bang > Eang) { inclAng = 6.28318530717959 - (Bang - Eang); }
  }

  if ( Math.abs(inclAng) < 0.005 ) { 
    log.debug("Returning from interpolation - arc too small to cut!");
    return;
  }

  var circleTol = 0.001;
  var radius = Math.sqrt(Math.pow(centerX,2)+Math.pow(centerY,2));
  var chordLen = config.opensbp.get('cRes');
  // Sagitta is the height of an arc from the chord
  var sagitta = radius - Math.sqrt(Math.pow(radius,2) - Math.pow((chordLen/2),2));

  if (sagitta !== circleTol) {
    sagitta *= (sagitta/circleTol);
    chordLen = Math.sqrt(2*sagitta*radius-Math.pow(sagitta,2));
    log.debug("chordLen = " + chordLen );
    if (chordLen < 0.001) { chordLen = 0.001; }
  }
  var theta = Math.asin((0.5*chordLen)/radius) * 2;
  var remain = Math.abs(inclAng) % Math.abs(theta);
  var steps = Math.floor(Math.abs(inclAng)/Math.abs(theta));

  if ((remain) !== 0){
    theta = inclAng/steps;
  }

  var zStep = plunge/steps;
  var nextAng = theta; var nextX = startX; var nextY = startY; var nextZ = startZ; var outStr = "";

  for ( i=1; i<=steps; i++) {
    nextAng = Bang + (i*theta);
    nextX = (radius * Math.cos(nextAng)) * propX;
    nextY = (radius * Math.sin(nextAng)) * propY;
    outStr = "G1X" + nextX + "Y" + nextY;
    if ( SpiralPlunge === 1 ) { 
      nextZ = zStep * i;
      outStr += ("Z" + nextZ); 
    }
    outStr += ("F" + ( 60 * config.opensbp.get('movez_speed')));
//    log.debug("outStr = " + outStr);
    this.emit_gcode(outStr);
  }
  this.cmd_posx = nextX;
  this.cmd_posy = nextY;
};

//  Interpolate_Line - is used to interpolate a line into smaller segments.
//    
//  Usage: interpolate_circle(<startX>,<startY>,<startZ>,<endX>,<endY>,<endZ>)
//
exports.lineInterpolate = function(startX,startY,startZ,endX,endY,endZ) {

  var nextX = startX;
  var nextY = startY;
  var nextZ = startZ;
  var outStr = "";

  var segLen = config.opensbp.get('cRes');
  var lineLen = Math.sqrt(Math.pow((endX-startX),2)+Math.pow((endY-starty),2)+Math.pow((endZ-startZ),2));
  var steps = Math.floor(lineLen/segLen);
  
  var stepX = (endX-startX)/steps;
  var stepY = (endY-startY)/steps;
  var stepZ = (endZ-startZ)/steps;

  for ( i=1; i<steps+1; i++){
  	outStr = "G1";
    if ((stepX !== 0)){
      outStr = "X" + (startX + (stepX * i));
    }
    else if (stepY !== 0){
      outStr = "Y" + (startY + (stepY * i));
    }
    else if (stepZ !== 0){
      outStr = "Z" + (startZ + (stepZ * i));  
    }

    if ( stepX !== 0 || stepY !== 0 ){
      outStr += ("F" + ( 60 * config.opensbp.get('movexy_speed')));
    }
    else {
      outStr += ("F" + ( 60 * config.opensbp.get('movez_speed')));
    }

    this.emit_gcode(outStr);
  }

  if (endX !== undefined) this.cmd_posx = endX;
  if (endY !== undefined) this.cmd_posy = endY;
  if (endZ !== undefined) this.cmd_posZ = endZ;

};

