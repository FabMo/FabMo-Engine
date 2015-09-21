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
GCodeViewer.Animation = function(scene, refreshFunction, gui, path, fps,
        initialPosition) {
    "use strict";
    var that = this;

    var lengthBit = 1;

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
    function getPositionBit() {
        return {
            x : that.bit.position.x,
            y : that.bit.position.y,
            z : that.bit.position.z - lengthBit / 2
        };
    }

    //Get the position of the tip of the bit according to the meshes of
    //the path class.
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

    //Gives the move to do
    //speed is the speed in in/ms
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

    // Keep this function here in case but this function is useless for the moment
    // function hasReachedIntermediate() {
    //     return ((isStartingPath() || isEndingPath()) === false);
    // }

    //Warns the path class of the current position
    //changedIndex {bool}, if true, means that the point reached the current point
    function warnPath(changedIndex) {
        var pointPath = that.currentPath[that.iPath];
        if(changedIndex === false) {
            that.path.isReachingPoint(pointPath, getPositionBitRelative());
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
        that.currentSpeed = that.currentPath[that.iPath].feedrate / 60000;
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

    // Updates the position and do the logical for the animation.
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
        console.log("Finding: " + lineNumber);
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
        console.log("iLine = " + iLine);
        var pos = { x : 0, y : 0, z : 0 };
        var pointPath;

        if(iLine === -1) {
            return false;
        }

        that.iPath = 0;

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
        setPositionBit(pos);

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
        setPositionBit(that.initialPosition);
        that.path.redoMeshes();
        that.stop();
        that.refreshFunction();
    };

    function createBit() {
        var geometry = new THREE.CylinderGeometry(0, lengthBit / 3, lengthBit, 32);
        var material = new THREE.MeshBasicMaterial({color: 0x7f715a});
        that.bit = new THREE.Mesh(geometry, material);
        that.bit.rotateX(-Math.PI / 2);
        setPositionBit(that.initialPosition);
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
