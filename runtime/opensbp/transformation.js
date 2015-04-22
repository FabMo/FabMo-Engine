var log = require('../../log').logger('sbp');

// Point X, Point Y, Point Z, Angle(in radians), Rotation Point X, Rotation Point Y
exports.rotate = function(PtNew, Angle, RotPtX, RotPtY){

	if ( Angle !== 0 ) {
		if (RotPtX === undefined) {RotPtX = 0;}
		if (RotPtY === undefined) {RotPtY = 0;}
		var cosB = Math.cos(Angle);
		var sinB = Math.sin(Angle);
		PtNew.X = (PtNew.X*cosB)-(PtNew.Y*sinB)+(RotPtX*(1-cosB))+(RotPtY*sinB);
		PtNew.Y = (PtNew.X*sinB)+(PtNew.Y*cosB)+(RotPtY*(1-cosB))-(RotPtX*sinB);
	}

	return PtNew;
};

// Point X, Point Y, Point Z, Angle
exports.shearX = function(PtNew, Angle){

	PtNew.X = PtX + (Math.tan(Angle) * PtY);

	return PtNew;
};


// Point X, Point Y, Point Z, Angle
exports.shearY = function(PtNew, Angle){

	PtNew.Y = PtY + (Math.tan(Angle) * PtX);
	return PtNew;
};

// Point X, Point Y, Point Z, Scale X, Scale Y, Scale Origin X, Scale Origin Y
exports.scale = function(PtNew, ScaleX, ScaleY, ScalePtX, ScalePtY){

	PtNew.X = (ScaleX*PtNew.X)+(ScalePtX*(1-ScaleX));
	PtNew.Y = (ScaleY*PtNew.Y)+(ScalePtY*(1-ScaleY));

    return PtNew;
};

// Point X, Point Y, Point Z, X Move Distance, Y Move Distance, Z Move Distance
exports.translate = function(PtNew, MDistX, MDistY, MDistZ){

	if ( MDistX !== 0 || MDistX !== undefined ) { PtNew.X = PtNew.X + MDistX; }
	if ( MDistY !== 0 || MDistY !== undefined ) { PtNew.Y = PtNew.Y + MDistY; }
	if ( MDistZ !== 0 || MDistZ !== undefined ) { PtNew.Z = PtNew.Z + MDistZ; }

    return PtNew;
};
