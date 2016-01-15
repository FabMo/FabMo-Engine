var log = require('../../../log').logger('sbp');
var g2 = require('../../../g2');
//var sb3_commands = require('../sb3_commands');
//var config = require('../../../config');
//var fs = require('fs');

//function readPtData(PtData, callback) {
//  var data = fs.readFileSync(this.transforms.level.ptDataFile);
//  return JSON.parse(data);
//}

//exports.leveler = function(PtNew){
//    log.debug("leveler_HB data = " + JSON.stringify(data));
//      log.debug("PtData = " + JSON.stringify(data));
//      log.debug("PtFilename = " + PtFilename);
//      var zA = data.Z1 + ((data.Z2-data.Z1)*((PtNew.X-data.X1)/(data.X2-data.X1)));
//      var zB = data.Z4 + ((data.Z3-data.Z4)*((PtNew.X-data.X4)/(data.X3-data.X4)));
//      var zP = zA - ((zB-zA)*((PtY-data.Y1)/(data.Y4-data.Y1)));
//      log.debug("zP = " + zP);
//      zP += PtZ;
//      log.debug("zA = " + zA + "   zB = " + zB);
//      log.debug("zP = " + zP + "   PtZ = " + PtZ);
//      return zP;
//};

/*jslint todo: true, browser: true, continue: true, white: true*/
/*global define*/
var triangulate = require("delaunay-triangulate");
var fs = require("fs");

//callback will be called when the triangulation is done (optional argument)
var Leveler = function(file, callback) {
    "use strict";
    var that = this;

    function pointOutsideBoundary(triangle, point) {
        return ((point[0] > triangle[0][0] && point[0] > triangle[1][0] &&
                point[0] > triangle[2][0]) || (point[0] < triangle[0][0] &&
                point[0] < triangle[1][0] && point[0] < triangle[2][0]) ||
               (point[1] > triangle[0][1] && point[1] > triangle[1][1] &&
                point[1] > triangle[2][1]) || (point[1] < triangle[0][1] &&
                point[1] < triangle[1][1] && point[1] < triangle[2][1]));
    }

    function dotProduct(v1, v2) {
        return v1[0] * v2[0] + v1[1] * v2[1];
    }

    //Return false if not in triangle, else { triangle, u, v }
    //u and v are the coefficient of the barycenter from the point 0 of
    // the triangle
    function pointInTriangle(triangle, point) {
        if(pointOutsideBoundary(triangle, point) === true) {
            return false;
        }

        //Algorithm from http://www.blackpawn.com/texts/pointinpoly/

        // 0 is A, 1 is B, 2 is C
        var vAC = [triangle[2][0] - triangle[0][0], triangle[2][1] - triangle[0][1]];
        var vAB = [triangle[1][0] - triangle[0][0], triangle[1][1] - triangle[0][1]];
        var vAP = [point[0] - triangle[0][0], point[1] - triangle[0][1]];

        var dotACAC = dotProduct(vAC, vAC), dotACAB = dotProduct(vAC, vAB);
        var dotACAP = dotProduct(vAC, vAP), dotABAB = dotProduct(vAB, vAB);
        var dotABAP = dotProduct(vAB, vAP);

        //Find barycenter coefficients
        var invDenominator = 1 / (dotACAC * dotABAB - dotACAB * dotACAB);
        var u = (dotABAB * dotACAP - dotACAB * dotABAP) * invDenominator;
        var v = (dotACAC * dotABAP - dotACAB * dotACAP) * invDenominator;

        if(u < 0 || v < 0 || (u + v > 1)) {
            return false;
        }

        return { triangle : triangle, u : u, v : v };
    }

    //triangle is the triangle with the coordinates of each point
    that.findTriangle = function(coordinate) {
        var i = 0;
        var result, triangle;
        for(i = 0; i < that.triangles.length; i++) {
            triangle = [
                that.points[that.triangles[i][0]],
                that.points[that.triangles[i][1]],
                that.points[that.triangles[i][2]]
            ];
            result = pointInTriangle(triangle, coordinate);
            if(result !== false) {
                // Have to return the indexes because miss a dimension here
                result.triangle = that.triangles[i];
                return result;
            }
        }
        return false;
    };

    that.findHeight = function(coordinate) {
        var triangle = that.findTriangle(coordinate);
        if(triangle === false) {
            return false;
        }
        //Recuperate the true points and calculate the height
        var tr = triangle.triangle, u = triangle.u, v = triangle.v;
        var a = that.points[tr[0]],  b = that.points[tr[1]];
        var c = that.points[tr[2]];
        var height = a[2] + u * (c[2] - a[2]) + v * (b[2] - a[2]);
        return height;
    };

    function convertPointsForTriangulation(points3D) {
        var points2D = [];
        var i = 0;
        for(i=0; i < points3D.length; i++) {
            points2D.push([points3D[i][0], points3D[i][1]]);
        }
        return points2D;
    }

    //Compare the two points, returns negative if a < b, 0 if a == b else positive
    function comparePosition(a, b) {
        return a[0] - b[0];
    }

    function pointsEqual(a, b) {
        return (a[0] === b[0] && a[1] === b[1]);
    }

    function parseData(data) {
        var i = 0;
        var arr = data.split("\n"), point = [], points = [];

        for(i=0; i < arr.length; i++) {
            point = arr[i].split(" ");

            if(point.length === 3) {
                points.push([
                    parseFloat(point[0], 10),
                    parseFloat(point[1], 10),
                    parseFloat(point[2], 10),
                ]);
            }
        }

        return points;
    }


    function parseFile(error, data) {
        if(error) {
            console.error(error);
        }

        var i = 0, hightest = 0;
        var points2D = [];

        that.points = parseData(data);
        that.points.sort(comparePosition);

        //Remove the points in the same place
        for(i = 0; i < that.points.length; i++) {
            while(i < that.points.length - 1 &&
                    pointsEqual(that.points[i], that.points[i+1]))
            {
                if(that.points[i][2] !== that.points[i+1][2]) {
                    hightest = Math.max(that.points[i][2],
                            that.points[i+1][2]);
                }
                that.points.splice(i+1, 1);
                that.points[i][2] = hightest;
            }
        }

        points2D = convertPointsForTriangulation(that.points);
        that.triangles = triangulate(points2D);

        if(that.triangles === undefined) {
            console.error("Impossible to triangulate the point cloud.");
        }

        if(callback !== undefined) {
            callback();
        }
    }

    fs.readFile(file, "utf8", parseFile);
};

exports.Leveler = Leveler;
