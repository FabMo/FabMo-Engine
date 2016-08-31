/*jslint todo: true, browser: true, continue: true, white: true*/
/*global THREE, GCodeViewer, GCodeToGeometry*/

/**
 * Written by Alex Canales for ShopBotTools, Inc.
 */

/**
 * Checks if WebGL is enabled or not.
 * @return {boolean} True is enabled
 */
var GCodeViewer = require('./animation.js');
var GCodeToGeometry = require('./gcodetogeometry.min.js');
console.log(GCodeToGeometry);

GCodeViewer.webGLEnabled = function() {
    // From http://www.browserleaks.com/webgl#howto-detect-webgl
    if(!!window.WebGLRenderingContext) {
        var canvas = document.createElement("canvas"),
            names = ["webgl", "experimental-webgl", "moz-webgl"],
            gl = false;
        for(var i=0; i < names.length; i++) {
            try {
                gl = canvas.getContext(names[i]);
                if (gl && typeof gl.getParameter == "function") {
                    /* WebGL is enabled */
                    return true;
                }
            } catch(e) {}
        }
        /* WebGL is supported, but disabled */
        return false;
    }
    /* WebGL not supported*/
    return false;
};

/**
 * Checks if two points in 3D are equal.
 *
 * @param {object} a Point A.
 * @param {object} b Point B.
 * @return {boolean} True if the two points are equal.
 */
GCodeViewer.pointsEqual = function(a, b) {
    return (a.x === b.x && a.y === b.y && a.z === b.z);
};

/**
 * Returns a copy of a point in 3D.
 *
 * @param {object} point A point in 3D.
 * @return {object} A copy of the point.
 */
GCodeViewer.copyPoint = function(point) {
    return { x : point.x, y : point.y, z : point.z };
};

/**
 * Checks if two points in 3D are considered as "equal". This function is
 * useful to avoid to be too much precise (JavaScript can not do very precise
 * calculations).
 *
 * @param {object} a Point A.
 * @param {object} b Point B.
 * @return {boolean} True if the two points are nearly equal.
 * 
 * 
 */

function nearlyEqual(a, b) {
    return Math.abs(b - a) <= 0.001;
}


GCodeViewer.samePosition = function(posA, posB) {
    return (nearlyEqual(posA.x, posB.x) &&
            nearlyEqual(posA.y, posB.y) &&
            nearlyEqual(posA.z, posB.z));
};

module.exports = GCodeViewer;