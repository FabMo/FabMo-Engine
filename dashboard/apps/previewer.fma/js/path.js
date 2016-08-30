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
        var color = 0x000000;
        var margin = 0.5;
        var material = new THREE.LineBasicMaterial({ color : color });
        var geometry = new THREE.Geometry();
        var type = (displayInMm === false) ? "in" : "mm";
        var d = (displayInMm === false) ? 1 : GCodeToGeometry.INCH_TO_MILLIMETER;
        var width = Math.abs(totalSize.max.x - totalSize.min.x);
        var length = Math.abs(totalSize.max.y - totalSize.min.y);
        var height = Math.abs(totalSize.max.z - totalSize.min.z);
        var textW = (width * d).toFixed(2);
        var textL = (length * d).toFixed(2);
        var textH = (height * d).toFixed(2);
        var fontSize = calculateFontSize(width, length, height);
        var options = {'font' : 'helvetiker','weight' : 'normal',
            'style' : 'normal','size' : fontSize,'curveSegments' : 300};

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

        that.add();
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

    function resetPathsMesh() {
        that.remove();
        that.meshG0Undone = {};
        that.meshG1Undone = {};
        that.meshG2G3Undone = {};
        that.meshG0Done = {};
        that.meshG1Done = {};
        that.meshG2G3Done = {};
        that.meshDoing = {};
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
        that.scene.remove(that.meshDoing);
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
            for(j=0; j < v.length-1; j++) {
                geometry.vertices.push(v[j]);
            }
        }
        //When mutltiple Bézier curves, useless to have the end point and the
        //next start point in the same place
        geometry.vertices.push(v[v.length-1]);
        return geometry;
    }

     // Returns the geometries
    function setGeometries(lines) {
        var i = 0, j = 0;
        var geometry = new THREE.Geometry();
        var geometries = {
            G0 : new THREE.Geometry(),
            G1 : new THREE.Geometry(),
            G2G3 : new THREE.Geometry()
        };

        //Store the number of vertices of each command
        that.commandsUndoneManager = [];
        that.commandsDoneManager = [];

        if(lines.length === 0) {
            return geometries;
        }

        for(i=0; i < lines.length; i++) {
            if(lines[i].type === "G0") {
                geometry = getGeometryStraight(lines[i]);
                geometries.G0.merge(geometry);

                that.commandsUndoneManager.push({
                    type : lines[i].type,
                    lineNumber : lines[i].lineNumber,
                    feedrate : lines[i].feedrate,
                    start : GCodeViewer.copyPoint(geometry.vertices[0]),
                    end : GCodeViewer.copyPoint(geometry.vertices[geometry.vertices.length - 1]),
                    numberVertices : geometry.vertices.length
                });
            } else if(lines[i].type === "G1") {
                geometry = getGeometryStraight(lines[i]);
                geometries.G1.merge(geometry);

                that.commandsUndoneManager.push({
                    type : lines[i].type,
                    lineNumber : lines[i].lineNumber,
                    feedrate : lines[i].feedrate,
                    start : GCodeViewer.copyPoint(geometry.vertices[0]),
                    end : GCodeViewer.copyPoint(geometry.vertices[geometry.vertices.length - 1]),
                    numberVertices : geometry.vertices.length
                });
            } else if(lines[i].type === "G2" || lines[i].type === "G3") {
                geometry = getGeometryCurve(lines[i]);
                geometries.G2G3.vertices.push(geometry.vertices[0]);

                for(j=1; j < geometry.vertices.length-1; j++) {
                    geometries.G2G3.vertices.push(geometry.vertices[j]);
                    geometries.G2G3.vertices.push(geometry.vertices[j]);
                }
                geometries.G2G3.vertices.push(geometry.vertices[j]);

                that.commandsUndoneManager.push({
                    type : lines[i].type,
                    lineNumber : lines[i].lineNumber,
                    feedrate : lines[i].feedrate,
                    start : GCodeViewer.copyPoint(geometry.vertices[0]),
                    end : GCodeViewer.copyPoint(geometry.vertices[geometry.vertices.length - 1]),
                    numberVertices : (geometry.vertices.length - 1) * 2
                });
            }
        }

        return geometries;
    }

    /**
     * Sets the meshes (and remove the old ones).
     *
     * @param {array} lines The array of lines describing the whole path.
     * @param {object} initialPosition The position, in 3D, where thr whole
     * path begins (optional).
     */
    that.setMeshes = function(lines, initialPosition) {
        resetPathsMesh();
        var geometries = setGeometries(lines);
        that.lines = lines;
        that.initialPosition = { x : 0, y : 0, z : 0};

        that.meshG0Undone = new THREE.Line(geometries.G0,
                that.matG0Undone, THREE.LineSegments);
        that.meshG1Undone = new THREE.Line(geometries.G1,
                that.matG1Undone, THREE.LineSegments);
        that.meshG2G3Undone = new THREE.Line(geometries.G2G3,
                that.matG2G3Undone, THREE.LineSegments);
        that.meshG0Done = new THREE.Line(new THREE.Geometry(),
                that.matG0Done, THREE.LineSegments);
        that.meshG1Done = new THREE.Line(new THREE.Geometry(),
                that.matG1Done, THREE.LineSegments);
        that.meshG2G3Done = new THREE.Line(new THREE.Geometry(),
                that.matG2G3Done, THREE.LineSegments);

        that.meshDoing = new THREE.Line(new THREE.Geometry(),
                that.matDoing, THREE.LineSegments);

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
        that.add();
    };

    /**
     * Redoes the meshes as it was
     */
    that.redoMeshes = function() {
        if(that.meshG0Done.geometry.vertices.length > 0 ||
                that.meshG1Done.geometry.vertices.length > 0 ||
                that.meshG2G3Done.geometry.vertices.length > 0)
        {
            that.remove();
            that.setMeshes(that.lines, that.initialPosition);
            that.add();
        }
    };

    /**
     * Returns the path the animation has to follow.
     *
     * @return {array} The path the animation has to follow.
     */
    that.getPath = function() {
        var iG0 = 0, iG1 = 0, iG2G3 = 0;
        var iCommand = 0, iCurrent = 0, iEnd = 0;
        var command = {};
        var path = [], vertices = [];

        if(that.lines === undefined) {
            return [];
        }

        for(iCommand=0; iCommand < that.commandsUndoneManager.length; iCommand++) {
            command = that.commandsUndoneManager[iCommand];
            if(command.type === "G0") {
                iCurrent = iG0;
                vertices = that.meshG0Undone.geometry.vertices;
            } else if(command.type === "G1") {
                iCurrent = iG1;
                vertices = that.meshG1Undone.geometry.vertices;
            } else {
                iCurrent = iG2G3;
                vertices = that.meshG2G3Undone.geometry.vertices;
            }
            iEnd = iCurrent + command.numberVertices - 1;

            path.push({
                point : GCodeViewer.copyPoint(vertices[iCurrent]),
                type : command.type,
                lineNumber : command.lineNumber,
                commandNumber : iCommand,
                feedrate : command.feedrate
            });
            iCurrent++;
            while(iCurrent < iEnd) {
                path.push({
                    point : GCodeViewer.copyPoint(vertices[iCurrent]),
                    type : command.type,
                    lineNumber : command.lineNumber,
                    commandNumber : iCommand,
                    feedrate : command.feedrate
                });
                iCurrent += 2;
            }
            path.push({
                point : GCodeViewer.copyPoint(vertices[iCurrent]),
                type : command.type,
                lineNumber : command.lineNumber,
                commandNumber : iCommand,
                feedrate : command.feedrate
            });
            iCurrent++;

            if(command.type === "G0") {
               iG0 = iCurrent;
            } else if(command.type === "G1") {
               iG1 = iCurrent;
            } else {
               iG2G3 = iCurrent;
            }
        }

        return path;
    };

    //This is ridiculous not to manage to update the vertices
    //Change the selectionned mesh
    function changeMesh(vertices, type, done) {
        var mat = {}, pos = {};
        var geo = new THREE.Geometry();
        geo.vertices = vertices;

        if(done === true) {
            if(type === "G0") {
                mat = that.matG0Done;
                pos = that.meshG0Done.position.clone();
                that.scene.remove(that.meshG0Done);
                that.meshG0Done = new THREE.Line(geo, mat, THREE.LineSegments);
                that.meshG0Done.position.set(pos.x, pos.y, pos.z);
                that.scene.add(that.meshG0Done);
            } else if(type === "G1") {
                mat = that.matG1Done;
                pos = that.meshG1Done.position.clone();
                that.scene.remove(that.meshG1Done);
                that.meshG1Done = new THREE.Line(geo, mat, THREE.LineSegments);
                that.meshG1Done.position.set(pos.x, pos.y, pos.z);
                that.scene.add(that.meshG1Done);
            } else {
                mat = that.matG2G3Done;
                pos = that.meshG2G3Done.position.clone();
                that.scene.remove(that.meshG2G3Done);
                that.meshG2G3Done = new THREE.Line(geo, mat, THREE.LineSegments);
                that.meshG2G3Done.position.set(pos.x, pos.y, pos.z);
                that.scene.add(that.meshG2G3Done);
            }
        } else {
            if(type === "G0") {
                mat = that.matG0Undone;
                pos = that.meshG0Undone.position.clone();
                that.scene.remove(that.meshG0Undone);
                that.meshG0Undone = new THREE.Line(geo, mat, THREE.LineSegments);
                that.meshG0Undone.position.set(pos.x, pos.y, pos.z);
                that.scene.add(that.meshG0Undone);
            } else if(type === "G1") {
                mat = that.matG1Undone;
                pos = that.meshG1Undone.position.clone();
                that.scene.remove(that.meshG1Undone);
                that.meshG1Undone = new THREE.Line(geo, mat, THREE.LineSegments);
                that.meshG1Undone.position.set(pos.x, pos.y, pos.z);
                that.scene.add(that.meshG1Undone);
            } else {
                mat = that.matG2G3Undone;
                pos = that.meshG2G3Undone.position.clone();
                that.scene.remove(that.meshG2G3Undone);
                that.meshG2G3Undone = new THREE.Line(geo, mat, THREE.LineSegments);
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

        changeMesh(verticesDone, pointPath.type, true);

        that.commandsDoneManager.push({
            type : that.commandsUndoneManager[0].type,
            lineNumber : that.commandsUndoneManager[0].lineNumber,
            feedrate : that.commandsUndoneManager[0].feedrate,
            start : GCodeViewer.copyPoint(that.commandsUndoneManager[0].start),
            end : GCodeViewer.copyPoint(that.commandsUndoneManager[0].end),
            numberVertices : 2
        });
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

        changeMesh(verticesDone, pointPath.type, true);
        changeMesh(verticesUndone, pointPath.type, false);

        if(that.commandsUndoneManager[0].numberVertices > 2) {
            that.commandsUndoneManager[0].numberVertices -= 2;
        } else {
            that.commandsUndoneManager.splice(0, 1);
        }
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
        changeMesh(verticesDone, pointPath.type, true);
        changeMesh(verticesUndone, pointPath.type, false);

        return true;
    };

    // //Returns false if error else returns true
    // that.goToLine = function(lineNumber) {
    //     //NOTE: commandsUndoneManager and commandsDoneManager were creating
    //     //to ease and improve the way to generate meshes when the users wants
    //     //to go directly to a specific line.
    //     //To sum up the algorithm:
    //     //* find if need to increment or decrement
    //     //* extract for the undone (increment) or done (decrement) vertices
    //     //  according to numberVertices and push them to the other one mesh
    //     //* update commandsUndoneManager and commandsDoneManager
    // };

    /**
     * Highlights the currently executed line command.
     *
     * @param {number} The line number of the command.
     * @return {boolean} True if the command is displayed.
     */
    that.highlightCommand = function(lineNumber) {
        var i = 0;
        var meshes;
        var geometry, position;
        var addingGeometry, removingGeometry, numberVertices, vertices;

        if(lineNumber === that.currentLineNumber) {
            return true;
        }

        //Checking if the commands in this line are possibly displayed
        if(that.commandsUndoneManager.length === 0) {
            return false;
        }
        while(that.commandsUndoneManager[i].lineNumber !== lineNumber) {
            if(that.commandsUndoneManager[i].lineNumber > lineNumber) {
                return false;
            }
            if(i === that.commandsUndoneManager.length - 1) {
                return false;
            }
            i++;
        }
        that.currentLineNumber = lineNumber;

        //NOTE: At this point, that.commandsUndoneManager[0] corresponds to the
        //doing mesh

        //Put in done meshes the vertices of the doing mesh
        while(that.meshDoing.geometry.vertices.length > 0) {
            meshes = getMeshes(that.commandsUndoneManager[0].type);
            addingGeometry = meshes.done.geometry;
            removingGeometry = that.meshDoing.geometry;
            numberVertices = that.commandsUndoneManager[0].numberVertices;

            vertices = removingGeometry.vertices.splice(0, numberVertices);
            addingGeometry.vertices = addingGeometry.vertices.concat(vertices);
        }

        //Put from undone to done all the commands that are passed
        while(that.commandsUndoneManager[0] !== undefined &&
                that.commandsUndoneManager[0].lineNumber !== lineNumber) {
            meshes = getMeshes(that.commandsUndoneManager[0].type);
            addingGeometry = meshes.done.geometry;
            removingGeometry = meshes.undone.geometry;
            numberVertices = that.commandsUndoneManager[0].numberVertices;

            vertices = removingGeometry.vertices.splice(0, numberVertices);
            addingGeometry.vertices = addingGeometry.vertices.concat(vertices);

            that.commandsUndoneManager.splice(0, 1);
        }

        //Put the vertices in the doing of the currently executed commands and
        //remove the vertices in the undone meshes
        while(that.commandsUndoneManager[0] !== undefined &&
                that.commandsUndoneManager[0].lineNumber === lineNumber) {
            meshes = getMeshes(that.commandsUndoneManager[0].type);
            addingGeometry = that.meshDoing.geometry;
            removingGeometry = meshes.undone.geometry;
            numberVertices = that.commandsUndoneManager[0].numberVertices;

            vertices = removingGeometry.vertices.splice(0, numberVertices);
            addingGeometry.vertices = addingGeometry.vertices.concat(vertices);

            that.commandsUndoneManager.splice(0, 1);
        }

        //Updating meshes
        changeMesh(that.meshG0Undone.geometry.vertices, "G0", false);
        changeMesh(that.meshG1Undone.geometry.vertices, "G1", false);
        changeMesh(that.meshG2G3Undone.geometry.vertices, "G2G3", false);
        changeMesh(that.meshG0Done.geometry.vertices, "G0", true);
        changeMesh(that.meshG1Done.geometry.vertices, "G1", true);
        changeMesh(that.meshG2G3Done.geometry.vertices, "G2G3", true);

        that.scene.remove(that.meshDoing);
        geometry = new THREE.Geometry();
        geometry.vertices = that.meshDoing.geometry.vertices;
        position = that.meshDoing.position.clone();
        that.meshDoing = new THREE.Line(geometry, that.matDoing, THREE.LineSegments);
        that.meshDoing.position.set(position.x, position.y, position.z);
        that.scene.add(that.meshDoing);

        return true;
    };

    // initialize
    that.scene = scene;
    that.commandsUndoneManager = [];
    that.commandsDoneManager = [];

    that.currentLineNumber = -1;

    resetPathsMesh();
    that.matG0Undone = new THREE.LineBasicMaterial({ color : 0xff0000 });
    that.matG1Undone = new THREE.LineBasicMaterial({ color : 0x000ff });
    that.matG2G3Undone = new THREE.LineBasicMaterial({ color : 0x000ff });
    that.matG0Done = new THREE.LineBasicMaterial({ color : 0xff00ff });
    that.matG1Done = new THREE.LineBasicMaterial({color : 0xff00ff });
    that.matG2G3Done = new THREE.LineBasicMaterial({ color : 0xff00ff });

    that.matDoing = new THREE.LineBasicMaterial({ color : 0x00ffff });
};

module.exports = GCodeViewer;