var log = require('../../log').logger('sbp');

// Point X, Point Y, Point Z, Angle(in radians), Rotation Point X, Rotation Point Y
exports.rotate = function(PtNew,angle,RotPtX,RotPtY){

	if ( angle !== 0 ) {
		log.debug("rotate args: " + JSON.stringify(PtNew) +
			                    ", " + angle +
			                    ", " + RotPtX +
			                    ", " + RotPtY  );
		var x = PtNew.X;
		var y = PtNew.Y;
		log.debug("angle SB = " + angle);
		angle = 360 - angle;		
		while (angle >= 360 || angle <= -360){
			if (angle >= 360) { angle -= 360; }
			else if (angle <= -360) { angle += 360; }
		}
//		log.debug("angle real = " + angle);
		angle = (angle/180)*Math.PI;
//		log.debug("angle radians = " + angle);
		var cosB = Math.cos(angle);
		var sinB = Math.sin(angle);
		if (RotPtX === undefined) { RotPtX = 0; }
		if (RotPtY === undefined) { RotPtY = 0; }
		PtNew.X = ((cosB * (x-RotPtX)) - (sinB * (y-RotPtY))) + RotPtX;
		PtNew.Y = ((sinB * (x-RotPtX)) + (cosB * (y-RotPtY))) + RotPtY;
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
