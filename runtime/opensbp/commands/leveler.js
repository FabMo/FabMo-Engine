var log = require('../../../log').logger('sbp');
var g2 = require('../../../g2');
var sb3_commands = require('../sb3_commands');
var config = require('../../../config');
var fs = require('fs');

function readPtData(filename, callback) {
  var data = "";
  fs.readFile(filename, 'utf8', function (err, data) {
    if (err) {return callback(err,undefined);}
    data = JSON.parse(data);
//    log.debug("Parsed data: " + JSON.stringify(data));
    callback(err,data);
  }.bind(this));
}

exports.leveler_HB = function(PtNew, PtFilename, callback){
  var data = readPtData(PtFilename,function(err,data){
    log.debug("leveler_HB data = " + JSON.stringify(data));
    if(err){
      return callback(err);
    }
    else{
//      log.debug("PtData = " + JSON.stringify(data));
//      log.debug("PtFilename = " + PtFilename);
      var zA = data.Z1 + ((data.Z2-data.Z1)*((PtNew.X-data.X1)/(data.X2-data.X1)));
      var zB = data.Z4 + ((data.Z3-data.Z4)*((PtNew.X-data.X4)/(data.X3-data.X4)));
      var zP = zA - ((zB-zA)*((PtY-data.Y1)/(data.Y4-data.Y1)));
      log.debug("zP = " + zP);
      zP += PtZ;
//      log.debug("zA = " + zA + "   zB = " + zB);
      log.debug("zP = " + zP + "   PtZ = " + PtZ);
      callback(zP,null);
    }
  }.bind(this));
};

//exports.leveler = function(PtX, PtY, PtZ, PtData){
//	var Znew = 0;
//  var ret = 0;

  // Find triangular patch in data array
//	for (i=0; i<numPt; i++){
//    // find triangle X closest to less than PtX
//    if ((PtData[i].X <= PtX) || (PtData[i+1] > PtX)){
//    // find triangle Y closest to less than PtY
//      for (j=0; )
//    }  
    // find second vertex in pos X
    // find third vertex in pos Y
      // call chkTriangleIntersect to determine patch that contains move point
//	}
  // Find Z on patch based on XY location
//  if (ret === 1){

//  }
	// Return Offset Z value
//	return Znew;
//};

// Triangle Vertex0, 
// Triangle Vertex1, 
// Triangle Vertex2, 
// Point on intersect line, 
// Intersect Line Vector
exports.chkTriangleIntersect = function( V0, V1, V2, O, D )
{
  var EPSILON = 0.000001; 
  //Find vectors for two edges sharing V1
  var edge1 = Math.sub(V1, V0);
  var edge2 = Math.sub(V2, V0);
  //Begin calculating determinant - also used to calculate u parameter
  var Pvec = Math.cross(D, edge2);
  //if determinant is near zero, ray lies in plane of triangle
  var det = Math.dot(edge1, Pvec);
  //NOT CULLING
  if(det > -EPSILON && det < EPSILON) return 0;
  var inv_det = 1 / det;
  //calculate distance from V1 to ray origin
  var Tvec = Math.sub(O, V1);
  //Calculate u parameter and test bound
  var u = Math.dot(Tvec, Pvec) * inv_det;
  //The intersection lies outside of the triangle
  if(u < 0 || u > 1) return 0;
  //Prepare to test v parameter
  var Qvec = Math.cross(Tvec, edge1);
  //Calculate V parameter and test bound
  var v = Math.dot(D, Qvec) * inv_det;
  //The intersection lies outside of the triangle
  if(v < 0 || u + v  > 1) return 0;
  var t = Math.dot(edge2, Qvec) * inv_det;
  if(t > EPSILON) { //ray intersection
    return 1;
  }
  // No hit, no win
  return 0;
};