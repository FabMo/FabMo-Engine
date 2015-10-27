/*jslint todo: true, browser: true, continue: true, white: true*/
/*global THREE, GCodeViewer, GCodeToGeometry*/

/**
 * Written by Alex Canales for ShopBotTools, Inc.
 */

/**
 * This file contains the class managing the viewer. This is the class that the
 * user will instantiate. This is the main class.
 */

GCodeViewer.Viewer = function(container, widthCanvas, heightCanvas,
        callbackError, configuration) {
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
     * To call when the canvas or container has resized
     *
     * @param {number} width The width of the dom element renderer in px.
     * @param {number} The height of the dom element renderer in px.
     */
    that.resize = function(width, height) {
        that.renderer.setSize(width, height);
        that.camera.setSize(width, height);
        that.camera.updateProjectionMatrix();
        that.refreshDisplay();

        that.gui.resized();
    };

    /**
     * Changes the type of camera to a perspective camera.
     */
    that.setPerspectiveCamera = function() {
        that.camera.toPerspective();
        that.showZ();
    };

    /**
     * Changes the type of camera to an orthographic camera.
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
        that.camera = new THREE.CombinedCamera(width, height, fov, near,
                far, orthoNear, orthoFar);
        that.camera.up.set(0, 0, 1);

        that.controls = new THREE.OrbitControls(that.camera,
                that.renderer.domElement);
        that.controls.damping = 0.2;
        that.controls.addEventListener('change', render);
    }

    // Returns the center of the path (according to the setting of the initial
    // position). If there is no path, return (0; 0; 0).
    function centerPath() {
        var center = { x : 0, y : 0, z : 0 };
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
     */
    that.showX = function() {
        showPlane("x");
    };

    /**
     * Shows the plan XZ from the axe Y perspective.
     */
    that.showY = function() {
        showPlane("y");
    };

    /**
     * Shows the plan XY from the axe Z perspective.
     */
    that.showZ = function() {
        showPlane("z");
    };

    /**
     * Shows the axis helpers (refreshes the display).
     */
    that.showAxisHelper = function() {
        that.helpers.addAxisHelper();
        that.refreshDisplay();
    };

    /**
     * Hides the axis helpers (refreshes the display).
     */
    that.hideAxisHelper = function() {
        that.helpers.removeAxisHelper();
        that.refreshDisplay();
    };

    /**
     * Shows the arrow helpers (refreshes the display).
     */
    that.showArrows = function() {
        that.helper.addArrows();
        that.refreshDisplay();
    };

    /**
     * Hides the arrow helpers (refreshes the display).
     */
    that.hideArrows = function() {
        that.helper.removeArrows();
        that.refreshDisplay();
    };

    /**
     * Shows the arrow and axis helpers (refreshes the display).
     */
    that.showHelpers = function() {
        that.helper.addHelpers();
        that.refreshDisplay();
    };

    /**
     * Hides the arrow and axis helpers (refreshes the display).
     */
    that.hideHelpers = function() {
        that.helper.removeHelpers();
        that.refreshDisplay();
    };

    /**
     * Starts the animation of the path.
     */
    that.animatePath = function() {
        that.animation.show();
        that.animation.start();
    };

    /**
     * Shows the ghost of the board (if it was set in the configuration).
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
     */
    that.hideBoard = function() {
        that.scene.remove(that.boardObject);
        that.scene.remove(that.boardBox);
    };

    // Function created because web front end ecosystem is so awesome that we
    // cannot display an HTML element if the function is not over, during a
    // loop or whatever other reason
    function reallySetGCode(string) {
        that.gcode = GCodeToGeometry.parse(string);
        if(that.gcode.isComplete === false) {
            displayError(that.gcode.errorMessage);
            that.gui.hideLoadingMessage();
            return;
        }

        that.path.remove();  //Removing old stuff
        that.path.setMeshes(that.gcode.lines,
                that.cncConfiguration.initialPosition);
        that.refreshDisplay();  //To avoid confusion, we remove everything
        that.gui.setGCode(that.gcode.gcode);
        that.gui.hideLoadingMessage();
    }

    /**
     * Sets the GCode and displays the result.
     *
     * @param {string} The GCode.
     * @param {function} Callback function called when the meshes are created.
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

    /**
     * Hides the path.
     */
    that.hidePaths = function() {
        that.path.remove();
        that.refreshDisplay();
    };

    /**
     * Show the paths that the bit will take.
     */
    that.viewPaths = function() {
        if(that.gcode.size === false) {
            return;
        }

        that.path.remove();  //Don't know how to check if already in scene
        that.path.add();
        that.totalSize.setMeshes(that.gcode.size, that.inMm,
                that.cncConfiguration.initialPosition);

        var lx = ((that.gcode.size.max.x - that.gcode.size.min.x) / 2.0 ) || 0.0;
        var ly = ((that.gcode.size.max.y - that.gcode.size.min.y) / 2.0 ) || 0.0;
        var lz = ((that.gcode.size.max.z - that.gcode.size.min.z) / 2.0 ) || 0.0;

        that.light1.position.set(lx,ly,lz-10);
        that.light2.position.set(lx,ly,lz+10);

        that.totalSize.add();
        that.animation.hide();
        that.animation.reset();
        that.showZ();
        that.helpers.resize(that.gcode.size);
        that.refreshDisplay();
    };

    // Show the size in inch (if false) or millimeter (if true)
    function changeDisplay(inMm) {
        if(that.gcode.size !== undefined) {
            that.totalSize.setMeshes(that.gcode.size, inMm,
                that.cncConfiguration.initialPosition);
            that.totalSize.add();
        }
        that.refreshDisplay();
    }

    /**
     * Show the size in millimiter.
     */
    that.displayInMm = function() {
        changeDisplay(true);
    };

    /**
     * Show the size in inch.
     */
    that.displayInInch = function() {
        changeDisplay(false);
    };

    // initialize
    //Members declaration
    that.renderer = {};
    that.camera = {};
    that.scene = {};
    that.controls = {};
    that.cncConfiguration = configuration || {};
    that.gcode = {};

    that.inMm = false;
    that.inchToVector = 1; //Convert an inch to the value to put in vectors
    that.callbackError = callbackError;

    if(container === undefined || container === null) {
        displayError("No container set.");
        return;
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

    that.path = new GCodeViewer.Path(that.scene);
    that.totalSize = new GCodeViewer.TotalSize(that.scene);
    that.helpers = new GCodeViewer.Helpers(that.scene);
    that.showBoard();
    that.refreshDisplay();

    //Add the UI
    var resumeButtonFun = function () {
        if(that.animation.isStopped()) {
            that.animatePath();
        } else if(that.animation.isPaused()) {
            that.animation.resume();
        }
    };

    var goToLineFun = function(lineNumber) {
        that.animation.show();
        that.animation.goTo(lineNumber);
    };

    var callbacks = {
        showX : that.showX,
        showY : that.showY,
        showZ : that.showZ,
        displayInMm : that.displayInMm ,
        displayInIn : that.displayInInch ,
        perspective : that.setPerspectiveCamera,
        orthographic : that.setOrthographicCamera,
        resume : resumeButtonFun,
        pause : function() { that.animation.pause(); },
        reset : function() { that.animation.reset(); },
        goToLine : goToLineFun

    };
    that.gui = new GCodeViewer.Gui(that.renderer.domElement, that.cncConfiguration, callbacks);

    //Add animation
    that.animation = new GCodeViewer.Animation(that.scene, that.refreshDisplay,
            that.gui, that.path, 24, that.cncConfiguration.initialPosition);
};
