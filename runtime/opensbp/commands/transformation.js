var log = require('../../../log').logger('sbp');
var g2 = require('../../../g2');
var sb3_commands = require('../sb3_commands');
var config = require('../../../config');

// Point X, Point Y, Point Z, Angle(in radians), Rotation Point X, Rotation Point Y
exports.rotate = function(PtX, PtY, PtZ, Angle, RPtX, RPtY){
	var cosB = Math.cos(Angle);
	var sinB = Math.sin(Angle);
	if (RPtX === undefined) {RPtX = 0;}
	if (RPtY === undefined) {RPtY = 0;}
	var PtNew = {};
	PtNew.X = (PtX*cosB)-(PtY*sinB)+(RPtX*(1-cosB))+(RPtY*sinB);
	PtNew.Y = (PtX*sinB)+(PtY*cosB)+(RPtY*(1-cosB))-(RPtX*sinB);
    PtNew.Z = PtZ;

	return PtNew;
};

// Point X, Point Y, Point Z, Angle
exports.shearX = function(PtX, PtY, PtZ, Angle){
	var PtNew = {};
	PtNew.X = PtX + (Math.tan(Angle) * PtY);
	PtNew.Y = PtY;
    PtNew.Z = PtZ;

	return PtNew;
};


// Point X, Point Y, Point Z, Angle
exports.shearY = function(PtX, PtY, PtZ, Angle){
	var PtNew = {};
	PtNew.X = PtX;
	PtNew.Y = PtY + (Math.tan(Angle) * PtX);
    PtNew.Z = PtZ;

	return PtNew;
};

// Point X, Point Y, Point Z, Scale X, Scale Y, Scale Origin X, Scale Origin Y
exports.scale = function(PtX, PtY, PtZ, ScaleX, ScaleY, SPtX, SPtY){
	var PtNew = {};
	PtNew.X = (ScaleX*PtX)+(SPtX*(1-ScaleX));
	PtNew.Y = (ScaleY*PtY)+(SPtY*(1-ScaleY));
	PtNew.Z = PtZ;

    return PtNew;
};

// Point X, Point Y, Point Z, X Move Distance, Y Move Distance, Z Move Distance
exports.translate = function(PtX, PtY, PtZ, MDistX, MDistY, MDistZ){
	var PtNew = {};
	PtNew.X = PtX + MDistX;
	PtNew.Y = PtY + MDistY;
	PtNew.Z = PtZ + MDistZ;

    return PtNew;
};
