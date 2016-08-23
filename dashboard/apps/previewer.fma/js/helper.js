/*jslint todo: true, browser: true, continue: true, white: true*/
/*global THREE, GParser, GCodeViewer */

/**
 * Written by Alex Canales for ShopBotTools, Inc.
 */

/**
 * This file contains the class managing the UI helpers (arrows, axis, etc).
 */

var GCodeViewer = require('./path.js');
var typeface = require('./helvetiker_regular.typeface.js');
THREE.typeface_js.loadFace(typeface);
GCodeViewer.Helpers = function(scene) {
    "use strict";
    var that = this;

    //Arrows helpers
    that.addArrows = function() {
        that.scene.add(that.arrowX);
        that.scene.add(that.textX);
        that.scene.add(that.arrowY);
        that.scene.add(that.textY);
        that.scene.add(that.arrowZ);
        that.scene.add(that.textZ);
        that.scene.add(that.textZ2);
    };

    that.removeArrows = function() {
        that.scene.remove(that.arrowX);
        that.scene.remove(that.textX);
        that.scene.remove(that.arrowY);
        that.scene.remove(that.textY);
        that.scene.remove(that.arrowZ);
        that.scene.remove(that.textZ);
        that.scene.remove(that.textZ2);
    };

    //size is a struct { length, head, font }
    function createArrowsHelper(headSize) {
        var length = 3, fontSize = headSize * 2;
        var options = {'font' : 'helvetiker' ,'weight' : 'normal',
            'style' : 'normal','size' : fontSize,'curveSegments' : 300};
        var margin = headSize + headSize / 2;

        //For X
        var dir = new THREE.Vector3(1, 0, 0);
        var origin = new THREE.Vector3(0, -margin, 0);
        var hex = 0xff0000;
        that.arrowX = new THREE.ArrowHelper(dir, origin, length, hex,
                headSize, headSize);

        var material = new THREE.MeshBasicMaterial({ color: hex,
            side: THREE.DoubleSide });
        console.log(THREE.FontUtils.faces);
        var textShapes = THREE.FontUtils.generateShapes("X", options);
        var geo = new THREE.ShapeGeometry(textShapes);
        that.textX = new THREE.Mesh(geo, material);
        that.textX.position.x = origin.x + length + margin;
        that.textX.position.y = origin.y - options.size/2;
        that.textX.position.z = origin.z;

        //For Y
        dir = new THREE.Vector3(0, 1, 0);
        origin = new THREE.Vector3(-margin, 0, 0);
        hex = 0x00ff00;
        that.arrowY = new THREE.ArrowHelper(dir, origin, length, hex,
                headSize, headSize);

        material = new THREE.MeshBasicMaterial({ color: hex,
            side: THREE.DoubleSide });
        textShapes = THREE.FontUtils.generateShapes("Y", options);
        geo = new THREE.ShapeGeometry(textShapes);
        that.textY = new THREE.Mesh(geo, material);
        that.textY.position.x = origin.x - options.size/2;
        that.textY.position.y = origin.y + length + margin;
        that.textY.position.z = origin.z;

        //For Z
        dir = new THREE.Vector3(0, 0, 1);
        origin = new THREE.Vector3(-margin, -margin, 0);
        hex = 0x0000ff;
        that.arrowZ = new THREE.ArrowHelper(dir, origin, length, hex,
                headSize, headSize);

        material = new THREE.MeshBasicMaterial({ color: hex });
        textShapes = THREE.FontUtils.generateShapes("Z", options);
        geo = new THREE.ShapeGeometry(textShapes);
        that.textZ = new THREE.Mesh(geo, material);
        that.textZ.position.x = origin.x - options.size/2;
        that.textZ.position.y = origin.y;
        that.textZ.position.z = origin.z + length + margin;
        that.textZ.rotateX(Math.PI / 2);

        //To not see the Z "upside down" change rotating
        that.textZ2 = that.textZ.clone();
        that.textZ2.rotateX(Math.PI);
        that.textZ2.position.z += options.size;
    }

    //Redo the meshes to suit with the size
    that.resize = function(totalSize) {
        var xSize = 0, ySize = 0;
        var minSize = 0.25, maxSize = 3, coeff = 40;
        var size = minSize;
        that.removeArrows();

        if(totalSize !== undefined) {
            xSize = totalSize.max.x - totalSize.min.x;
            ySize = totalSize.max.y - totalSize.min.y;
            size = Math.max(minSize, Math.max(xSize, ySize) / coeff);
            size = Math.min(maxSize, size);
        }

        createArrowsHelper(size);
        that.addArrows();
    };

    // initialize
    that.scene = scene;
    that.resize();
    that.axisHelpers = new THREE.AxisHelper(100);
    that.scene.add(that.axisHelpers);
};

module.exports = GCodeViewer;
