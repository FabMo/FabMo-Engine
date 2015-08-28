/*jslint todo: true, browser: true, continue: true, white: true*/
/*global THREE, GCodeViewer, GCodeToGeometry*/

/**
 * Written by Alex Canales for ShopBotTools, Inc.
 */

/**
 * This file contains the class managing the animation of the bit.
 */

//refreshFunction is the function to refresh the display/render the scene
//speeds are in inches by minutes (feedrate)
//path is the instance of the class Path
GCodeViewer.Animation = function(scene, refreshFunction, gui, path, normalSpeed,
        fastSpeed, initialPosition) {
    "use strict";
    var that = this;

    var lengthBit = 1;

    that.show = function() {
        that.scene.add(that.bit);
        that.refreshFunction();
    };

    that.hide = function() {
        that.scene.remove(that.bit);
        that.refreshFunction();
    };

    function getPositionBit() {
        return {
            x : that.bit.position.x,
            y : that.bit.position.y,
            z : that.bit.position.z - lengthBit / 2
        };
    }

    function getPositionBitRelative() {
        var pos = getPositionBit();
        return {
            x : pos.x - that.initialPosition.x,
            y : pos.y - that.initialPosition.y,
            z : pos.z - that.initialPosition.z
        };
    }

    function setPositionBit(point) {
        that.bit.position.set(point.x, point.y, point.z + lengthBit / 2);
    }

    function moveBit(vector) {
        var pos = getPositionBit();
        pos.x += vector.x;
        pos.y += vector.y;
        pos.z += vector.z;
        setPositionBit(pos);
    }

    //Give the move to do
    function deltaSpeed(position, destination, speed, deltaTime) {
        speed = speed * deltaTime;
        var dX = destination.x - position.x;
        var dY = destination.y - position.y;
        var dZ = destination.z - position.z;
        var length = Math.sqrt(dX * dX + dY * dY + dZ * dZ);

        if(length === 0) {
            return { x : dX, y : dY, z : dZ };
        }

        var move = {
            x : dX / length * speed,
            y : dY / length * speed,
            z : dZ / length * speed
        };

        if(GCodeToGeometry.lengthVector3(move) > length) {
            return { x : dX, y : dY, z : dZ };
        }
        return move;
    }

    //Used to have an smooth animation
    function calculateDeltaTime() {
        var newTime = new Date().getTime();
        var deltaTime = newTime - that.lastTime;
        that.lastTime = newTime;
        return deltaTime;
    }

    //Warn the path class of the current position
    //forward {bool}, true if the bit goes forward (do the path chronologically)
    //changedIndex: if true, means that the point reached the current point
    function warnPath(changedIndex) {
        if(changedIndex === true) {
            that.path.reachedPoint(that.currentPath[that.iPath]);
        } else {
            that.path.isReachingPoint(that.currentPath[that.iPath],
                    getPositionBitRelative());
        }
    }

    function setCurrentSpeed() {
        var type = that.currentPath[that.iPath].type;
        if(type === "G0") {
            that.currentSpeed = that.fastSpeed;
        } else {
            that.currentSpeed = that.normalSpeed;
        }
    }

    //Check if need to change index of the path
    //return true if continuing the animation, else false
    function checkChangeIndexPath() {
        while(that.iPath < that.currentPath.length &&
                GCodeViewer.samePosition(that.currentPath[that.iPath].point,
                    getPositionBitRelative()) === true) {
            warnPath(true);
            that.iPath++;

            if(that.iPath >= that.currentPath.length) {
                that.animating = false;
                that.gui.setStatusAnimation("stop");
                return false;
            }
            that.gui.highlight(that.currentPath[that.iPath].lineNumber);
            setCurrentSpeed();
        }
        return true;
    }

    function update() {
        var deltaTime = calculateDeltaTime(); //Must be here to update each time
        if(that.isRunning() === false) {
            return;
        }

        if(checkChangeIndexPath() === false) {
            return;
        }

        var move = deltaSpeed(getPositionBitRelative(),
                that.currentPath[that.iPath].point,
                that.currentSpeed, deltaTime);
        moveBit(move);
        warnPath(false);

        that.refreshFunction();
    }

    that.isPaused = function() {
        return that.isInPause === true && that.animating === true;
    };

    that.isStopped = function() {
        return that.isInPause === false && that.animating === false;
    };

    that.isRunning = function() {
        return that.isInPause === false && that.animating === true;
    };

    // returns true if start the animation; false if problem
    that.start = function() {
        that.currentPath = that.path.getPath();
        that.iPath = 0;
        if(that.currentPath.length === 0) {
            return false;
        }

        that.gui.highlight(that.currentPath[that.iPath].lineNumber);
        setPositionBit({
            x : that.initialPosition.x + that.currentPath[0].point.x,
            y : that.initialPosition.y + that.currentPath[0].point.y,
            z : that.initialPosition.z + that.currentPath[0].point.z
        });
        setCurrentSpeed();
        that.refreshFunction();

        that.animating = true;  //Must be at the end
        that.isInPause = false;

        return true;
    };

    //Returns the index of the point in path associated to this lineNumber
    // returns -1 if nothing found
    function fineIndexPath(lineNumber) {
        var i = 0;
        for(i=0; i < that.currentPath.length; i++) {
            if(that.currentPath[i].lineNumber >= lineNumber) {
                return i;
            }
        }
        return -1;
    }

    //Go to the command in the line number
    //Returns false if lineNumber is wrong
    that.goTo = function(lineNumber) {
        that.path.redoMeshes();
        that.stop();
        that.currentPath = that.path.getPath();
        var iLine = fineIndexPath(lineNumber);
        var pos = { x : 0, y : 0, z : 0 };

        if(iLine === -1) {
            return false;
        }

        that.iPath = 0;

        for(that.iPath=0; that.iPath < iLine; that.iPath++) {
            that.path.isReachingPoint(that.currentPath[that.iPath],
                    that.currentPath[that.iPath].point);
            that.path.reachedPoint(that.currentPath[that.iPath]);
        }

        pos = that.currentPath[that.iPath].point;
        if(that.iPath > 0) {
            that.iPath++;
        }

        pos.x += that.initialPosition.x;
        pos.y += that.initialPosition.y;
        pos.z += that.initialPosition.z;
        setPositionBit(pos);

        that.gui.highlight(that.currentPath[that.iPath].lineNumber);
        setCurrentSpeed();
        that.animating = true;
        that.isInPause = true;
        that.refreshFunction();

        return true;
    };

    that.pause = function() {
        if(that.isStopped() === false) {
            that.isInPause = true;
            that.gui.setStatusAnimation("pause");
        }
    };

    that.resume = function() {
        if(that.isStopped() === false) {
            that.isInPause = false;
            that.gui.setStatusAnimation("running");
        }
    };

    that.stop = function() {
        that.isInPause = false;
        that.animating = false;
        that.gui.setStatusAnimation("stop");
    };

    that.reset = function() {
        setPositionBit(that.initialPosition);
        that.path.redoMeshes();
        that.stop();
        that.refreshFunction();
    };

    function createBit() {
        var geometry = new THREE.CylinderGeometry(0, lengthBit / 3, lengthBit, 32);
        var material = new THREE.MeshBasicMaterial({color: 0xffff00});
        that.bit = new THREE.Mesh(geometry, material);
        that.bit.rotateX(-Math.PI / 2);
        setPositionBit(that.initialPosition);
    }

    //Speed are in inches by minutes. Internally converted it in inches by ms
    function setSpeeds(normalSpeed, fastSpeed) {
        that.normalSpeed = normalSpeed / 360000;
        that.fastSpeed = fastSpeed / 360000;
    }

    //initialize
    that.path = path;
    if(initialPosition === undefined) {
        that.initialPosition = { x : 0, y : 0, z : 0};
    } else {
        that.initialPosition = initialPosition;
    }
    setSpeeds(normalSpeed, fastSpeed);
    that.scene = scene;
    that.refreshFunction = refreshFunction;
    that.gui = gui;
    createBit();

    that.stop();
    that.lastTime = new Date().getTime();
    setInterval(update, 41);  //41 = 240 FPS (not a vidya but below it is rough)
};
