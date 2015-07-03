var log = require('../../log').logger('sbp');
var g2 = require('../../g2');
var sb3_commands = require('./sb3_commands');
var config = require('../../config');
var opensbp = require('./opensbp');

//  Interpolate_Line - is used to interpolate a line into smaller segments.
//    
//  Usage: lineInterpolate(<EndPt>)
//
exports.lineInterpolate = function(runtime, EndPt) {
log.debug("lineInterpolate: EndPt = " + JSON.stringify(EndPt));
  var startX = runtime.cmd_posx;
  var startY = runtime.cmd_posy; 
  var startZ = runtime.cmd_posz;
  var nextX = startX;
  var nextY = startY;
  var nextZ = startZ;
  var endX = startX;
  if ("X" in EndPt && EndPt.X !== undefined) { endX = EndPt.X;}
  var endY = startY;
  if ("Y" in EndPt && EndPt.Y !== undefined) { endY = EndPt.Y;}
  var endZ = startZ;
  if ("Z" in EndPt && EndPt.Z !== undefined) {
    endZ = EndPt.Z;
    log.debug("Z = " + endZ);
  }    
  var speed = EndPt.F;
  var segLen = config.opensbp.get('cRes');
log.debug("segLen = " + segLen);
  //distance = sqrt[width^2 + length^2 + height^2]
log.debug("startX = " + startX + " startY = " + startY + " startZ = " + startZ );  
log.debug("endX = " + endX + " endY = " + endY + " endZ = " + endZ );  
  var lineLen = Math.sqrt(Math.pow((endX-startX),2)+Math.pow((endY-startY),2)+Math.pow((endZ-startZ),2));
log.debug("lineLen = " + lineLen);
  if ( lineLen === 0 ) { throw( "lineInterpolate: line length zero" ); }
  var steps = Math.floor(lineLen/segLen);
  var stepX = (endX-startX)/steps;
  var stepY = (endY-startY)/steps;
  var stepZ = (endZ-startZ)/steps;
  var gcode = "";

  for ( i=1; i<steps; i++){
      nextPt = {};
      gcode = "G1";
      if ((stepX !== 0)){
        nextX = startX + (stepX * i);
        gcode += "X" + nextX;
        runtime.cmd_posx = nextX;
      }
      if (stepY !== 0){
        nextY = startY + (stepY * i);
        gcode += "Y" + nextY;
        runtime.cmd_posy = nextY;
      }
      if (stepZ !== 0){
        nextZ = startZ + (stepZ * i);
        gcode += "Z" + nextZ;
        runtime.cmd_posz = nextZ;
      }
      gcode += "F" + speed;
      runtime.emit_gcode(gcode);
  }

  if ((stepX !== 0)){
    gcode += "X" + endX;
    runtime.cmd_posx = nextX;
  }
  if (stepY !== 0){
    gcode += "Y" + endY;
    runtime.cmd_posy = nextY;
  }
  if (stepZ !== 0){
    gcode += "Z" + endZ;  
    runtime.cmd_posz = nextZ;
  }
  gcode += "F" + speed;

  runtime.emit_gcode(gcode);

    return;
};

//  Interpolate_Circle - is used to interpolate a circle that has uneven proportions as an ellipse.
//    
//  Usage: circleInterpolate(pt);
//

exports.circleInterpolate = function(runtime, code, CGParams) {
log.debug("circleInterpolate: CGParams = " + JSON.stringify(CGParams));
  var startX = runtime.cmd_posx;
  var startY = runtime.cmd_posy;
  var startZ = runtime.cmd_posz;
  log.debug("startX = " + startX + " startY = " + startY);
  var endX = startX;
  if ("X" in CGParams && CGParams.X !== undefined) { endX = CGParams.X; }
  var endY = startY;
  if ("Y" in CGParams && CGParams.Y !== undefined) { endY = CGParams.Y; }
  var plunge = startZ;
  if ("Z" in CGParams && CGParams.Z !== undefined) { plunge = CGParams.Z; }
  var centerX = CGParams.I;
  var centerY = CGParams.J;
  var centerPtX = startX+centerX;
  var centerPtY = startY+centerY;
  var speed = CGParams.F;
  var nextX = 0.0;
  var nextY = 0.0;
  var nextZ = 0.0;

  var SpiralPlunge = 0;
  if ( plunge !== 0 ) { SpiralPlunge = 1; }

  // Find the beginning and ending angles in radians. We'll use only radians from here on.
  var Bang = Math.abs(Math.atan2(centerY, centerX));
  var Eang = Math.abs(Math.atan2((endY-centerPtY),(endX-centerPtX)));

//log.debug("1Bang = " + Bang + "  Eang = " + Eang);

  var inclAng;

  if (code === "G2") {
      if (Eang > Bang) { inclAng  = 6.28318530717959 - (Bang - Eang); }
      if (Bang > Eang) { inclAng = Eang - Bang; }
  }
  else {
      if (Bang < Eang) { inclAng = Eang + Bang; }
      if (Bang > Eang) { inclAng = 6.28318530717959 - (Bang - Eang); }
  }

//log.debug("inclAng = " + inclAng);
//log.debug("2Bang = " + Bang + "  Eang = " + Eang);

  if ( Math.abs(inclAng) < 0.005 ) { 
//      log.debug("Returning from interpolation - arc too small to cut!");
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
  var nextAng = Bang;
  var gcode = "";

  for ( i=1; i<steps; i++) {
    gcode = "G1";
    nextAng = Bang + (i*theta);
//    log.debug("nextAng = " + nextAng);    
//    log.debug("radius = " + radius);
    runtime.cmd_posx = nextX = centerPtX + (radius * Math.cos(nextAng)); //* propX;
    runtime.cmd_posy = nextY = centerPtY + (radius * Math.sin(nextAng)); //* propY;
    gcode += "X" + nextX.toFixed(5) + "Y" + nextY.toFixed(5);
    if ( SpiralPlunge === 1 ) { 
      runtime.cmd_posz = params.Z = zStep * i;
      gcode += "Z" + nextZ.toFixed(5); 
    }
    gcode += "F" + speed;
//    log.debug("circleInterpolation: gcode = " + gcode);
    runtime.emit_gcode(gcode);
  }
  
  gcode = "G1";
  runtime.cmd_posx = nextX = endX;
  runtime.cmd_posy = nextY = endY;
  gcode += "X" + nextX.toFixed(5) + "Y" + nextY.toFixed(5);
  if ( SpiralPlunge === 1 ) { 
    runtime.cmd_posz = nextZ = plunge;
    gcode += "Z" + nextZ.toFixed(5); 
  }
  log.debug("circleInterpolation: end gcode = " + gcode);
  gcode += "F" + speed;
  runtime.emit_gcode(gcode);

  return;

};