/*jslint todo: true, browser: true, continue: true, white: true*/
/*global THREE, GParser, GCodeViewer */

/**
 * Written by Alex Canales for ShopBotTools, Inc.
 */

/**
 * This file contains the class managing the UI helpers (arrows, axis, etc).
 */

GCodeViewer.AxisHelper = function(scene) {
    "use strict";
    var that = this;

    that.addAxisHelper = function() {
        that.scene.add(that.axisHelpers);
    };

    that.removeAxisHelper = function() {
        that.scene.remove(that.axisHelpers);
    };

    that.scene = scene;

};

GCodeViewer.Helpers = function(scene) {
    "use strict";
    var that = this;

    //Axis helper
    that.addAxisHelper = function() {
        that.scene.add(that.axisHelpers);
    };

    that.removeAxisHelper = function() {
        that.scene.remove(that.axisHelpers);
    };

    function createAxisHelper() {
        that.axisHelpers = new THREE.AxisHelper(100);
    }

    //Arrows helpers
    that.addArrows = function() {
        that.scene.add(that.arrowX);
        that.scene.add(that.textX);
        that.scene.add(that.arrowY);
        that.scene.add(that.textY);
        that.scene.add(that.arrowZ);
        that.scene.add(that.textZ);
    };

    that.removeArrows = function() {
        that.scene.remove(that.arrowX);
        that.scene.remove(that.textX);
        that.scene.remove(that.arrowY);
        that.scene.remove(that.textY);
        that.scene.remove(that.arrowZ);
        that.scene.remove(that.textZ);
    };

    function createArrowsHelper() {
        var length = 3, headLength = 1, headWidth = 1;
        var options = {'font' : 'helvetiker','weight' : 'normal',
            'style' : 'normal','size' : 2,'curveSegments' : 300};

        //For X
        var dir = new THREE.Vector3(1, 0, 0);
        var origin = new THREE.Vector3(0, -1.5, 0);
        var hex = 0xff0000;
        that.arrowX = new THREE.ArrowHelper(dir, origin, length, hex,
                headLength, headWidth);

        var material = new THREE.MeshBasicMaterial({ color: hex,
            side: THREE.DoubleSide });
        var textShapes = THREE.FontUtils.generateShapes("X", options);
        var geo = new THREE.ShapeGeometry(textShapes);
        that.textX = new THREE.Mesh(geo, material);
        that.textX.position.x = origin.x + length + 1;
        that.textX.position.y = origin.y - options.size/2;
        that.textX.position.z = origin.z;

        //For Y
        dir = new THREE.Vector3(0, 1, 0);
        origin = new THREE.Vector3(-1.5, 0, 0);
        hex = 0x00ff00;
        that.arrowY = new THREE.ArrowHelper(dir, origin, length, hex,
                headLength, headWidth);

        material = new THREE.MeshBasicMaterial({ color: hex,
            side: THREE.DoubleSide });
        textShapes = THREE.FontUtils.generateShapes("Y", options);
        geo = new THREE.ShapeGeometry(textShapes);
        that.textY = new THREE.Mesh(geo, material);
        that.textY.position.x = origin.x - options.size/2;
        that.textY.position.y = origin.y + length + 1;
        that.textY.position.z = origin.z;

        //For Z
        dir = new THREE.Vector3(0, 0, 1);
        origin = new THREE.Vector3(-1.5, -1.5, 0);
        hex = 0x0000ff;
        that.arrowZ = new THREE.ArrowHelper(dir, origin, length, hex,
                headLength, headWidth);

        material = new THREE.MeshBasicMaterial({ color: hex,
            side: THREE.DoubleSide });
        textShapes = THREE.FontUtils.generateShapes("Z", options);
        geo = new THREE.ShapeGeometry(textShapes);
        that.textZ = new THREE.Mesh(geo, material);
        that.textZ.position.x = origin.x - options.size/2;
        that.textZ.position.y = origin.y;
        that.textZ.position.z = origin.z + length + 1;
        that.textZ.rotateX(Math.PI / 2);
    }

    //General
    that.addHelpers = function() {
        that.addAxisHelper();
        that.addArrows();
    };

    that.removeHelpers = function() {
        that.removeAxisHelper();
        that.removeArrows();
    };

    function createHelpers() {
        createArrowsHelper();
        createAxisHelper();
    }

    // initialize
    that.scene = scene;
    createHelpers();
    that.addHelpers();
};
