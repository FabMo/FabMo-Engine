/*jslint todo: true, browser: true, continue: true, white: true*/
/*global THREE, GCodeToGeometry*/

/**
 * Written by Alex Canales for ShopBotTools, Inc.
 */

/**
 * This file contains the class managing the path view.
 */

var GCodeViewer = {};

//Class to create the meshes showing the measure of the path
GCodeViewer.TotalSize = function(scene) {
    "use strict";
    var that = this;

    that.remove = function() {
        that.scene.remove(that.textWidth);
        that.scene.remove(that.lineWidth);
        that.scene.remove(that.textLength);
        that.scene.remove(that.lineLength);
        that.scene.remove(that.textHeight);
        that.scene.remove(that.lineHeight);
    };

    that.add = function() {
        that.scene.add(that.textWidth);
        that.scene.add(that.lineWidth);
        that.scene.add(that.textLength);
        that.scene.add(that.lineLength);
        that.scene.add(that.textHeight);
        that.scene.add(that.lineHeight);
    };

    function createMeshText(message, options, color) {
        var material = new THREE.MeshBasicMaterial({ color: color,
            side: THREE.DoubleSide });
        var textShapes = THREE.FontUtils.generateShapes(message, options);
        var geo = new THREE.ShapeGeometry(textShapes);
        return new THREE.Mesh(geo, material);
    }

    //Really dumb function that return the size, on the axe, of a mesh
    //Should use bounding box!
    function sizeMesh(mesh, axe) {
        var v = mesh.geometry.vertices;
        if(v.length <= 1) {
            return 0;
        }
        return Math.abs(v[v.length - 1][axe] - v[0][axe]);
    }

    that.setMeshes = function(totalSize, displayInMm, initialPosition) {
        if(totalSize === undefined) {
            return;
        }
        var material = new THREE.LineBasicMaterial({ color : 0xffffff });
        var geometry = new THREE.Geometry();
        var type = (displayInMm === false) ? "in" : "mm";
        var d = (displayInMm === false) ? 1 : GCodeToGeometry.inchToMm;
        var width = Math.abs(totalSize.max.x - totalSize.min.x);
        var length = Math.abs(totalSize.max.y - totalSize.min.y);
        var height = Math.abs(totalSize.max.z - totalSize.min.z);
        var textW = (width * d).toFixed(2);
        var textL = (length * d).toFixed(2);
        var textH = (height * d).toFixed(2);
        var options = {'font' : 'helvetiker','weight' : 'normal',
            'style' : 'normal','size' : 1,'curveSegments' : 300};
        var color = 0xffffff;

        that.remove();

        // For x axe
        geometry.vertices.push(new THREE.Vector3(totalSize.min.x, -2 , 0));
        geometry.vertices.push(new THREE.Vector3(totalSize.max.x, -2 , 0));
        that.lineWidth =  new THREE.Line(geometry, material);
        that.textWidth = createMeshText(textW + " " + type, options, color);
        that.textWidth.position.x = that.lineWidth.geometry.vertices[0].x +
            width / 2;
        that.textWidth.position.y = that.lineWidth.geometry.vertices[0].y -
            (options.size + 1);
        that.textWidth.position.z = that.lineWidth.geometry.vertices[0].z;

        // For y axe
        geometry = new THREE.Geometry();
        geometry.vertices.push(new THREE.Vector3(-2, totalSize.min.y, 0));
        geometry.vertices.push(new THREE.Vector3(-2, totalSize.max.y, 0));
        that.lineLength =  new THREE.Line(geometry, material);
        that.textLength = createMeshText(textL + " " + type, options, color);
        that.textLength.rotateZ(-Math.PI/2);
        that.textLength.position.x = that.lineLength.geometry.vertices[0].x-
            (options.size + 1);
        that.textLength.position.y = that.lineLength.geometry.vertices[0].y+
            length / 2;
        that.textLength.position.z = that.lineLength.geometry.vertices[0].z;

        // For z axe
        geometry = new THREE.Geometry();
        geometry.vertices.push(new THREE.Vector3(-2, 0, totalSize.min.z));
        geometry.vertices.push(new THREE.Vector3(-2, 0, totalSize.max.z));
        that.lineHeight =  new THREE.Line(geometry, material);
        that.textHeight = createMeshText(textH + " " + type, options, color);
        that.textHeight.rotateX(Math.PI / 2);
        that.textHeight.position.x = that.lineHeight.geometry.vertices[0].x -
            sizeMesh(that.textHeight, "x") - options.size;
        that.textHeight.position.y = that.lineHeight.geometry.vertices[0].y;
        that.textHeight.position.z = that.lineHeight.geometry.vertices[0].z +
            height / 2;

        if(initialPosition !== undefined) {
            that.lineWidth.position.x += initialPosition.x;
            that.textWidth.position.x += initialPosition.x;
            that.lineLength.position.y += initialPosition.y;
            that.textLength.position.y += initialPosition.y;
            that.textHeight.position.z += initialPosition.z;
            that.lineHeight.position.z += initialPosition.z;
        }
    };

    // initialize
    that.scene = scene;
    that.textWidth = {};
    that.lineWidth = {};
    that.textLength = {};
    that.lineLength = {};
    that.textHeight = {};
    that.lineHeight = {};
};


GCodeViewer.Path = function(scene) {
    "use strict";
    var that = this;

    function resetPathsGeo() {
        that.geoG0Undone = new THREE.Geometry();
        that.geoG1Undone = new THREE.Geometry();
        that.geoG2G3Undone = new THREE.Geometry();
        that.geoG0Done = new THREE.Geometry();
        that.geoG1Done = new THREE.Geometry();
        that.geoG2G3Done = new THREE.Geometry();
    }

    function resetPathsMesh() {
        that.meshG0Undone = {};
        that.meshG1Undone = {};
        that.meshG2G3Undone = {};
        that.meshG0Done = {};
        that.meshG1Done = {};
        that.meshG2G3Done = {};
    }

    that.remove = function() {
        that.scene.remove(that.meshG0Undone);
        that.scene.remove(that.meshG1Undone);
        that.scene.remove(that.meshG2G3Undone);
        that.scene.remove(that.meshG0Done);
        that.scene.remove(that.meshG1Done);
        that.scene.remove(that.meshG2G3Done);
    };

    that.add = function() {
        that.scene.add(that.meshG0Undone);
        that.scene.add(that.meshG1Undone);
        that.scene.add(that.meshG2G3Undone);
        that.scene.add(that.meshG0Done);
        that.scene.add(that.meshG1Done);
        that.scene.add(that.meshG2G3Done);
    };

    function getGeometryStraight(line) {
        var s = line.start, e = line.end;
        var geometry = new THREE.Geometry();
        geometry.vertices.push(new THREE.Vector3(s.x, s.y, s.z));
        geometry.vertices.push(new THREE.Vector3(e.x, e.y, e.z));
        return geometry;
    }

    function getGeometryCurve(line) {
        var i = 0, j = 0;
        var bez = line.beziers;
        var p0 = {}, p1 = {}, p2 = {}, p3 = {};
        var v = [];
        var geometry = new THREE.Geometry();

        for(i=0; i < bez.length; i++) {
            p0 = new THREE.Vector3(bez[i].p0.x, bez[i].p0.y, bez[i].p0.z);
            p1 = new THREE.Vector3(bez[i].p1.x, bez[i].p1.y, bez[i].p1.z);
            p2 = new THREE.Vector3(bez[i].p2.x, bez[i].p2.y, bez[i].p2.z);
            p3 = new THREE.Vector3(bez[i].p3.x, bez[i].p3.y, bez[i].p3.z);

            v = new THREE.CubicBezierCurve3(p0, p1, p2, p3).getPoints(32);
            for(j=0; j < v.length; j++) {
                geometry.vertices.push(v[j]);
            }
        }
        return geometry;
    }

    function setGeometries(lines) {
        var i = 0, j = 0;
        var geometry = new THREE.Geometry();

        if(lines.length === 0) {
            return;
        }

        for(i=0; i < lines.length; i++) {
            if(lines[i].type === "G0") {
                geometry = getGeometryStraight(lines[i]);
                that.geoG0Undone.merge(geometry);
            } else if(lines[i].type === "G1") {
                geometry = getGeometryStraight(lines[i]);
                that.geoG1Undone.merge(geometry);
            } else if(lines[i].type === "G2" || lines[i].type === "G3") {
                geometry = getGeometryCurve(lines[i]);
                that.geoG2G3Undone.vertices.push(geometry.vertices[0]);
                for(j=1; j < geometry.vertices.length-1; j++) {
                    that.geoG2G3Undone.vertices.push(geometry.vertices[j]);
                    that.geoG2G3Undone.vertices.push(geometry.vertices[j]);
                }
                if(geometry.vertices.length > 1) {
                    that.geoG2G3Undone.vertices.push(
                            geometry.vertices[geometry.vertices.length - 1]
                            );
                }
            }
        }
    }

    that.setMeshes = function(lines, initialPosition) {
        resetPathsGeo();
        resetPathsMesh();
        setGeometries(lines);

        that.meshG0Undone = new THREE.Line(that.geoG0Undone,
                that.matG0Undone, THREE.LinePieces);
        that.meshG1Undone = new THREE.Line(that.geoG1Undone,
                that.matG1Undone, THREE.LinePieces);
        that.meshG2G3Undone = new THREE.Line(that.geoG2G3Undone,
                that.matG2G3Undone, THREE.LinePieces);
        that.meshG0Done = new THREE.Line(that.geoG0Done,
                that.matG0Done, THREE.LinePieces);
        that.meshG1Done = new THREE.Line(that.geoG1Done,
                that.matG1Done, THREE.LinePieces);
        that.meshG2G3Done = new THREE.Line(that.geoG2G3Done,
                that.matG2G3Done, THREE.LinePieces);

        if(initialPosition !== undefined) {
            that.meshG0Undone.position.set(initialPosition.x,
                    initialPosition.y, initialPosition.z);
            that.meshG1Undone.position.set(initialPosition.x,
                    initialPosition.y, initialPosition.z);
            that.meshG2G3Undone.position.set(initialPosition.x,
                    initialPosition.y, initialPosition.z);
            that.meshG0Done.position.set(initialPosition.x,
                    initialPosition.y, initialPosition.z);
            that.meshG1Done.position.set(initialPosition.x,
                    initialPosition.y, initialPosition.z);
            that.meshG2G3Done.position.set(initialPosition.x,
                    initialPosition.y, initialPosition.z);
        }
    };

    // initialize
    that.scene = scene;
    resetPathsGeo();
    resetPathsMesh();
    that.matG0Undone = new THREE.LineDashedMaterial(
            { color : 0x8877dd, dashSize : 7 });
    that.matG1Undone = new THREE.LineBasicMaterial(
            { color : 0xffffff });
    that.matG2G3Undone = new THREE.LineBasicMaterial(
            { color : 0xffffff });
    that.matG0Done = new THREE.LineDashedMaterial(
            { color : 0x8877dd, dashSize : 2 });
    that.matG1Done = new THREE.LineBasicMaterial({ color : 0xff0000 });
    that.matG2G3Done = new THREE.LineBasicMaterial({ color : 0xee6699 });
};
