/*jslint todo: true, browser: true, continue: true, white: true*/
/*global THREE, GCodeViewer, GCodeToGeometry*/

/**
 * Written by Alex Canales for ShopBotTools, Inc.
 */

//Return true if a and b in the same position
GCodeViewer.pointsEqual = function(a, b) {
    return (a.x === b.x && a.y === b.y && a.z === b.z);
};

GCodeViewer.copyPoint = function(point) {
    return { x : point.x, y : point.y, z : point.z };
};

GCodeViewer.nearlyEqual = function(a, b) {
    return Math.abs(b - a) <= 0.001;
};

GCodeViewer.samePosition = function(posA, posB) {
    return (GCodeViewer.nearlyEqual(posA.x, posB.x) &&
            GCodeViewer.nearlyEqual(posA.y, posB.y) &&
            GCodeViewer.nearlyEqual(posA.z, posB.z));
};
