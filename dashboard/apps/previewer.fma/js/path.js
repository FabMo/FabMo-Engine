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

    /**
     * Removes the meshes from the scene.
     */
    that.remove = function() {
        that.scene.remove(that.textWidth);
        that.scene.remove(that.lineWidth);
        that.scene.remove(that.textLength);
        that.scene.remove(that.lineLength);
        that.scene.remove(that.textHeight);
        that.scene.remove(that.lineHeight);
    };

    /**
     * Adds the meshes to the scene.
     */
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

    function sizeMesh(mesh, axe) {
        var bb = {};
        mesh.geometry.computeBoundingBox();
        bb = mesh.geometry.boundingBox;
        return Math.abs(bb.max[axe] - bb.min[axe]);
    }

    function calculateFontSize(width, length, height) {
        var minSize = 0.25, maxSize = 3, coeff = 20;
        var biggest = Math.max(width, length, height);
        var size = minSize;

        size = Math.max(minSize, biggest / coeff);
        size = Math.min(maxSize, size);

        return size;
    }

    /**
     * Sets the meshes.
     *
     * @param {object} totalSize The total size of the whole path.
     * @param {boolean} displayInMm If true, shows the size in millimeter. Else
     * in inch.
     * @param {object} initialPosition The position, in 3D, where thr whole
     * path begins (optional).
     */
    that.setMeshes = function(totalSize, displayInMm, initialPosition) {
        if(totalSize === undefined) {
            return;
        }
        var margin = 0.5;
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
        var fontSize = calculateFontSize(width, length, height);
        var options = {'font' : 'helvetiker','weight' : 'normal',
            'style' : 'normal','size' : fontSize,'curveSegments' : 300};
        var color = 0xffffff;

        that.remove();

        // For x axe
        var y = totalSize.max.y + margin;
        geometry.vertices.push(new THREE.Vector3(totalSize.min.x, y , 0));
        geometry.vertices.push(new THREE.Vector3(totalSize.max.x, y , 0));
        that.lineWidth =  new THREE.Line(geometry, material);
        that.textWidth = createMeshText(textW + " " + type, options, color);
        that.textWidth.position.x = that.lineWidth.geometry.vertices[0].x +
            (width - sizeMesh(that.textWidth, "x")) / 2;
        that.textWidth.position.y = that.lineWidth.geometry.vertices[0].y +
            options.size;
        that.textWidth.position.z = that.lineWidth.geometry.vertices[0].z;

        // For y axe
        var x = totalSize.max.x + margin;
        geometry = new THREE.Geometry();
        geometry.vertices.push(new THREE.Vector3(x, totalSize.min.y, 0));
        geometry.vertices.push(new THREE.Vector3(x, totalSize.max.y, 0));
        that.lineLength =  new THREE.Line(geometry, material);
        that.textLength = createMeshText(textL + " " + type, options, color);
        that.textLength.rotateZ(-Math.PI/2);
        that.textLength.position.x = that.lineLength.geometry.vertices[0].x +
            options.size;
        that.textLength.position.y = that.lineLength.geometry.vertices[0].y +
            (length + sizeMesh(that.textLength, "x")) / 2;  //x 'cause rotation
        that.textLength.position.z = that.lineLength.geometry.vertices[0].z;

        // For z axe
        geometry = new THREE.Geometry();
        geometry.vertices.push(new THREE.Vector3(x, y, totalSize.min.z));
        geometry.vertices.push(new THREE.Vector3(x, y, totalSize.max.z));
        that.lineHeight =  new THREE.Line(geometry, material);
        that.textHeight = createMeshText(textH + " " + type, options, color);
        that.textHeight.rotateX(Math.PI / 2);
        that.textHeight.position.x = that.lineHeight.geometry.vertices[0].x +
            options.size;
        that.textHeight.position.y = that.lineHeight.geometry.vertices[0].y;
        that.textHeight.position.z = that.lineHeight.geometry.vertices[0].z +
            (height - sizeMesh(that.textHeight, "y")) / 2;  //y 'cause rotation

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

    /**
     * Removes the meshes from the scene.
     */
    that.remove = function() {
        that.scene.remove(that.meshG0Undone);
        that.scene.remove(that.meshG1Undone);
        that.scene.remove(that.meshG2G3Undone);
        that.scene.remove(that.meshG0Done);
        that.scene.remove(that.meshG1Done);
        that.scene.remove(that.meshG2G3Done);
    };

    /**
     * Adds the meshes to the scene.
     */
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

    /**
     * Sets the meshes.
     *
     * @param {array} lines The array of lines describing the whole path.
     * @param {object} initialPosition The position, in 3D, where thr whole
     * path begins (optional).
     */
    that.setMeshes = function(lines, initialPosition) {
        resetPathsGeo();
        resetPathsMesh();
        setGeometries(lines);
        that.lines = lines;
        that.initialPosition = { x : 0, y : 0, z : 0};

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
            that.initialPosition.x = initialPosition.x;
            that.initialPosition.y = initialPosition.y;
            that.initialPosition.z = initialPosition.z;
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

    /**
     * Redoes the meshes as it was
     */
    that.redoMeshes = function() {
        that.remove();
        that.setMeshes(that.lines, that.initialPosition);
        that.add();
    };

    //Return the next index
    function setPathFromVertices(path, vertices, index, end, type, lineNumber,
            feedrate) {
        if(index >= vertices.length) {
            return -1;
        }
        var numberAdded = 0;

        while(index < vertices.length &&
                GCodeViewer.pointsEqual(vertices[index], end) === false)
        {
            numberAdded++;
            path.push({
                point : GCodeViewer.copyPoint(vertices[index]),
                type : type,
                lineNumber : lineNumber,
                feedrate : feedrate
            });
            index++;
        }

        if(index < vertices.length &&
                GCodeViewer.pointsEqual(vertices[index], end) === true)
        {
            numberAdded++;
            path.push({
                point : GCodeViewer.copyPoint(vertices[index]),
                type : type,
                lineNumber : lineNumber,
                feedrate : feedrate
            });
            index++;
        }

        //A path have at least 2 points. It happens this isn't the case here...
        if(numberAdded === 1) {
            path.push({
                point : GCodeViewer.copyPoint(vertices[index]),
                type : type,
                lineNumber : lineNumber,
                feedrate : feedrate
            });
            index++;
            numberAdded++;  //Not useful here
        }

        return index;
    }

    //Return the new path without the doubloons
    function removeDoubloons(path) {
        var iPath = 0, iSP = 0, lineNumber = 0; //iSinglePath
        var singlePath = [], newPath = [];

        while(iPath < path.length) {
            lineNumber = path[iPath].lineNumber;
            singlePath = [];

            //Recuperate a single path
            while(iPath < path.length && path[iPath].lineNumber === lineNumber) {
                singlePath.push(path[iPath]);
                iPath++;
            }

            //Remove doubloons
            if(singlePath.length > 2) {
                iSP = 0;
                //Never delete the last point
                while(iSP < singlePath.length-2) {
                    while(iSP < singlePath.length-2 &&
                            GCodeViewer.pointsEqual(singlePath[iSP].point,
                                singlePath[iSP+1].point) === true)
                    {
                        singlePath.splice(iSP+1, 1);
                    }
                    iSP++;
                }
            }

            for(iSP=0; iSP < singlePath.length; iSP++) {
                newPath.push(singlePath[iSP]);
            }


        }

        return newPath;
    }

    /**
     * Returns the path the animation has to follow.
     *
     * @return {array} The path the animation has to follow.
     */
    that.getPath = function() {
        var path = [], vertices = [];
        var iLine = 0, iG0 = 0, iG1 = 0, iG2G3 = 0;
        var line = {}, end = {}, type = "", lineNumber = 0;
        var feedrate = 0;

        if(that.lines === undefined) {
            return [];
        }

        //Copy all the vertices to the path
        for(iLine = 0; iLine < that.lines.length; iLine++) {
            line = that.lines[iLine];
            type = line.type;
            lineNumber = line.lineNumber;
            feedrate = line.feedrate;
            if(type === "G0") {
                vertices = that.meshG0Undone.geometry.vertices;
                end = line.end;
                iG0 = setPathFromVertices(path, vertices, iG0, end, type,
                        lineNumber, feedrate);
                if(iG0 < 0) {
                    return [];
                }
            } else if(type === "G1") {
                vertices = that.meshG1Undone.geometry.vertices;
                end = line.end;
                iG1 = setPathFromVertices(path, vertices, iG1, end, type,
                        lineNumber, feedrate);
                if(iG1 < 0) {
                    return [];
                }
            } else if(type === "G2" || type === "G3") {
                vertices = that.meshG2G3Undone.geometry.vertices;
                end = line.beziers[line.beziers.length - 1].p3;
                iG2G3 = setPathFromVertices(path, vertices, iG2G3, end, type,
                        lineNumber, feedrate);
                if(iG2G3 < 0) {
                    return [];
                }
            } else {
                return [];  //unknown type
            }
        }

        return removeDoubloons(path);
    };

    //This is ridiculous not to manage to update the vertices
    //Change the selectionned mesh
    function changeMesh(mesh, vertices, type, done) {
        var mat = {}, pos = {};
        var geo = new THREE.Geometry();
        geo.vertices = vertices;
        that.scene.remove(mesh);

        if(done === true) {
            if(type === "G0") {
                mat = that.matG0Done;
                pos = that.meshG0Done.position.clone();
                that.meshG0Done = new THREE.Line(geo, mat, THREE.LinePieces);
                that.meshG0Done.position.set(pos.x, pos.y, pos.z);
                that.scene.add(that.meshG0Done);
            } else if(type === "G1") {
                mat = that.matG1Done;
                pos = that.meshG1Done.position.clone();
                that.meshG1Done = new THREE.Line(geo, mat, THREE.LinePieces);
                that.meshG1Done.position.set(pos.x, pos.y, pos.z);
                that.scene.add(that.meshG1Done);
            } else {
                mat = that.matG2G3Done;
                pos = that.meshG2G3Done.position.clone();
                that.meshG2G3Done = new THREE.Line(geo, mat, THREE.LinePieces);
                that.meshG2G3Done.position.set(pos.x, pos.y, pos.z);
                that.scene.add(that.meshG2G3Done);
            }
        } else {
            if(type === "G0") {
                mat = that.matG0Undone;
                pos = that.meshG0Undone.position.clone();
                that.meshG0Undone = new THREE.Line(geo, mat, THREE.LinePieces);
                that.meshG0Undone.position.set(pos.x, pos.y, pos.z);
                that.scene.add(that.meshG0Undone);
            } else if(type === "G1") {
                mat = that.matG1Undone;
                pos = that.meshG1Undone.position.clone();
                that.meshG1Undone = new THREE.Line(geo, mat, THREE.LinePieces);
                that.meshG1Undone.position.set(pos.x, pos.y, pos.z);
                that.scene.add(that.meshG1Undone);
            } else {
                mat = that.matG2G3Undone;
                pos = that.meshG2G3Undone.position.clone();
                that.meshG2G3Undone = new THREE.Line(geo, mat, THREE.LinePieces);
                that.meshG2G3Undone.position.set(pos.x, pos.y, pos.z);
                that.scene.add(that.meshG2G3Undone);
            }
        }
    }

    //Return an object containing the "undone" and the "done" meshes
    function getMeshes(type) {
        var res = { undone : {}, done : {} };

        if(type === "G0") {
            res.undone = that.meshG0Undone;
            res.done = that.meshG0Done;
        } else if(type === "G1") {
            res.undone = that.meshG1Undone;
            res.done = that.meshG1Done;
        } else {  //I assume the types are correct
            res.undone = that.meshG2G3Undone;
            res.done = that.meshG2G3Done;
        }

        return res;
    }

    /**
     * To call when the bit starts a new path.
     *
     * @param {object} pointPath The point path the bit is reaching (this point
     * is from the path returned by getPath).
     */
    that.startPath = function(pointPath) {
        var meshes = getMeshes(pointPath.type);
        var meshDone = meshes.done;
        var verticesDone = meshDone.geometry.vertices;
        var p = pointPath.point;

        verticesDone.push(new THREE.Vector3(p.x, p.y, p.z));
        verticesDone.push(new THREE.Vector3(p.x, p.y, p.z));
        //No need to change vertices of the meshUndone

        changeMesh(meshDone, verticesDone, pointPath.type, true);
        // changeMesh(meshUndone, verticesUndone, pointPath.type, false);
    };

    /**
     * To call when the bit ends a path.
     *
     * @param {object} pointPath The point path the bit is reaching (this point
     * is from the path returned by getPath).
     */
    that.endPath = function(pointPath) {
        var meshes = getMeshes(pointPath.type);
        var meshDone = meshes.done, meshUndone = meshes.undone;
        var verticesDone = meshDone.geometry.vertices;
        var verticesUndone = meshUndone.geometry.vertices;
        var p = pointPath.point;

        if(verticesDone.length === 0) {
            return false;
        }
        verticesDone[verticesDone.length -1] = new THREE.Vector3(p.x, p.y, p.z);

        //Remove the vertex following the bit and the one at the end of the path
        verticesUndone.splice(0, 2);

        changeMesh(meshDone, verticesDone, pointPath.type, true);
        changeMesh(meshUndone, verticesUndone, pointPath.type, false);
    };

    /**
     * To call when the bit reaches an intermediate point of a path.
     *
     * @param {object} pointPath The point path the bit is reaching (this point
     * is from the path returned by getPath).
     */
    that.reachedIntermediate = function(pointPath) {
        that.endPath(pointPath);
        that.startPath(pointPath);
    };

    /**
     * To call when the bit from the animation is reaching one point from the
     * path.
     *
     * @param {object} pointPath The point path the bit is reaching (this point
     * is from the path returned by getPath).
     * @param {object} currentPosition The current position of the bit in 3D.
     * @return {boolean} False if there was a problem.
     */
    that.isReachingPoint = function(pointPath, currentPosition) {
        var meshes = getMeshes(pointPath.type);
        var meshDone = meshes.done, meshUndone = meshes.undone;
        var verticesDone = meshDone.geometry.vertices;
        var verticesUndone = meshUndone.geometry.vertices;
        var p = currentPosition;

        if(verticesDone.length < 2) {
            return false;
        }
        verticesUndone[0].set(p.x, p.y, p.z);
        verticesDone[verticesDone.length -1].set(p.x, p.y, p.z);
        changeMesh(meshDone, verticesDone, pointPath.type, true);
        changeMesh(meshUndone, verticesUndone, pointPath.type, false);

        return true;
    };

    // initialize
    that.scene = scene;
    resetPathsGeo();
    resetPathsMesh();
    that.matG0Undone = new THREE.LineDashedMaterial(
            { color : 0xff0000, dashSize : 7 });
    that.matG1Undone = new THREE.LineBasicMaterial(
            { color : 0x000ff });
    that.matG2G3Undone = new THREE.LineBasicMaterial(
            { color : 0x000ff });
    that.matG0Done = new THREE.LineDashedMaterial(
            { color : 0xff00ff, dashSize : 2 });
    that.matG1Done = new THREE.LineBasicMaterial({ color : 0xff00ff });
    that.matG2G3Done = new THREE.LineBasicMaterial({ color : 0xff00ff });
};
