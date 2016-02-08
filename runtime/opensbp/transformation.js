var log = require('../../log').logger('sbp');

// Point X, Point Y, Point Z, Angle(in radians), Rotation Point X, Rotation Point Y
exports.rotate = function(PtNew,angle,RotPtX,RotPtY,xStart,yStart){
	if ( angle !== 0 ) {
      // log.debug("     rotate = " + JSON.stringify(PtNew));
      // log.debug("          angle = " + angle);
		var x = PtNew.X;
		var y = PtNew.Y;		
		angle = (-angle/180)*Math.PI;
		var cosB = Math.cos(angle);
		var sinB = Math.sin(angle);
		if (RotPtX === undefined) { RotPtX = 0; }
		if (RotPtY === undefined) { RotPtY = 0; }
		PtNew.X = ((cosB * (x-RotPtX)) - (sinB * (y-RotPtY))) + RotPtX;
		PtNew.Y = ((sinB * (x-RotPtX)) + (cosB * (y-RotPtY))) + RotPtY;
            // log.debug("          PtNew.X = " + PtNew.X.toFixed(5) + "  PtNew.Y = " + PtNew.Y.toFixed(5));
     	if ( 'I' in PtNew || 'J' in PtNew ){
            // log.debug("          PtNew.I = " + PtNew.I.toFixed(5) + "  PtNew.J = " + PtNew.J.toFixed(5));
            var Ipos = PtNew.I === undefined ? xStart : (xStart + PtNew.I);
            var Jpos = PtNew.J === undefined ? yStart : (yStart + PtNew.J);
            // log.debug("          Ipos = " + Ipos.toFixed(5) + "  Jpos = " + Jpos.toFixed(5));
            var newIpos = ((cosB * (Ipos-RotPtX)) - (sinB * (Jpos-RotPtY))) + RotPtX;
            var newJpos = ((sinB * (Ipos-RotPtX)) + (cosB * (Jpos-RotPtY))) + RotPtY;
            // log.debug("          newIpos = " + newIpos.toFixed(5) + "  newJpos = " + newJpos.toFixed(5));
            PtNew.I = PtNew.X - newIpos;
            PtNew.J = PtNew.Y - newJpos;
            // log.debug("          Rotated:PtNew.I = " + PtNew.I.toFixed(5) + "  PtNew.J = " + PtNew.J.toFixed(5));
		}
	}
	return PtNew;
};

// Point X, Point Y, Point Z, Angle
exports.shearX = function(PtNew,angle){

    angle = (angle * (-1))/180*Math.PI;
	PtNew.X = PtNew.X + (angle * PtNew.Y);

	return PtNew;
};

// Point X, Point Y, Point Z, Angle
exports.shearY = function(PtNew, angle){

    angle = (angle * (-1))/180*Math.PI;
	PtNew.Y = PtNew.Y + (angle * PtNew.X);

	return PtNew;
};

// Point X, Point Y, Point Z, Scale X, Scale Y, Scale Origin X, Scale Origin Y
exports.scale = function(PtNew,scaleX,scaleY,scalePtX,scalePtY){
//  log.debug("scaling");
	if ( scaleX !== 1 && "X" in PtNew ) { 
	    PtNew.X = (scaleX*PtNew.X)+(scalePtX*(1-scaleX)); 
	}
	if ( scaleY !== 1 && "Y" in PtNew ) {
		PtNew.Y = (scaleY*PtNew.Y)+(scalePtY*(1-scaleY));
	}
    return PtNew;
};

// Point X, Point Y, Point Z, X Move Distance, Y Move Distance, Z Move Distance
exports.translate = function(PtNew, MDistX, MDistY, MDistZ){

	if ( MDistX !== 0 && "X" in PtNew ) { PtNew.X = PtNew.X + MDistX; }
	if ( MDistY !== 0 && "Y" in PtNew ) { PtNew.Y = PtNew.Y + MDistY; }
	if ( MDistZ !== 0 && "Z" in PtNew ) { PtNew.Z = PtNew.Z + MDistZ; }

    return PtNew;
};
