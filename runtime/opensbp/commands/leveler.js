/*jslint todo: true, browser: true, continue: true, white: true*/
/*global define*/

var log = require('../../../log').logger('sbp');
var fs = require('fs');
var triangulate = require("delaunay-triangulate");

/**
 * The leveler calculates the position of points according to the given point
 * cloud. This is used to have better height precision when working on a slope
 * or curved surface.
 *
 * If the given file does not exists or a problem occurs with the triangulation,
 * the triangulation is not done. Therefore before using the methods for
 * finding relative heights, triangulationFailed should be called and check.
 *
 * @param {string} file The file path of the point cloud (in XYZ format).
 * @param {function} callback (optional) Callback function to call when the
 * triangulation is done.
 */
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

    //Return false if not in triangle, else { triangle, coeffAC, coeffAB }
    //coeffAC and coeffAB are the coefficient of the barycenter from the point
    //0 (A) of the triangle
    function pointInTriangle(triangle, point) {
        if(pointOutsideBoundary(triangle, point) === true) {
            return false;
        }

        //Algorithm from http://www.blackpawn.com/texts/pointinpoly/

        var a = triangle[0];
        var b = triangle[1];
        var c = triangle[2];

        var vAC = [c[0] - a[0], c[1] - a[1]];
        var vAB = [b[0] - a[0], b[1] - a[1]];
        var vAP = [point[0] - a[0], point[1] - a[1]];

        var dotACAC = dotProduct(vAC, vAC), dotACAB = dotProduct(vAC, vAB);
        var dotACAP = dotProduct(vAC, vAP), dotABAB = dotProduct(vAB, vAB);
        var dotABAP = dotProduct(vAB, vAP);

        //Find barycenter coefficients
        var denominator = dotACAC * dotABAB - dotACAB * dotACAB;

        //Sometimes, the triangulation algorithm considers three aligned points
        //as a triangle which should not be possible and gives the denominator
        //the value of zero
        if(denominator === 0) {
            return false;
        }

        var coeffAC = (dotABAB * dotACAP - dotACAB * dotABAP) / denominator;
        var coeffAB = (dotACAC * dotABAP - dotACAB * dotACAP) / denominator;

        if(coeffAC < 0 || coeffAB < 0 || (coeffAC + coeffAB > 1)) {
            return false;
        }

        return { triangle : triangle, coeffAC : coeffAC, coeffAB : coeffAB };
    }

    //triangle is the triangle with the coordinates of each point
    //Returns false if cannot find a triangle else the triangle with the
    //barycenter coefficients
    that.findTriangleAndCoefficients = function(coordinate) {
        var i = 0;
        var result, triangle;

        if(that.triangles === undefined) {
            return false;
        }

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

    /**
     * Finds the relative height of the point according to the given point
     * cloud. If the point is outside of the point cloud on the XY plane, the
     * function returns false.
     * Also, foundHeight is updated each time the function is executed. When a
     * height is returned, foundHeight is equal to the returned height else to
     * 0.
     *
     * @param {number} x The x coordinate of the point.
     * @param {number} y The y coordinate of the point.
     * @return {number|boolean} Returns false if the point is outside of the
     * point cloud boundaries, else the relative height according to the
     * surface of the point cloud.
     */
    that.findHeight = function(x, y) {
        var triangle = that.findTriangleAndCoefficients([x, y, 0]);
        if(triangle === false) {
            that.foundHeight = 0;
            return false;
        }
        //Recuperate the true points and calculate the height
        var tr = triangle.triangle, coeffAC = triangle.coeffAC;
        var coeffAB = triangle.coeffAB;
        var a = that.points[tr[0]],  b = that.points[tr[1]];
        var c = that.points[tr[2]];
        var height = a[2] + coeffAC * (c[2] - a[2]) + coeffAB * (b[2] - a[2]);

        that.foundHeight = height;
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

    /**
     * The data must be in the format of an XYZ file.  Which means each line
     * contains the x, y, z coordinates of a point separated by spaces.
     * Example:
     *     12.05 5.4 1.0
     *     10.5 1.6 22.1
     *     0 0 5
     *
     * @param {string} The data.
     * @return {array} Array of points (defined as three dimensionnal arrays)
     */
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

    /**
     * Returns if the triangulation failed or not.
     *
     * @return {boolean} True if failed.
     */
    that.triangulationFailed = function() {
        return (that.triangles.length === 0);
    };


    function parseFile(error, data) {
        if(error) {
            log.error(error);
            return;
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

        if(that.triangulationFailed() === true) {
            //Should stop the job
            log.error(new Error("Impossible to triangulate the point cloud."));
        }

        if(callback !== undefined) {
            callback(null);
        }
    }

    that.points = [];
    that.triangles = [];
    that.foundHeight = 0;  //Useful for comparing with the previous found height

    var stats = fs.statSync(file);
    if(stats.isFile() === false) {
        return;
    }
    parseFile(null, fs.readFileSync(file, "utf8"));
};

exports.Leveler = Leveler;
