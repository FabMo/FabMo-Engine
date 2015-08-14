/*jslint todo: true, browser: true, continue: true, white: true*/
/*global THREE, GCodeViewer, GCodeToGeometry*/

/**
 * Written by Alex Canales for ShopBotTools, Inc.
 */

/**
 * This file contains the class managing the animation of the bit.
 */

//refresFunction is the function to refresh the display/render the scene
//speeds are in inches by minutes (feedrate)
//path is the instance of the class Path
GCodeViewer.Animation = function(scene, refreshFunction, gui, path, normalSpeed,
        fastSpeed) {
    "use strict";
    var that = this;

    var lengthBit = 3;

    that.show = function() {
        that.scene.add(that.bit);
        that.refreshFunction();
    };

    that.hide = function() {
        that.scene.remove(that.bit);
        that.refreshFunction();
    };

    //If that.animating become private
    that.isAnimating = function() {
        return that.animating;
    };

    function getPositionBit() {
        return {
            x : that.bit.position.x,
            y : that.bit.position.y,
            z : that.bit.position.z - lengthBit / 2,
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
    function warnPath() {
        //TODO: use the methods from path class when it will be done
        var type = that.currentPath[that.iPath].type;
        if(type === "G0") {
            console.log("done G0 vertex");
        } else if(type === "G1") {
            console.log("done G1 vertex");
        } else if(type === "G2" || type === "G3") {
            console.log("done G2G3 vertex");
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
        //TODO: should be a while not if (else, jerk)
        if(GCodeViewer.samePosition(that.currentPath[that.iPath].point,
                    getPositionBit())) {
            that.iPath++;

            if(that.iPath >= that.currentPath.length) {
                that.animating = false;
                return false;
            }
            that.gui.highlight(that.currentPath[that.iPath].lineNumber);
            setCurrentSpeed();
        }
        return true;
    }

    function update() {
        var deltaTime = calculateDeltaTime(); //Must be here to update each time
        if(that.animating === false) {
            return;
        }

        warnPath();
        if(checkChangeIndexPath() === false) {
            return;
        }

        var move = deltaSpeed(getPositionBit(),
                that.currentPath[that.iPath].point,
                that.currentSpeed, deltaTime);
        moveBit(move);

        that.refreshFunction();
    }

    // returns true if start the animation; false if problem
    that.startAnimation = function() {
        that.currentPath = that.path.getPath();
        that.iPath = 0;
        if(that.currentPath.length === 0) {
            return false;
        }

        that.gui.highlight(that.currentPath[that.iPath].lineNumber);
        setPositionBit(that.currentPath[0].point);
        setCurrentSpeed();
        that.refreshFunction();
        that.animating = true;  //Must be at the end

        return true;
    };

    that.stopAnimation = function() {
        that.animating = false;
    };

    function createBit() {
        var geometry = new THREE.CylinderGeometry(0, 1, lengthBit, 32);
        var material = new THREE.MeshBasicMaterial({color: 0xffff00});
        that.bit = new THREE.Mesh(geometry, material);
        that.bit.rotateX(-Math.PI / 2);
        setPositionBit({ x : 0, y : 0, z : 0 });
    }

    //Speed are in inches by minutes. Internally converted it in inches by ms
    function setSpeeds(normalSpeed, fastSpeed) {
        that.normalSpeed = normalSpeed / 360000;
        that.fastSpeed = fastSpeed / 360000;
    }

    //initialize
    that.path = path;
    setSpeeds(normalSpeed, fastSpeed);
    that.scene = scene;
    that.refreshFunction = refreshFunction;
    that.gui = gui;
    createBit();

    that.path = path;

    that.animating = false;
    that.lastTime = new Date().getTime();
    setInterval(update, 41);  //41 = 240 FPS (not a vidya but below it is rough)
};
