/*jslint todo: true, browser: true, continue: true, white: true*/

/**
 * Written by Alex Canales for ShopBotTools, Inc.
 */

var THREE = require("three");
require("./helvetiker_regular.typeface");  // It has to modify THREE
var gcodetogeometry = require("gcodetogeometry");
var util = require("./util");
var Path = require("./path").Path;
var TotalSize = require("./path").TotalSize;
var Helpers = require("./helpers").Helpers;
var Gui = require("./gui").Gui;
var Animation = require("./animation").Animation;
var CombinedCamera = require("./CombinedCamera").CombinedCamera;
var OrbitControls = require("./OrbitControls").OrbitControls;

/**
 * Defines the viewer class. This is the class that the user will instantiate.
 * This is the main class.
 *
 * @class
 * @param {DomElement} container - The container of the viewer.  Warning: style
 *   of the container: the position must be set as `absolute` or `relative`,
 *   else the position is automatically set to relative (this is needed for the
 *   GUI).
 * @param {number} widthCanvas - The width of the viewer.
 * @param {number} heightCanvas - The height of the viewer.
 * @param {function} [callbackError] - The callback function if an error
 *   occurs, should have one parameter: a string which will contain the error
 *   message.
 * @param {object} [configuration] - The configuration of the machine. If the
 *   board is set, a box representing the board will be displayed, the
 *   dimensions of the board are in inches.
 * @param {object} [configuration.board] - The dimension of the cut board.
 * @param {number} configuration.board.width - The width in inches.
 * @param {number} configuration.board.height - The height in inches.
 * @param {number} configuration.board.length - The length in inches.
 * @param {object} [configuration.initialPosition] - The initial position of
 *   the job. If not set, it will be consider as (0; 0; 0).
 * @param {number} configuration.initialPosition.x - The x position in inches.
 * @param {number} configuration.initialPosition.y - The y position in inches.
 * @param {number} configuration.initialPosition.z - The z position in inches.
 * @param {boolean} [liveMode=false] - The viewer mode. If set true, the viewer
 *   will be in live mode (this mode is explain below), else it is in normal
 *   mode.
 * @param {boolean} [inInch] - How the unit is displayed. If set true, the unit
 *   will be displayed in inch. If set false, the unit will be displayed in
 *   millimeters. If not set (undefined), the unit will automatically be
 *   displayed according to the G-Code commands.
 */
exports.Viewer = function(container, widthCanvas, heightCanvas,
        callbackError, configuration, liveMode, inInch) {
    "use strict";
    var that = this;

    //Updates the control and the possible animation
    function animate() {
        window.requestAnimationFrame(animate);
        that.controls.update();
    }

    //Renders the screen
    function render() {
        that.renderer.render(that.scene, that.camera);
    }

    /**
     * Refreshes the screen. To call each time something is change and should be
     * displayed.
     *
     * @function refreshDisplay
     * @memberof GCodeViewer.Viewer
     * @instance
     */
    that.refreshDisplay = function() {
        render();
        animate();
    };

    function displayError(message) {
        if(that.callbackError !== undefined) {
            that.callbackError(message);
        }
    }

    /**
     * To call when the canvas or container has resized.
     *
     * @param {number} width - The width of the dom element renderer in px.
     * @param {number} height - The height of the dom element renderer in px.
     *
     * @function resize
     * @memberof GCodeViewer.Viewer
     * @instance
     */
    that.resize = function(width, height) {
        that.renderer.setSize(width, height);
        that.camera.setSize(width, height);
        that.camera.updateProjectionMatrix();
        that.refreshDisplay();

        that.gui.resized(width, height);
    };

    /**
     * Changes the type of camera to a perspective camera.
     *
     * @function setPerspectiveCamera
     * @memberof GCodeViewer.Viewer
     * @instance
     */
    that.setPerspectiveCamera = function() {
        that.camera.toPerspective();
        that.showZ();
    };

    /**
     * Changes the type of camera to an orthographic camera.
     *
     * @function setOrthographicCamera
     * @memberof GCodeViewer.Viewer
     * @instance
     */
    that.setOrthographicCamera = function() {
        that.camera.toOrthographic();
        that.showZ();
    };

    function setCombinedCamera() {
        var width = that.renderer.domElement.width/2; // Camera frustum width.
        var height = that.renderer.domElement.height/2; // Camera frustum height.
        var fov = 75; // Camera frustum vertical field of view in perspective view.
        var near = 0.1; // Camera frustum near plane in perspective view.
        var far = 1000; // Camera frustum far plane in perspective view.
        var orthoNear = -100; // Camera frustum near plane in orthographic view.
        var orthoFar = 100; // Camera frustum far plane in orthographic view.
        that.camera = new CombinedCamera(width, height, fov, near,
                far, orthoNear, orthoFar);
        that.camera.up.set(0, 0, 1);

        that.controls = new OrbitControls(that.camera,
                that.renderer.domElement);
        that.controls.damping = 0.2;
        that.controls.addEventListener('change', render);
    }

    // Returns the center of the path (according to the setting of the initial
    // position). If there is no path, return (0; 0; 0).
    function centerPath() {
        var center = { x : 0, y : 0, z : 0 };

        //If no GCode given yet
        if(that.gcode.size === undefined) {
            return center;
        }
        var size = that.gcode.size;
        center.x = size.min.x + Math.abs(size.max.x - size.min.x) / 2;
        center.y = size.min.y + Math.abs(size.max.y - size.min.y) / 2;
        center.z = size.min.z + Math.abs(size.max.z - size.min.z) / 2;

        if(that.cncConfiguration.initialPosition !== undefined) {
            center.x += that.cncConfiguration.initialPosition.x;
            center.y += that.cncConfiguration.initialPosition.y;
            center.z += that.cncConfiguration.initialPosition.z;
        }
        return center;
    }

    // Makes the camera look at a point.
    // camPosition is the new position of the camera (the axe for (un)zoomming
    //   sould be be equal to 1)
    // dollyIn is the zoom value
    function lookAtPoint(point, camPosition, dollyIn) {
        var pos = that.controls.object.position;
        that.controls.reset();
        pos.set(camPosition.x, camPosition.y, camPosition.z);
        that.controls.target.set(point.x, point.y, point.z);
        that.controls.dollyIn(dollyIn);
        that.refreshDisplay();
    }

    // Shows the plane, crossAxe (string) is the axe normal to this plan
    //   (ex: "Z" for XY plan)
    function showPlane(crossAxe) {
        var zoom = 1;
        var center = centerPath();
        var cameraPosition = { x : center.x, y : center.y, z : center.z };
        if(crossAxe === "y") {
            cameraPosition[crossAxe] = center[crossAxe] - 1;
        } else {
            cameraPosition[crossAxe] = center[crossAxe] + 1;
        }

        //NOTE: using a magic number because a lot of issue trying to
        // calculate well the dollyIn. Someday, maybe, it will be done correctly
        if(that.camera.inPerspectiveMode === true) {
            zoom =  0.25;
        } else {
            zoom = 20;
        }
        lookAtPoint(center, cameraPosition, zoom);
    }

    /**
     * Shows the plan YZ from the axe X perspective.
     *
     * @function showX
     * @memberof GCodeViewer.Viewer
     * @instance
     */
    that.showX = function() {
        showPlane("x");
    };

    /**
     * Shows the plan XZ from the axe Y perspective.
     *
     * @function showY
     * @memberof GCodeViewer.Viewer
     * @instance
     */
    that.showY = function() {
        showPlane("y");
    };

    /**
     * Shows the plan XY from the axe Z perspective.
     *
     * @function showZ
     * @memberof GCodeViewer.Viewer
     * @instance
     */
    that.showZ = function() {
        showPlane("z");
    };

    /**
     * Shows the ghost of the board (if it was set in the configuration).
     *
     * @function showBoard
     * @memberof GCodeViewer.Viewer
     * @instance
     */
    that.showBoard = function() {
        if(that.cncConfiguration.board === undefined) {
            return;
        }
        var geometry = new THREE.BoxGeometry(
                that.cncConfiguration.board.width,
                that.cncConfiguration.board.length,
                that.cncConfiguration.board.height
                );

        var material = new THREE.MeshBasicMaterial(0xff0000);
        material.transparent = true;
        material.opacity = 0;
        var object = new THREE.Mesh(geometry, material);
        object.position.x = that.cncConfiguration.board.width / 2;
        object.position.y = that.cncConfiguration.board.length / 2;
        object.position.z = that.cncConfiguration.board.height / 2;
        var box = new THREE.BoxHelper(object);
        that.scene.add(object);
        that.scene.add(box);
        that.boardObject = object;
        that.boardHelper = box;
      
    };

    /**
     * Hides the ghost of the board.
     *
     * @function hideBoard
     * @memberof GCodeViewer.Viewer
     * @instance
     */
    that.hideBoard = function() {
        that.scene.remove(that.boardObject);
        that.scene.remove(that.boardBox);
    };

    // Function created because web front end ecosystem is so awesome that we
    // cannot display an HTML element if the function is not over, during a
    // loop or whatever other reason
    function reallySetGCode(string) {
        var lx = 0, ly = 0, lz = 0;
        var message = "";
        var gridSize;
        that.gcode = gcodetogeometry.parse(string);
        if(that.gcode.errorList.length > 0) {
            message = "Be careful, some issues appear in this file.";
            message += "\nThe machine may not do as displayed here.";
            displayError(message);
            that.gui.hideLoadingMessage();
        }

        that.path.setMeshes(that.gcode.lines,
                that.cncConfiguration.initialPosition);
        that.totalSize.setMeshes(that.gcode.size,
                that.gcode.displayInInch === false,
                that.cncConfiguration.initialPosition);

        that.helpers.resize(that.gcode.size);
        that.gui.setGCode(that.gcode.gcode);
        that.gui.hideLoadingMessage();
        if(liveMode === false) {
            that.animation.reset();
        }

        lx = ((that.gcode.size.max.x - that.gcode.size.min.x) / 2.0 ) || 0.0;
        ly = ((that.gcode.size.max.y - that.gcode.size.min.y) / 2.0 ) || 0.0;
        lz = ((that.gcode.size.max.z - that.gcode.size.min.z) / 2.0 ) || 0.0;

        that.light1.position.set(lx,ly,lz-10);
        that.light2.position.set(lx,ly,lz+10);
          console.log(that.gcode);
        if (lx !== 0 ){
            if (lx > ly){
                    gridSize = Math.ceil(lx*3);
            } else {
                gridSize = Math.ceil(ly*3);
            }
        } else {
            gridSize = 10;
        }
        that.helper = new THREE.GridHelper( gridSize, 1, 0xf2f2f2, 0xffffff );
        that.helper.rotation.x = Math.PI / 2;
        that.scene.add(that.helper);

        that.showZ();
        that.refreshDisplay();

        if(inInch === true) {
            that.displayInInch();
        } else if(inInch === false) {
            that.displayInMm();
        }
    }

    /**
     * Sets the GCode and displays the result.
     *
     * @function setGCode
     * @memberof GCodeViewer.Viewer
     * @instance
     * @param {string} The GCode.
     * @param {function} [callback] Callback function called when the meshes
     * are created (in case want to do something fancy).
     */
    that.setGCode = function(string, callback) {
        that.gui.displayLoadingMessage();
        var cb;
        if(callback === undefined) {
            cb = function() {
                reallySetGCode(string);
            };
        } else {
            cb = function() {
                reallySetGCode(string);
                callback();
            };
        }
        setTimeout(cb, 100);
    };

    // Show the size in inch (if false) or millimeter (if true)
    function changeDisplay(inMm) {
        if(that.gcode.size !== undefined) {
            that.totalSize.setMeshes(that.gcode.size, inMm,
                that.cncConfiguration.initialPosition);
        }
        that.refreshDisplay();
    }

    /**
     * Shows the size in millimiters.
     *
     * @function displayInMm
     * @memberof GCodeViewer.Viewer
     * @instance
     */
    that.displayInMm = function() {
        changeDisplay(true);
    };

    /**
     * Shows the size in inches.
     *
     * @function displayInInch
     * @memberof GCodeViewer.Viewer
     * @instance
     */
    that.displayInInch = function() {
        changeDisplay(false);
    };

    /**
     * Sets the currently executed line command.
     *
     * @function updateLiveViewer
     * @memberof GCodeViewer.Viewer
     * @instance
     * @param {number} lineNumber - The line number of the command.
     * @return {boolean} True if the command is displayed.
     */
    that.updateLiveViewer = function(lineNumber) {
        if(
            liveMode === true &&
            that.path.highlightCommand(lineNumber) === true
        ) {
            that.gui.highlight(lineNumber);
            that.refreshDisplay();
            return true;
        }

        return false;
    };

    // initialize

    //Members declaration
    that.renderer = {};
    that.camera = {};
    that.scene = {};
    that.controls = {};
    that.cncConfiguration = configuration || {};
    that.gcode = {};

    that.callbackError = callbackError;

    if(util.webGLEnabled() === false) {
        displayError("WebGL is not enable. Impossible to preview.");
        return;
    }

    if(container === undefined || container === null) {
        displayError("No container set.");
        return;
    }

    if(liveMode === undefined) {
        liveMode = false;
    }

    if(liveMode === true) {
        console.log("Live mode");
    } else {
        console.log("Viewer mode");
    }

    that.renderer = new THREE.WebGLRenderer({antialias: true});
    that.renderer.setSize(widthCanvas, heightCanvas);
    that.renderer.domElement.style.zIndex = 1;
    container.appendChild(that.renderer.domElement);

    that.renderer.setClearColor( 0xebebeb );
    that.renderer.setPixelRatio( window.devicePixelRatio );

    that.scene = new THREE.Scene();
    setCombinedCamera();
    that.showZ();

    that.light1 = new THREE.PointLight( 0xffffff, 1, 100 );
    that.light1.position.set( 0, 0, -10 );
    that.scene.add( that.light1 );

    that.light2 = new THREE.PointLight( 0xffffff, 1, 100 );
    that.light2.position.set( 0, 0, 10 );
   
    
   
    that.scene.add( that.light2 );

    that.path = new Path(that.scene);
    that.totalSize = new TotalSize(that.scene);
    that.helpers = new Helpers(that.scene);
    that.showBoard();
 
    that.refreshDisplay();

    //Add the UI
    var callbacks = {
        showX : that.showX,
        showY : that.showY,
        showZ : that.showZ,
        displayInMm : that.displayInMm ,
        displayInIn : that.displayInInch ,
        perspective : that.setPerspectiveCamera,
        orthographic : that.setOrthographicCamera,
        resume : function() { that.animation.resume(); },
        pause : function() { that.animation.pause(); },
        reset : function() { that.animation.reset(); },
        goToLine : function(lineNumber) { that.animation.goToLine(lineNumber); }

    };
    that.gui = new Gui(that.renderer, widthCanvas, heightCanvas,
            that.cncConfiguration, callbacks, liveMode);

    //Add animation
    if(liveMode === false) {
        that.animation = new Animation(that.scene,
                that.refreshDisplay, that.gui, that.path, 24,
                that.cncConfiguration.initialPosition);
    }
};
