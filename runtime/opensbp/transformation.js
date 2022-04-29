var log = require('../../log').logger('sbp');

// General function here processes the points of a line or arc motion command given in PtNew for transform,
// ... returning the modified points needed in PtNew, with other required paramenters passed into function
// ... I & J being included points for case of arcs (note that they are relative offsets)

// ROTATE
// [Point X, Point Y, I-relative, J-relative,] Angle(in radians), Rotation Point X, Rotation Point Y 
exports.rotate = function(PtNew,angle,RotPtX,RotPtY,PtOld){
	if ( angle !== 0 ) {
		var x = PtNew.X;
		var y = PtNew.Y;
		if (angle > 360) {angle -= 360;}
		if (angle < -360) {angle += 360;}
		angle *= (-1);
		angle = (angle/180)*Math.PI;
		var cosB = Math.cos(angle);
		var sinB = Math.sin(angle);
		if (RotPtX === undefined) { RotPtX = 0; }
		if (RotPtY === undefined) { RotPtY = 0; }
		PtNew.X = ((cosB * (x-RotPtX)) - (sinB * (y-RotPtY))) + RotPtX;
		PtNew.Y = ((sinB * (x-RotPtX)) + (cosB * (y-RotPtY))) + RotPtY;
     	if ( 'I' in PtNew || 'J' in PtNew ){
            var Ipos = PtNew.I === undefined ? PtOld.xIni : (PtOld.xIni + PtNew.I);
            var Jpos = PtNew.J === undefined ? PtOld.yIni : (PtOld.yIni + PtNew.J);
            var newIpos = ((cosB * (Ipos-RotPtX)) - (sinB * (Jpos-RotPtY))) + RotPtX;
            var newJpos = ((sinB * (Ipos-RotPtX)) + (cosB * (Jpos-RotPtY))) + RotPtY;
            PtNew.I = newIpos - PtOld.xRot; 
            PtNew.J = newJpos - PtOld.yRot;
		}
	}
	return PtNew;
};

//SHEAR-X
// Point X, Point Y, Point Z, Angle
exports.shearX = function(PtNew,angle){

    angle = (angle * (-1))/180*Math.PI;
	PtNew.X = PtNew.X + (angle * PtNew.Y);

	return PtNew;
};

//SHEAR-Y
// Point X, Point Y, Point Z, Angle
exports.shearY = function(PtNew, angle){

    angle = (angle * (-1))/180*Math.PI;
	PtNew.Y = PtNew.Y + (angle * PtNew.X);

	return PtNew;
};

// {Notes 3/28/22 th}
// Scaling will not work non-uniformly for G-code Arcs! (Works in Sb3 because 'scaling' is a machine level function)
// - this means if a file HAS ARCS, X&Y scales must be the same
// - no elipses can be done by differentially scaling X&Y and  X&Y can not be differentially distorted with small arcs
// - We might consider creating a function that segments arcs if there is going to be a transformation
// - ** FOR THE MOMENT, that needs to be done in the CAM process

// SCALE
// Point X, Point Y, Point Z, Scale X, Scale Y, Scale Z,  ??Scale Origin X, Scale Origin Y
exports.scale = function(PtNew,scaleX,scaleY,scaleZ,scalePtX,scalePtY,scalePtZ,scalePtI,scalePtJ){
//  log.debug("scaling");
	if ( scaleX !== 1 && "X" in PtNew ) { 
	    PtNew.X = (scaleX*PtNew.X)+(scalePtX*(1-scaleX)); 
	}
	if ( scaleY !== 1 && "Y" in PtNew ) {
		PtNew.Y = (scaleY*PtNew.Y)+(scalePtY*(1-scaleY));
	}
	if ( scaleZ !== 1 && "Z" in PtNew ) {
		PtNew.Z = (scaleZ*PtNew.Z)+(scalePtZ*(1-scaleZ));
	}
	if ( scaleX !== 1 && "I" in PtNew ) {                         'x-center offset for arcs' 
	    PtNew.I = (scaleX*PtNew.I)+(scalePtI*(1-scaleX)); 
	}
	if ( scaleY !== 1 && "J" in PtNew ) {                         'y-center offset for arcs'
		PtNew.J = (scaleY*PtNew.J)+(scalePtJ*(1-scaleY));
	}

    return PtNew;
};

// MOVE
// Point X, Point Y, Point Z, X Move Distance, Y Move Distance, Z Move Distance
exports.translate = function(PtNew, MDistX, MDistY, MDistZ){

	if ( MDistX !== 0 && "X" in PtNew ) { PtNew.X = PtNew.X + MDistX; }
	if ( MDistY !== 0 && "Y" in PtNew ) { PtNew.Y = PtNew.Y + MDistY; }
	if ( MDistZ !== 0 && "Z" in PtNew ) { PtNew.Z = PtNew.Z + MDistZ; }

    return PtNew;
};
