/*jslint todo: true, browser: true, continue: true, white: true*/
/*global THREE, GCodeViewer, GCodeToGeometry*/

/**
 * Written by Alex Canales for ShopBotTools, Inc.
 */

/**
 * This file contains the class managing the animation of the bit.
 */

//refreshFunction is the function to refresh the display/render the scene
//path is the instance of the class Path
GCodeViewer.Animation = function(scene, refreshFunction, gui, path, fps,
        initialPosition) {
    "use strict";
    var that = this;

    var lengthBit = 1;
    var G0Feedrate = 120;

    /**
     * Shows the bit in the scene.
     */
    that.show = function() {
        that.scene.add(that.bit);
        that.refreshFunction();
    };

    /**
     * Hides the bit from the scene.
     */
    that.hide = function() {
        that.scene.remove(that.bit);
        that.refreshFunction();
    };

    //Get the real position of the tip of the bit.
    function getBitPosition() {
        return {
            x : that.bit.position.x,
            y : that.bit.position.y,
            z : that.bit.position.z - lengthBit / 2
        };
    }

    //Get the position of the tip of the bit according to the meshes of
    //the path class.
    function getBitTipPosition() {
        var pos = getBitPosition();
        return {
            x : pos.x - that.initialPosition.x,
            y : pos.y - that.initialPosition.y,
            z : pos.z - that.initialPosition.z
        };
    }

    function setBitPosition(point) {
        that.bit.position.set(point.x, point.y, point.z + lengthBit / 2);
    }

    function translateBit(vector) {
        var pos = getBitPosition();
        pos.x += vector.x;
        pos.y += vector.y;
        pos.z += vector.z;
        setBitPosition(pos);
    }

    //Used to have an smooth animation
    //Returns the time elapsed between each update.
    function calculateDeltaTime() {
        var newTime = new Date().getTime();
        var deltaTime = newTime - that.lastTime;
        that.lastTime = newTime;
        return deltaTime;
    }

    //Check if the animation is starting to animate a new path
    function isStartingPath() {
        if(that.iPath === 0) {
            return true;
        }
        var currentLine = that.currentPath[that.iPath].lineNumber;
        var previousLine = that.currentPath[that.iPath-1].lineNumber;

        return (currentLine !== previousLine);
    }

    //Check if the animation is ending the animation of a path
    function isEndingPath() {
        if(that.iPath === 0) {
            return false;
        }
        if(that.iPath === that.currentPath.length - 1) {
            return true;
        }
        var currentLine = that.currentPath[that.iPath].lineNumber;
        var nextLine = that.currentPath[that.iPath+1].lineNumber;

        return (currentLine !== nextLine);
    }

    //Warns the path class of the current position
    //changedIndex {bool}, if true, means that the point reached the current point
    function warnPath(changedIndex) {
        var pointPath = that.currentPath[that.iPath];
        if(changedIndex === false) {
            that.path.isReachingPoint(pointPath, getBitTipPosition());
        } else {
            if(isStartingPath() === true) {
                that.path.startPath(pointPath);
            } else if(isEndingPath() === true) {
                that.path.endPath(pointPath);
            } else {
                that.path.reachedIntermediate(pointPath);
            }
        }
    }

    function setCurrentSpeed() {
        //We use in/ms here and feedrate is in in/min
        var line = that.currentPath[that.iPath];
        if(line.type === "G0") {
            that.currentSpeed = G0Feedrate / 60000;
        } else {
            that.currentSpeed = that.currentPath[that.iPath].feedrate / 60000;
        }
    }

    //Check if need to change index of the path and do the appropriate operations
    //return true if continuing the animation, else false
    function checkChangeIndexPath() {
        //While instead of if because we can have commands that have same
        //start and end points
        while(that.iPath < that.currentPath.length &&
                GCodeViewer.samePosition(that.currentPath[that.iPath].point,
                    getBitTipPosition()) === true) {
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

    //deltaDistance : the distance to make
    //returns true if can continue animation
    function moveBit(deltaDistance) {
        var destination = that.currentPath[that.iPath].point;
        var position = getBitTipPosition();
        var translation = {
            x : destination.x - position.x,
            y : destination.y - position.y,
            z : destination.z - position.z
        };
        var distance2 = translation.x * translation.x;
        distance2 += translation.y * translation.y;
        distance2 += translation.z * translation.z;

        if(distance2 > deltaDistance * deltaDistance) {
            var length = Math.sqrt(distance2);
            translation.x = translation.x / length * deltaDistance;
            translation.y = translation.y / length * deltaDistance;
            translation.z = translation.z / length * deltaDistance;
            translateBit(translation);
            warnPath(false);
            return true;
        }

        setBitPosition(destination);
        if(checkChangeIndexPath() === false) {
            return false;
        }

        return moveBit(deltaDistance - Math.sqrt(distance2));
    }

    // Updates the position and do the logical for the animation.
    function update() {
        var deltaTime = calculateDeltaTime(); //Must be here to update each time
        if(that.isRunning() === false) {
            return;
        }

        moveBit(that.currentSpeed * deltaTime);

        that.refreshFunction();
    }

    /**
     * Returns if the animation is paused (ie: started but doing nothing).
     *
     * @return {boolean} True if the animation is paused.
     */
    that.isPaused = function() {
        return that.isInPause === true && that.animating === true;
    };

    /**
     * Returns if the animation is stopped (ie: not start).
     *
     * @return {boolean} True if the animation is stopped.
     */
    that.isStopped = function() {
        return that.isInPause === false && that.animating === false;
    };

    /**
     * Returns if the animation is running (ie: started but animating).
     *
     * @return {boolean} True if the animation is running.
     */
    that.isRunning = function() {
        return that.isInPause === false && that.animating === true;
    };

    /**
     * Starts the animation from the beginning of the path.
     *
     * @return {boolean} Returns true if start the animation; false if problem.
     */
    that.start = function() {
        that.currentPath = that.path.getPath();
        that.iPath = 0;
        if(that.currentPath.length === 0) {
            return false;
        }

        that.gui.highlight(that.currentPath[that.iPath].lineNumber);
        setBitPosition({
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
            if(that.currentPath[i].lineNumber === lineNumber) {
                return i;
            }
        }
        return -1;
    }

    /**
     * Starts the animation according to the command in the line number given
     * (the animation is paused).
     *
     * @param {number} lineNumber The line number of the command.
     * @return {boolean} Returns true if start the animation; false if problem.
     */
    that.goTo = function(lineNumber) {
        that.path.redoMeshes();
        that.stop();
        that.currentPath = that.path.getPath();
        var iLine = fineIndexPath(lineNumber);
        var pos = { x : 0, y : 0, z : 0 };
        var pointPath;

        if(iLine === -1) {
            return false;
        }

        for(that.iPath=0; that.iPath <= iLine; that.iPath++) {
            pointPath = that.currentPath[that.iPath];
            if(isStartingPath() === true) {
                that.path.startPath(pointPath);
            } else if(isEndingPath() === true) {
                that.path.endPath(pointPath);
            } else {
                that.path.reachedIntermediate(pointPath);
            }
        }

        pos = that.currentPath[that.iPath-1].point;
        pos.x += that.initialPosition.x;
        pos.y += that.initialPosition.y;
        pos.z += that.initialPosition.z;
        setBitPosition(pos);

        that.gui.highlight(that.currentPath[that.iPath].lineNumber);
        setCurrentSpeed();
        that.animating = true;
        that.isInPause = true;
        that.refreshFunction();

        return true;
    };

    /**
     * Pauses the animation.
     */
    that.pause = function() {
        if(that.isStopped() === false) {
            that.isInPause = true;
            that.gui.setStatusAnimation("pause");
        }
    };

    /**
     * Resumes the animation.
     */
    that.resume = function() {
        if(that.isStopped() === false) {
            that.isInPause = false;
            that.gui.setStatusAnimation("running");
        }
    };

    /**
     * Stops the animation.
     */
    that.stop = function() {
        that.isInPause = false;
        that.animating = false;
        that.gui.setStatusAnimation("stop");
    };

    /**
     * Resets the animation.
     */
    that.reset = function() {
        setBitPosition(that.initialPosition);
        that.path.redoMeshes();
        that.stop();
        that.refreshFunction();
    };

    function createBit() {
        var geometry = new THREE.CylinderGeometry(0, lengthBit / 5, lengthBit, 32);
        var material = new THREE.MeshLambertMaterial({color: 0xF07530, transparent: true, opacity: 0.5});
        that.bit = new THREE.Mesh(geometry, material);
        that.bit.rotateX(-Math.PI / 2);
        setBitPosition(that.initialPosition);
    }

    //initialize
    that.path = path;
    if(initialPosition === undefined) {
        that.initialPosition = { x : 0, y : 0, z : 0};
    } else {
        that.initialPosition = initialPosition;
    }
    that.scene = scene;
    that.refreshFunction = refreshFunction;
    that.gui = gui;
    createBit();

    that.stop();
    that.lastTime = new Date().getTime();
    setInterval(update, 1000 / fps);
};
