var log = require('../../log').logger('sbp');
var g2 = require('../../g2');
var sb3_commands = require('./sb3_commands');
var config = require('../../config');
var opensbp = require('./opensbp');

//  Interpolate_Line - is used to interpolate a line into smaller segments.
//    
//  Usage: lineInterpolate(<EndPt>)
//
exports.lineInterpolate = function(EndPt) {
log.debug("lineInterpolate: EndPt = " + JSON.stringify(EndPt));
  var startX = this.cmd_posx;
  var startY = this.cmd_posy; 
  var startZ = this.cmd_posz;
  var nextX = this.cmd_posx;
  var nextY = this.cmd_posy;
  var nextZ = this.cmd_posz;
  var endX = EndPt.X;
  var endY = EndPt.Y;
  var endZ = EndPt.Z;
  var speed = EndPt.F;

  var segLen = config.opensbp.get('cRes');
  //distance = sqrt[width^2 + length^2 + height^2]
  var lineLen = Math.sqrt(Math.pow((endX-startX),2)+Math.pow((endY-startY),2)+Math.pow((endZ-startZ),2));
  if ( lineLen === 0 ) { throw( "lineInterpolate: line length zero" ); }
  var steps = Math.floor(lineLen/segLen);
  
  var stepX = (endX-startX)/steps;
  var stepY = (endY-startY)/steps;
  var stepZ = (endZ-startZ)/steps;
log.debug("stepX" + stepX);
log.debug("stepY" + stepY);
log.debug("stepZ" + stepZ);
  var nextPt = {};

  for ( i=1; i<steps; i++){
      nextPt = {};
      if ((stepX !== 0)){
        nextX = startX + (stepX * i);
        nextPt.X = nextX;
        this.cmd_posx = nextX;
      }
      if (stepY !== 0){
        nextY = startY + (stepY * i);
        nextPt.Y = nextY;
        this.cmd_posy = nextY;
      }
      if (stepZ !== 0){
        nextZ = startZ + (stepZ * i);
        nextPt.Z = nextZ;
        this.cmd_posz = nextZ;
      }
      nextPt.F = speed;
    log.debug("lineInterpolate: nextPt = " + JSON.stringify(nextPt));
      opensbp.emit_move('G1',nextPt);
  }

//  if ((stepX !== 0)){
//      this.cmd_posx = nextX = endX;
//      gcode += "X" + nextX;
//  }
//  if (stepY !== 0){
//      this.cmd_posy = nextY = startY + (stepY * i);
//      gcode += "Y" + nextY;
//  }
//    if (stepZ !== 0){
//      this.cmd_posz = params.Z = endZ;  
//  }
//    gcode += "F" + speed;
//
//    this.emit_move('G1',{"X":x,'F':feedrate});

    return;
};

//  Interpolate_Circle - is used to interpolate a circle that has uneven proportions as an ellipse.
//    
//  Usage: circleInterpolate(pt);
//
/*
circleInterpolate = function(code,EndPt) {

  var startX = this.cmd_posx;
  var startY = this.cmd_posy;
  var startZ = this.cmd_posz;
  var endX = EndPt.X;
  var endY = EndPt.Y;
  var plunge = EndPt.Z;
  var centerX = EndPt.I;
  var centerY = EndPt.J;

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
  var nextAng = Bang;

  var params = {};
  params.F = EndPt.F;

  for ( i=1; i<steps; i++) {
      nextAng = Bang + (i*theta);
      this.cmd_posx = params.X = (radius * Math.cos(nextAng)) * propX;
      this.cmd_posy = params.Y = (radius * Math.sin(nextAng)) * propY;
      if ( SpiralPlunge === 1 ) { 
        this.cmd_posz = params.Z = zStep * i; 
      }
      log.debug("G1X"+params.X+"Y"+params.Y+"F"+params.F);
      this.emit_move('G1',params);
  }
  
  this.cmd_posx = params.X = endX;
  this.cmd_posy = params.Y = endY;
    if ( SpiralPlunge === 1 ) { 
    this.cmd_posz = params.Z = plunge;
  }
    log.debug("G1X"+params.X+"Y"+params.Y+"F"+params.F);
  this.emit_move('G1',params);

  return;

};
*/