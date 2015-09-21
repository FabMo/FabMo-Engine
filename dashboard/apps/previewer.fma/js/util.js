/*jslint todo: true, browser: true, continue: true, white: true*/
/*global THREE, GCodeViewer, GCodeToGeometry*/

/**
 * Written by Alex Canales for ShopBotTools, Inc.
 */

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
 * Checks if two numbers are nearly equal. This function is used to avoid
 * to have too much precision when checking values.
 *
 * @param {number} a Number A.
 * @param {number} b Number B.
 * @return {boolean} True if the two value are nearly equal.
 */
GCodeViewer.nearlyEqual = function(a, b) {
    return Math.abs(b - a) <= 0.001;
};

/**
 * Checks if two points in 3D are considered as "equal". This function is
 * useful to avoid to be too much precise (JavaScript can not do very precise
 * calculations).
 *
 * @param {object} a Point A.
 * @param {object} b Point B.
 * @return {boolean} True if the two points are nearly equal.
 */
GCodeViewer.samePosition = function(posA, posB) {
    return (GCodeViewer.nearlyEqual(posA.x, posB.x) &&
            GCodeViewer.nearlyEqual(posA.y, posB.y) &&
            GCodeViewer.nearlyEqual(posA.z, posB.z));
};
