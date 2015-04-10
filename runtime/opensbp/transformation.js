var log = require('../../log').logger('sbp');

// Point X, Point Y, Point Z, Angle(in radians), Rotation Point X, Rotation Point Y
exports.rotate = function(PtNew, Angle, RotPt){

	if ( Angle !== 0 ) {
		if (RotPt.X === undefined) {RotPt.X = 0;}
		if (RotPt.Y === undefined) {RotPt.Y = 0;}
		var cosB = Math.cos(Angle);
		var sinB = Math.sin(Angle);
		PtNew.X = (PtNew.X*cosB)-(PtNew.Y*sinB)+(RotPt.X*(1-cosB))+(RotPt.Y*sinB);
		PtNew.Y = (PtNew.X*sinB)+(PtNew.Y*cosB)+(RotPt.Y*(1-cosB))-(RotPt.X*sinB);
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
exports.scale = function(PtNew, ScaleFact, ScalePt){

	PtNew.X = (ScaleFact.X*PtNew.X)+(ScalePt.X*(1-ScaleFact.X));
	PtNew.Y = (ScaleFact.Y*PtNew.Y)+(ScalePt.Y*(1-ScaleFact.Y));

    return PtNew;
};

// Point X, Point Y, Point Z, X Move Distance, Y Move Distance, Z Move Distance
exports.translate = function(PtNew, MDist){

	if ( MDist.X !== 0 || MDist.X !== undefined ) { PtNew.X = PtNew.X + MDist.X; }
	if ( MDist.Y !== 0 || MDist.Y !== undefined ) { PtNew.Y = PtNew.Y + MDist.Y; }
	if ( MDist.Z !== 0 || MDist.Z !== undefined ) { PtNew.Z = PtNew.Z + MDist.Z; }

    return PtNew;
};
