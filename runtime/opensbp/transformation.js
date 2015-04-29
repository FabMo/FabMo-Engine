var log = require('../../log').logger('sbp');

// Point X, Point Y, Point Z, Angle(in radians), Rotation Point X, Rotation Point Y
exports.rotate = function(PtNew,angle,RotPtX,RotPtY){

	if ( angle !== 0 ) {
		if (RotPtX === undefined) {RotPtX = 0;}
		if (RotPtY === undefined) {RotPtY = 0;}
		var cosB = Math.cos(angle);
		var sinB = Math.sin(angle);
		PtNew.X = (PtNew.X*cosB)-(PtNew.Y*sinB)+(RotPtX*(1-cosB))+(RotPtY*sinB);
		PtNew.Y = (PtNew.X*sinB)+(PtNew.Y*cosB)+(RotPtY*(1-cosB))-(RotPtX*sinB);
	}

	return PtNew;
};

// Point X, Point Y, Point Z, Angle
exports.shearX = function(PtNew,angle){

	PtNew.X = PtNew.X + (angle * PtNew.Y);

	return PtNew;
};

// Point X, Point Y, Point Z, Angle
exports.shearY = function(PtNew, angle){

	PtNew.Y = PtNew.Y + (angle * PtNew.X);

	return PtNew;
};

// Point X, Point Y, Point Z, Scale X, Scale Y, Scale Origin X, Scale Origin Y
exports.scale = function(PtNew,scaleX,scaleY,scalePtX,scalePtY){

	if ( scaleX !== 1 && PtNew.X ) { 
	    PtNew.X = (scaleX*PtNew.X)+(scalePtX*(1-scaleX)); 
	}
	if ( scaleY !== 1 && PtNew.Y ) {
		PtNew.Y = (scaleY*PtNew.Y)+(scalePtY*(1-scaleY));
	}
    return PtNew;
};

// Point X, Point Y, Point Z, X Move Distance, Y Move Distance, Z Move Distance
exports.translate = function(PtNew, MDistX, MDistY, MDistZ){

	if ( MDistX !== 0 && PtNew.X ) { PtNew.X = PtNew.X + MDistX; }
	if ( MDistY !== 0 && PtNew.Y ) { PtNew.Y = PtNew.Y + MDistY; }
	if ( MDistZ !== 0 && PtNew.Z ) { PtNew.Z = PtNew.Z + MDistZ; }

    return PtNew;
};
