/*jslint todo: true, browser: true, continue: true, white: true*/

/**
 * Written by Alex Canales for ShopBotTools, Inc.
 */

/**
 * This file contains the class managing the GUI.
 */

/**
 * Defines the different callback functions handled by the GUI.
 *
 * @typedef {object} GuiCallbacks
 * @property {function} showX - For showing YZ plane (from X perspective).
 * @property {function} showY - For showing XZ plane (from Y perspective).
 * @property {function} showZ - For showing XY plane (from Z perspective).
 * @property {function} displayInMm - For displaying units in millimeters.
 * @property {function} displayInIn - For displaying units in inches.
 * @property {function} perspective - For setting the camera in perpestive.
 * @property {function} orthographic - For setting the camera in orthographic.
 * @property {function} resume - For resuming the animation.
 * @property {function} pause - For pausing the animation.
 * @property {function} reset - For reseting the animation.
 * @property {function} goToLine - For going to the command line.
 */

// The width and the height is the dimension of the domElement (for some reason,
// when resizing the renderer, the domElement dimension is completly wrong on
// some operating system)
// callbacks are functions for the button
var Gui = function(renderer, width, height, configuration, callbacks,
        liveMode) {
    "use strict";
    var that = this;

    var highlightedElt = null;

    // Ids, classes and values according to the CSS.
    var idGCodeDisplayer = "gcode-displayer";
    var idGCodeContainer = "gcode-container";
    var idGCodeLines = "gcode-lines";
    var classGCodeLine = "gcode-line";
    var classHighlighted = "highlighted";
    var displayerWidthInPx = 200;
    var classWidget = "widget";
    var idToggle = "toggleGCode";
    var idLoading = "loadingMessage";

    var prefixIdLine = "gcode-line-number-";

    if(configuration === undefined) {
        configuration = {};
    }

    that.hideXButton = configuration.hideXButton || false;
    that.hideYButton = configuration.hideYButton || false;
    that.hideZButton = configuration.hideZButton || false;
    that.hideGCode = configuration.hideGCode || false;

    //Scroll the ul to the li having this line number.
    //elt is the li element in the ul
    //lineNumber is the lineNumber corresponding to this li
    function scrollTo(elt, lineNumber) {
        lineNumber--;
        that.widgets.gcodeContainer.scrollTop = elt.offsetHeight * lineNumber;
        that.widgets.gcodeContainer.scrollLeft = 0;
    }

    //Place a widget in the position
    function placeWidget(name, x, y) {
        that.widgets[name].style.left = x + "px";
        that.widgets[name].style.top = y + "px";
    }

    /**
     * Highlights the line at this line number.
     *
     * @param {number} lineNumber The number of the line to highlight.
     */
    that.highlight = function(lineNumber) {
        var elt = document.getElementById(prefixIdLine + lineNumber);
        if(elt === null || elt === highlightedElt) {
            return;
        }
        if(highlightedElt !== null) {
            highlightedElt.children[0].className = "";
            highlightedElt.children[1].className = "";
        }
        elt.children[0].className = classHighlighted;
        elt.children[1].className = classHighlighted;
        highlightedElt = elt;
        scrollTo(elt, lineNumber);
    };

    /**
     * Set the gui according to the current state of the animation (for example:
     * used not to have a pause button when the animation is already paused).
     *
     * @param {string} animationStatus "running" to set the gui for a running
     * animation.
     */
    that.setStatusAnimation = function(animationStatus) {
        if(animationStatus === "running") {
            that.widgets.resume.hidden = true;
            that.widgets.pause.hidden = false;
        } else {
            that.widgets.resume.hidden = false;
            that.widgets.pause.hidden = true;
        }
    };

    //Add an image widget, set it with the id and the position.
    function addWidget(id, x, y, src, hide) {
        var elt = document.createElement("img");
        elt.id = id;
        that.widgets[id] = elt;
        elt.src = src;
        elt.className = classWidget;
        if(hide) {
            elt.style.visibility = "hidden";
        }
        renderer.domElement.parentNode.appendChild(elt);
        placeWidget(id, x, y);
    }

    //Set the buttons for displaying the planes. X and Y for the first button
    function setAxesButtons(x, y, callbackX, callbackY, callbackZ) {
        addWidget("showX", x, y, "data:image/png;base64," + Gui.xImage,
                that.hideXButton);
        y += Gui.iconSize + that.margin;
        addWidget("showY", x, y, "data:image/png;base64," + Gui.yImage,
                that.hideYButton);
        y += Gui.iconSize + that.margin;
        addWidget("showZ", x, y, "data:image/png;base64," + Gui.zImage,
                that.hideZButton);

        that.widgets.showX.onclick = function(){
            callbackX();
        };
        that.widgets.showY.onclick = function(){
            callbackY();
        };
        that.widgets.showZ.onclick = function(){
            callbackZ();
        };
    }

    //Set the buttons for displaying size in millimeter or inch.
    function setUnitButtons(x, y, callbackIn, callbackMm) {
        addWidget("displayInIn", x, y,
                "data:image/png;base64," + Gui.inImage);
        addWidget("displayInMm", x, y,
                "data:image/png;base64," + Gui.mmImage);

        that.widgets.displayInIn.onclick = function(){
            callbackIn();
            that.widgets.displayInIn.hidden = true;
            that.widgets.displayInMm.hidden = false;
        };
        that.widgets.displayInMm.onclick = function(){
            callbackMm();
            that.widgets.displayInMm.hidden = true;
            that.widgets.displayInIn.hidden = false;
        };
        that.widgets.displayInIn.hidden = true;
    }

    //Set the buttons for setting the camera in perspective or orthographic mode.
    function setCameraButtons(x, y, callbackPers, callbackOrtho) {
        addWidget("perspective", x, y,
                "data:image/png;base64," + Gui.perspectiveImage);
        addWidget("orthographic", x, y,
                "data:image/png;base64," + Gui.orthographicImage);

        that.widgets.perspective.onclick = function(){
            callbackPers();
            that.widgets.perspective.hidden = true;
            that.widgets.orthographic.hidden = false;
        };
        that.widgets.orthographic.onclick = function(){
            callbackOrtho();
            that.widgets.orthographic.hidden = true;
            that.widgets.perspective.hidden = false;
        };
        that.widgets.perspective.hidden = true;
    }

    //Set the buttons for managing the animation.
    function setAnimationButtons(y, callResume, callPause, callReset) {
        var x = (width / 2) - 34;  //middle - size image - 5 / 2

        addWidget("resume", x, y,
                "data:image/png;base64," + Gui.resumeImage);
        addWidget("pause", x, y,
                "data:image/png;base64," + Gui.pauseImage);
        x += 37;
        addWidget("reset", x, y,
                "data:image/png;base64," + Gui.resetImage);

        that.widgets.resume.onclick = function(){
            callResume();
            that.widgets.resume.hidden = true;
            that.widgets.pause.hidden = false;
        };
        that.widgets.pause.onclick = function(){
            callPause();
            that.widgets.resume.hidden = false;
            that.widgets.pause.hidden = true;
        };
        that.widgets.pause.hidden = true;

        that.widgets.reset.onclick = function(){
            callReset();
            that.widgets.resume.hidden = false;
            that.widgets.pause.hidden = true;
        };
    }

    // Set the interface for displaying the gcode
    function setGCodeInterface(y) {
        var gcodeDisplayer = document.createElement("div");
        gcodeDisplayer.id = idGCodeDisplayer;
        if(that.hideGCode) {
            gcodeDisplayer.style.visibility = "hidden";
        }
        renderer.domElement.parentNode.appendChild(gcodeDisplayer);
        that.widgets[idGCodeDisplayer] = gcodeDisplayer;
        placeWidget(idGCodeDisplayer, ((width - displayerWidthInPx) / 2), y);

        var p = document.createElement("p");
        p.id = idToggle;
        p.innerHTML = "Toggle G-Code";
        gcodeDisplayer.appendChild(p);

        var gcodeContainer = document.createElement("div");
        gcodeContainer.id = idGCodeContainer;
        gcodeContainer.hidden = true;
        gcodeDisplayer.appendChild(gcodeContainer);

        var table = document.createElement("table");
        table.id = idGCodeLines;
        gcodeContainer.appendChild(table);

        p.onclick = function() {
            gcodeContainer.hidden = !gcodeContainer.hidden;
        };

        that.widgets.gcodeContainer = gcodeContainer;
        that.widgets.gcodeLines = table;
    }

    function callbackGoToLineFactory(lineNumber) {
        return function() {
            return that.cbGoToLine(lineNumber);
        };
    }

    /**
     * Set the GCode in the GUI.
     *
     * @param {array} gcode The array in the parsed gcode.
     */
    that.setGCode = function(gcode) {
        var i = 0;
        var tr, th, td;

        that.widgets.gcodeLines.innerHTML = "";
        for(i=0; i < gcode.length; i++) {
            th = document.createElement("th");
            th.innerHTML = i + 1;
            td = document.createElement("td");
            td.innerHTML = gcode[i];
            tr = document.createElement("tr");
            tr.appendChild(th);
            tr.appendChild(td);
            tr.className = classGCodeLine;
            tr.id = prefixIdLine + (i+1);
            that.widgets.gcodeLines.appendChild(tr);
            if(liveMode === false) {
                tr.onclick = callbackGoToLineFactory(i+1);
            }
        }

        //We do not care of the tr, just here for knowing the height
        if(tr !== undefined) {
            scrollTo(tr, 0);
        }
    };

    function createLoadingMessage() {
        var div = document.createElement("div");
        var p = document.createElement("p");
        p.innerHTML = "Loading file. Please wait.";
        div.appendChild(p);

        div.id = idLoading;
        renderer.domElement.parentNode.appendChild(div);

        //Stupid trick to set the correct width and height of the div:
        that.displayLoadingMessage();
        that.hideLoadingMessage();
    }

    function loadingMessageDisplayed() {
        var message = document.getElementById(idLoading);
        if(message === null) {
            return false;
        }
        return message.style.display !== "none";
    }

    // Show a message for the loading
    that.displayLoadingMessage = function() {
        var elt = document.getElementById(idLoading);
        elt.style.display = "inline-block"; //Put that before doing calculus
        var x = (width - elt.offsetWidth) / 2;
        var y = (height - elt.offsetHeight) / 2;
        elt.style.left = x + "px";
        elt.style.top = y + "px";
    };

    // Hide a message for the loading
    that.hideLoadingMessage = function() {
        if(loadingMessageDisplayed() === true) {
            document.getElementById(idLoading).style.display = "none";
        }
    };

    /**
     * To call when the canvas or container has resized
     */
    that.resized = function(newWidth, newHight) {
        var s = Gui.iconSize, m = that.margin;
        width = newWidth;
        height = newHight;

        var x = m, y = m;
        placeWidget("showX", x, y);
        placeWidget("showY", x, y + s + m);
        placeWidget("showZ", x, y + (s + m) * 2);

        x = m;
        y = height - m - s;
        placeWidget("displayInIn", x, y);
        placeWidget("displayInMm", x, y);

        x = width - m - s;
        y = height - m - s;
        placeWidget("perspective", x, y);
        placeWidget("orthographic", x, y);

        if(liveMode === false) {
            x = (width / 2) - s - m / 2;
            y = height - m - s;
            placeWidget("resume", x, y);
            placeWidget("pause", x, y);
            placeWidget("reset", (width / 2) + m / 2, y);
        }

        x = (width - displayerWidthInPx) / 2;
        y = m;
        placeWidget(idGCodeDisplayer, x, y);
    };

    //intialize
    that.widgets = {};

    //If not one of this, the positionning will not work correctly
    if(renderer.domElement.parentNode.style.position !== "absolute" &&
            renderer.domElement.parentNode.style.position !== "relative") {
        renderer.domElement.parentNode.style.position = "relative";
    }

    that.margin = 5; //margin between the icons

    var x = 5, y = 5;

    setAxesButtons(x, y, callbacks.showX, callbacks.showY, callbacks.showZ);


    y = height - Gui.iconSize - that.margin;
    setUnitButtons(x, y, callbacks.displayInIn, callbacks.displayInMm);

    x = width - Gui.iconSize - that.margin;
    setCameraButtons(x, y, callbacks.perspective, callbacks.orthographic);

    setGCodeInterface(5);
    if(liveMode === false) {
        that.cbGoToLine = callbacks.goToLine;

        y = height - Gui.iconSize - that.margin;
        setAnimationButtons(y, callbacks.resume, callbacks.pause,
                callbacks.reset);
    }

    createLoadingMessage();
};

Gui.iconSize = 32;

Gui.xImage = "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABHNCSVQICAgIfAhkiAAAAAlwSFlz%0AAAAKFgAAChYBipWYbQAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAANcSURB%0AVFiFvZdZSFVRFIa/c%2B7tJoalls2DJkllUTQgTTSR9FKZjVDZSEhE1EMPDVBZlllRPQQZSVehhx6C%0AijIlX5ooTCSKBhq1ycIoyiK7nqGHhZ179Ny8g7cfDpy9Nuz97bXWXntv5fkSxrhdnPSo9MBE4X9I%0AwfTpNGg%2BcpXXS6lK7sp4q1MF04g6gwnUNVKletz0sPVk5cOwWVEHUACPiyTV5vauvSFjGSw%2BCqor%0A6hCYKKrNsOIUJAyApFTI3Bp9AMACSB4HKRny3ykGpqyHLt3/E4CiwEovGDrozeD7CTFxsOhw1AHc%0AAqDCibli2XAR3j%2BEizvB1MUW1xPSpsr/o3Joagw8Yto0iEuCr2/h1d0gAQwdPr8Si/Ybmr5bbYCf%0AXyQnksfDjSI4m%2Bs8WkoGbKkUjx6e2u7k4J8DNpn2pqGBdyU0N0lupM92WEpnyCmW3XPtCLy4FSaA%0AEqAY1j%2BBK3ulP%2Bc0xMbb%2B7PyoW86fHwKl3YFNbkzAIBpOpqpKITaexDfD7ILLfvgCTBzs1TQ0nXQ%0A/CsCgEAeAHsoJq%2BTUHhiYZVXXF9RCC9vBz25M0B7qn8CV/IEdHkRLDkOvdKg/jFc3hPycKGFoEUV%0Ah6C2ChIHiicMDbyrxTORAwRxIhsaVB6z2reKBSgMhR4CkLjP2W21R82F2IQOAlAU2tSB1pq3T%2BL%2B%0A/qHsim59YGF4ZTt0D6ROhBmbJAwla%2BBMjsR%2B0hrnAhUWQKAk9N9y5QVQVy2Fp2yf9DsVqNAB/pGE%0A8w9AzyGyFcvyLXv5QYGJ7wfzCyIFCKDUiTB9o70YtcjQoHQtaD45K4ZnRgDglIQtrldUcX3tvbYj%0AvXsAV/dbBSomLkwAJ2UXOLu%2Btcry4U0NdE%2BGrP1BDe12tPonoeqCZ9fh%2BU0Z/F/VztCgaBEMGisH%0Ak%2BqSLbrgEJzbBI0NQQC0PowMHWrOB7UaQC4y/pcZRYX0TNhRA3e8cDlPrn0BAUwT%2Bo6QZOoIdUkE%0AxQ0J/eVWNXYxXNj%2Bd1HOHhg6Q76Olruz3Lj7j4b7FwDdAWDPyI6dNHEgbKuSUNRVQ8lq%2BP7JYkJp%0Ar/BHKNOEH5%2BhZBXUVtv7FEy3T6fBhJSoPYu/fYC8kW3Kuwn4dBrcmo/cukZOelwkRed5rrc1%2BT3P%0A/wBMuRZf6qpSxAAAAABJRU5ErkJggg%3D%3D%0A";
Gui.yImage = "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABHNCSVQICAgIfAhkiAAAAAlwSFlz%0AAAAKFgAAChYBipWYbQAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAALPSURB%0AVFiFvZddSJNRGMd/Z1tLE7WZCxULpYssU8oSK%2BgmyJs%2BKCjTpFQIkS4KIgurm4TuiiIT1Kt5FWSW%0AUlD0DRKCmERhhJa5iwy/LnIa2/Td6eIgc%2Bzd3Jbv/nDgeZ/zcJ4fz/l8xfBJiixmWqwm0pEI4iGB%0A9GpMLnipEz/L6ctJodjfaQLpM5xBAk4XfSarhfSAnqM3YcsBwwEEYDVjNwWUPSUDSiqh7A6YzIZD%0AIBGmAMfpNrBtAPsmKK03HgDwA%2BTsgtwSZa9KgH21kLQuTgBCQJUDfBpo8%2BCdg4RkOHHLcACLAjBB%0A8xHlOdcNv75A93WQmvIVHlZV%2Bf0VxgbDj5iVD5lbYd4Nn58uC6Aq4NNgakS1BQ%2B4Z5Q97VRRGXlQ%0A%2BxAuvIQ1ttCjJabC%2BecqNmPzssn9AEGSgZ%2BvbsNwD6zNUjsklMruqkU80guvw8SFBRA6h6H0gaMa%0APLOwpwp2HAuOKTgIe6vB%2B1fF%2BrQYAQCkDPZNjah1AVDRHLhDElOhskXZTxpgfCii5PoAehVY1Nsm%0AGHoPqZlQ0eT3l98DWzb8%2BADv7kecXB8gnKQPHDXgdkFxBRQdh8JDsPsMeOZU6aO8RyKfgkVNj0Ln%0AZWWfaobKVmU/ugQT36NKHgIgghu5pxUGX0DyerUzvr1RvhgU3RQsSkp4fMX/3XExfNWiAhCCoHNA%0AT26Xvv3fAHFW9IvQeID4PAvDAMRXsS9CwwDirNgXoWsC2spUc02EjrNlw9kHkGzX7bYEecJdRkvl%0AmYOPHcvHCRPkl8K1Aeh1wLNG9ewLCSAlZG1Tj9KVUFIaCIuqRGk97CyDrqsw0BkCQAjI26/aSsuy%0AWr0ts7fDpy5A0wG4UbCySdM2QkOfmgpnP7TXwMy4nwlh8J6TEmanoL0aRvsD%2BwTS4tWYlJBr2Pn3%0AZwwaC4J2lgS8GpOWBS91ThctVjN2Y37PdR6nS37P/wHP1Np37b4u3wAAAABJRU5ErkJggg%3D%3D%0A";
Gui.zImage = "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABHNCSVQICAgIfAhkiAAAAAlwSFlz%0AAAAKFgAAChYBipWYbQAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAL2SURB%0AVFiFvZdbSBRRGMd/M7valmleKc1ME0Izo0wzCF%2B6GAWVJF4yIosSkxB68CH1RcGHLlAvihmhQpJB%0AF4UIekioSMnEioKkyBRRiTXykmWr4/RwCFt3xp11d/3DMN98Z875fnPOmXO%2BI33OIclsotZXJhQV%0AiaWQhGpTsM7YKJS%2B5tIZHUDKXKEM6qzXGVSgf4JO2ddMqF1JRhXE7/M6gAT4mgiT7bo9YA2kHofs%0AayCbvA6BiiTbOU7UQdA6CIuF9BLvAwBzANHJEJMqbB8LpBWAX8gSAUgSnGyAWQWUabBNgsUfsq56%0AHcAsAGSoPiw8Ra0w%2BB5ay0FVhC9iM4THu9by8EcY%2BmAQYFaBkV7hmfkDU%2BNzzwApuXCwzDWAx1Xi%0AIwwBOEi1f%2Bx7DS/qnAdduwU27BS29Yvz9zUBJI3F8F2ruBbSqnAo7RL2qyZorzcEIGt6VVXTrSsf%0ACxS1QGAEDLyB2wWGqzoCaPWAMx2rhugdMP4Nqo%2BA7ZcbAK5q7wXYdVr8vjdz4MeAS9XdG4K4PZB5%0AWdjNxfDpmUvBdQAMDkHIejjbDLIZ2hvgea3LwXUADMhnORQ%2BgJWh0NsBTYWLakYbQJJwWAfml%2BfX%0AQ1QSjA3DjSyxeHkMwJkOlEJyDkxPQU0GjA4uOrg%2BgN4kTNgPhyqEfec89HW6FVwHQGcSrt4IZ5pF%0AovL0Ory85XZwHQANWfzh3ENYEQg9bXDPc8mKzl4wbwjyaiB8k7B/j0JetfOWrb3w5NIiALQUFjtn%0AbztqqAq9HW4AzJ%2BEreWup2eT38U9KBIyr8DdYpiwGgDQ2ox62lwLbteeDAnpUNYNHQ3wqFLsG7oA%0AqipSsDTjW%2BqC8gsGySx6Ir0EtmdDSyl039cBkCSI2y0uT8u8TOQOkVvhbQugaABUJHo2aHAUXOwU%0AQ9HfBY2nRN7wjwlpoYXfA1JV%2BDkCjfnQ12VfJqGabQpWFWK8diweG4LKRIc/SwVsClbzjI3C/glq%0AfU2Eeed4rji6/jue/wVU5dN0Vmb7TgAAAABJRU5ErkJggg%3D%3D%0A";
Gui.mmImage = "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABHNCSVQICAgIfAhkiAAAAAlwSFlz%0AAAAKFgAAChYBipWYbQAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAJOSURB%0AVFiF7ZdLaBNhFIW/mYYIVotCQkUt1ghVQbFqXbgSBDeuBJUK2deuFRVbXRTcCIIbF9WdID4KBQtF%0AEESxlr4CIq1QbW3TqNFKEltpEnGa5Lj4U2KSulFINnNgGObOPf85c%2B//YKzpVg54auj22vgQFpWA%0AhZwssYxDuxU%2Bw1hjHYcqIvwHBESWGLO9HnyVFgewAG8NfrtiZV8NwrKrJp6Ha8A14BrwAFDfBFv3%0Awete2HUUmo6Ak4aRe7DwCTxe2H8StuyBxJyJL/8sjNLQDBsbYKIfmk/AthZIJmD4LqQSsKYWWlrB%0AvwO%2BTkLoAeSyhhsNElbPOUmSnt2UfsxLUwNSelFaiklXd0pTL6Vv09KHQSnjSDND0llbasNcK7yx%0A%2B9L3j4bvpKXYjNQRkKJvpeiEFB6Vcjkp9EhqQ9EgYU9RPTbths6A%2BXrfduiahIuD8OoO9F0BCQ6e%0AhrYe2HscxvsL3Lp6WP4FHQHIZSBwGC4NweVRwx24bfKOnYdTN%2BDJNZiaKJkDfZ1GHCAehtkRU/7%2B%0ALiMOpk0Zx7SsFL0XjDjA7LBpVzJeEAcIPTT3PL%2B4AvPviwdMJYyRjFOIKQfpBVjnK89NxotjyQQs%0ARsvzANb7gdJVkF0uTpbKY%2BZFeehveauNCZA/A6u%2BDF0DZhJGQvD0emFzWMGbx7B2QznrxS34PF54%0Afve8fAKC2YjSi8WxXNZoRUIAWNEg4c21NP7HR/wzvqSYq3oLXAOuAdeAjbXayVIhWMh2ssSq4UCA%0AkyXmyTi0R5bo9tbgr8bv%2BW%2BGwiGU8EX/RAAAAABJRU5ErkJggg%3D%3D%0A";
Gui.inImage = "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABHNCSVQICAgIfAhkiAAAAAlwSFlz%0AAAAKFgAAChYBipWYbQAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAFxSURB%0AVFiF7ZcxS0JRFMd/972HDUU0KIRE6FAZDVESTRkEQbRbQVtC%2BAkkKvoEBo3u1djQFNRqi4M0VBAJ%0A5pBRFgRq0dPnazCw0OFC9h7G%2B0/3HM4958c9cA5X3C4zqakkXApuTARWSGDqBoWqTlRkV0j5epmy%0ApPA3mUCuSEpxabitLg4gAJeKR7Hs2VvJRCi2Ff%2BSA9BBALFzmFm3EWBwAvq8bQfQpCNjXqh82Agw%0AMgePN5C/qtveMegPQPoIRudhOARvr3B5Ag/X0mnlWxA5gGC4YQfDEDmEpT1Y24ehECxswHYa/NN/%0AANBKWhe4fbDph/gs7ASg9AyLWxYBABzFoPJeP5df4OIYBsYtAqhV4Snz01cqQI/8fvslgAFmrdkv%0A5PdbB03C/wogP4jOdiGTbNiZJJzGm%2BMySVBU6bTifpWstxuf9I02Kl/mzvYWOAAOgAOgIDBtqy4w%0AFd2gYAeBCegGBa2qE80VSbhUPHZ8zz8BsrxiWwdVOocAAAAASUVORK5CYII%3D%0A";
Gui.perspectiveImage = "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABHNCSVQICAgIfAhkiAAAAAlwSFlz%0AAAAKFgAAChYBipWYbQAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAQfSURB%0AVFiFvZd/TJR1HMdfDxw3Twq1AzE24XA4NVJLx1kbf6RZ0wzNwSaYM4lM/JGtWj%2BcbQG2fkJzKx1M%0AGoqiaUlmEhSjXNNIsLWFGAhxRwYLD9SCE70Dn/74yI7ruLvnOTff/3y35/l83u/383k%2Bz/fzfZS2%0AVcwzhFNsDCMaFYU7AQXVNYxjyEWuYsukwRJFyh0RHgUV6OynwWA0EK05S1EgdgZYrJBoldXlBHsj%0A2BrA3gCX/9RGBRjDiTEELHvUFI9QohUSUmD8RBh2w1%2B/QWcjRJhg9jJ47BVQwuDfHjHU2egx5uzz%0AVwZF6XoaW1wkFiJMYEkZJbgA7omXQMcfYDsjT2hrgIu/gvu6N9m4KEiYLxwWq6wj%2Bb0dtyo0Yuws%0AuAfpdmL3GEjJhOcOSUL7KWipkyTbGf9PEAxRsR4zsxbDtIflemkWNH5GtxN7mE%2BSsw%2Bip0F3M5z7%0AJnRxkNfRdAJ6WoVzoNcnxNfAm9Mlaf1heKEKzJbQDUyeDltrIHs/nP8O8u7TYODaFTiwAYoeAXMi%0A5J%2BHtDwwGLULR5gk560maeQPU6FsLfQ7fEINfknafoQdc2Hxy0L2wEqoyIWO%2BsDiMxfB6t0waSrU%0AvAfV78CQy2%2B4bwVGY9gN374PBbOhvwdeOw3Z5RBp9o2dGCf3XqqDnjYp99d5AcWDGxjBpXbY%2BTjs%0AWQXJSyDvHDy09haDAR59EfJbICkVPl4Gu9Kgr1MTtf9XMBZ%2B%2BRxaf4CMQli3F6xZMCEOpsyE2kKo%0Aehvcg7ooPRW4dlXWOWmBMwZ6Ye86%2BGgRxM8HVOmVY9uDi89d4a3lZaC5Bn4uh2f3y34fDBdOgqMd%0AWk/C3y3B4%2BOShfunMtHyMQDy%2BfVcgM1fgWlCcFKtGD8JNh6Tza1io9ctbwPu61CcLgnZ%2B2T63S7C%0AwiGnAsbdBSUZMHQjgAGAKxfFRPJSWLr99g2kfwAzFsLup%2BBql6%2B/MZPaT0Hl67A8H%2BY8Gbr4gjWy%0AkR3aIkNtDPjfB%2Bp2Qv0%2ByDkI987SLz71QVhTIjynP/UbFngjOrhJJllupcx7rYiKhc3HZdv%2B4tWA%0AoYENjDRlpFl7U4ZHwPNH4OYQ7MmUNWQDIGe80kzphSXbghvI%2BgTi58Gu5WPOf/0GAFq%2Bh8o3YMUO%0AuP8J/3ELt0DqeijPga4mTdTaDADUFkF9OeQcgMlJvveTUiGjCKoK4OwRzbTaDYA0paMDNh33bkpz%0AAuQeheZqOFGgi1KfAfcglKTD3TEyDVHAaIINR8F5GcqeAfWmLkp94xhkzpeuhq3VgCpH8RsD8K4V%0ABv/RTaevAiP4vRa%2B3CaHESVMPrdL7SFRGVBQQ8qsLZSntzfKiTcUKKgG1zAOFRJ1zz1VlXf%2Bv%2Bmm%0AOR1wDeMwDLnI7eyn2BhOjP7f89DER/%2Be/weIpWa3ouqgJAAAAABJRU5ErkJggg%3D%3D%0A";
Gui.orthographicImage = "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABHNCSVQICAgIfAhkiAAAAAlwSFlz%0AAAAKFgAAChYBipWYbQAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAQ0SURB%0AVFiFrZd/TJR1HMdf37vzjgjQSixBjf6oWa2bsDszlL/65RY0FRSWmqOV2PjD2iTwZnq2iUJZalrC%0Aai2VNRc617W1YrAVlXKWLiiE2fSoQRrLkIbpcXdPf3yO4HjuuOeZvrdn%2Bz7P9/P9/Pp%2BP%2B/v51Hn%0AS8mzWTlotzATDYUJKKsVAC0cNrMMFFowzGAoyAZ1sQx/TgZucxqAubmwtlHGh9fD72dNLdeAvn/w%0AW%2Bw2Zppa6UiDlW%2BDxw8Wqzwev3xzpBlWowC7lUybqbQ7C6FsP6Rnwokt0LIbtAgseRFK3gJXKRzd%0ACGeajenTUBZDgtNnQ/khqPRBfxd4H4Iv6yASEgfaG2HbfLjwPVR8KnJ3zjOkemoHlAUK1sMbPfDg%0AE/DROjhQBH/16WWHBqBhJRx4FuY4Yfs5eLpatmgqE/2ruZh1Ozm6mbkLYE0D3OuCbz%2BA5iq4Pmwo%0AKuypULgVntwkGTtSAQG/TmxghIA%2BA/ZUWLELPD%2BAzQF1%2BaLAqHGA4DU4XgO1LggHoeakBJOSoRON%0AzcCi52FFHWTMgmOvQeseiJis8cmwWOHxV6C4Hob/hOPVcOoQEC8Di8shPCpjVylkO2/OOIgOV6mM%0AIyF4bF2sfzFv4VG43As7XPLu8UPpXkhJN2/YngpFXtjcIVtZv1h0jwUY1wFNA6WE1eryoXkT5JfD%0A9h7IKzFu3FkI3m54qgq%2BqIWdbrhwCuJQjt6BMaFICFr3Ruv7pLH6nsgXAz8LX/i8EArKvFIICSdy%0AgGgGJmJoABpKxuvb262v73h8sb9QzxdKRYMch02XgckOjKHTB71t8MzrsGwHuMukPEM3pMRy3Ab4%0AQp%2BBSQ5EiLdP/%2BPGiNT3mWNitPo7%2Bd7fBbsWQeB04rVgNAMGrofAaahdCN5fAE3GkVDydSRzIN4Z%0ASIRICK78JlkzZBwDh3CqM3ArEGcL9FVgrisz6wG3PgNm5JNmQNNATX1/x0JLLhLjgCWJA2l3wbwF%0AkFdsTrEROAulx0ifNYUDLbvh736oaJZn%2BuybNzwjS3RV%2BuDqJWh5M2Y6tgx/%2Bgy6v4KlNbB0s9Cq%0Abxu0vRslKRNQCh5dC6vegdsyoG0fnPAImU2AnnVGr8sFUuuCP87Bqj1Q9Q1kPZzIkv7T3Q/Aq61Q%0A/jFc6ROWPLpRZzy%2BA2Po74L6aDuW/QhsOSutms0xLjPpQDEtRXqArZ2QszDalrmh78eEZmwJZ8YM%0AtDfKRVS2T27B3GJo2gA9rbGy9xfAmka4Zz50fg6fVApTJkHirjgenEXw3HswIxs6jsAdc6S0LvfC%0Akpdg%2BJJEHe35kmFghIANZaKYO33wazss3wkFFdLxoiT6r9%2BXQ/bvVcPqUGi2YJhBDe4zzGfXhqDp%0AZehoghcOyzZ9uFq6JhPQgGCYQXW%2BmFybnYN2K5lmf8%2BZ5lBENAgHzVHihN/z/wDatoOI6GwhGQAA%0AAABJRU5ErkJggg%3D%3D%0A";
Gui.resumeImage = "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABHNCSVQICAgIfAhkiAAAAAlwSFlz%0AAAAKFgAAChYBipWYbQAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAHVSURB%0AVFiFxZexSxtRHMc/73KNJbUaUYdYhyyKldChEHCxiFv/Ah1EcJFMqeJYgigOpVu3OHa0cwrtUNRV%0AKLa2oKhBswhydsrQcknudUiOBHnRe%2Bbu8p0e936P34fv98d7nDib46UZIR81GEIiCEMCadewqjYZ%0AcTHPQbKPdCiNWySBUpkDI2oyFHZzAAFEIwwbStuTaYjFg6eQCEO5kXoNW%2BcwvQwi2LFQAzgOPBmE%0AhW1Y24fRFyEDSKe5HpuGt99h7gM87gsJAHmryoTZLGyewNSir7G0j0Cl/gQsfYS1PRhJBQgg2wC4%0AGnsFucNGLE%2B7AADNWDYasYQO4Co%2B0ohlFxKTXQBwNT4DuR/asegN4X2KPGrEcuw5Fv8caFX8WT2W%0A1W%2BQeN4FAFcTs5D7WY%2Blp1cDwKn5AwD1WAaTEBtQbpvqU1L9WVdWET6twFGhbYka4KFD6KryF76%2B%0Ahy/voPLvzlI1QCczcFSAnSzcXHgq9w/AKsLOG/j1WetY5wAadvsPoGm3d4D7hvCBdnsHaOdAh3Z3%0ABuCD3RoALReRj3ZrADiB2O0d4Oo3rE/Cn8vAGjcBhOLivz4NvDEAAmnYNSyfnh4tScCuYZlVm0yp%0ATD4aYbgbv%2Bf/AR%2BUsmHnLqDQAAAAAElFTkSuQmCC%0A";
Gui.pauseImage = "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABHNCSVQICAgIfAhkiAAAAAlwSFlz%0AAAAKFgAAChYBipWYbQAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAD5SURB%0AVFiF7ZexagJBEIa/vVuusNBGi9jEYJlODIG0NkIeIIHkASx9gVS%2BgKUv4CMEbGyFSNpUIZErjMVV%0AKoSweGyKa07uVivPZj6YZth/52O6UZ8PtLTPKPCoYlEUgcKamGhn6KnFI/NGmZtCBqewQLhl7gWa%0AatHDARQQ%2BNR07tqbd0m5WK/gbbzfu32CyoU78zVLKo1F6dzH1124f3F/Fr5nBTp9uGy7M6%2BDrADg%0AuRPFIAIiIAIiIAIiIAIiIAIiIAL5d8HHBP427tR6le1Nh8cPkxzU8pnveomrQ5an4ueXhWdiInuG%0A4RYwMZHeGXrhllHgUzvHef4PFcVDiuVitGQAAAAASUVORK5CYII%3D%0A";
Gui.resetImage = "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABHNCSVQICAgIfAhkiAAAAAlwSFlz%0AAAAKFgAAChYBipWYbQAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAOdSURB%0AVFiFxZddaBRXFIC/mdlsYlI1xkRswkpIozFqghFDVCJWWRXiDyho1GhVUEgR0VbIg1UqviioeWuw%0ACi2CNX1QUV9ckgoaBDXiH7ixbdr8oSuaJsTEaHazs9OH03Td7m5m1t3qebln7t/57r3nnntGaa1k%0Ajk3jpF0lEwOFDyEKhk%2Bn2%2B%2BjWmnfQHPuOEo/iOF3xAA6B2hW7TYyEzpz0hhIGWfaTQHsGlm2uLdd%0A1cAxG6Y7odAJ%2BeVwuAiG%2Bs3HGii29zKaNhFKK8VoweeQOiHY1tMBL/%2BwPJVqqVdOUej3UD8ULoWS%0ANaHGAcZPBudXoFpb2%2BgAqgYrv4UD96F4VbBeH4ZT6%2BHhpfAxthRYVwv7m2FibhwAigrbzsCqQ7Ka%0AuZWh7fownK6ER5eDdQEdbtRBwA%2BOEqi5CZ/OeE%2BAdSegrEr0hmNwZnt4H79PdmIEousenNsFxxbC%0AYA%2Bk58AeF6RlxAhQsBiW7BHddRQu1MiKI8m/EFegpVHq2m7D8UXw9hVMcMCW0zEAqBpsqgNFgV%2Bv%0AwaX9UQeHQdx8x5DHDT99KXrJWpi2yCJAoRMmT5fzPLcLDMMcAMDvhZ7O0Lq79fD7ddGdX1sEKNsi%0A5ZNGePGbNeOjSWOtlMUrw69sRID8cinvnY/fOEBLg%2ByOokLePBOAlLGQMUX0p48SA%2BD3QtcD0R2z%0ATQA%2ByRTnA%2Bh7lhgAgDe9UtpTTQD83qBuS04cQCDwj7Xw8BwK8PaVeD9AhiNxAFmfSfnfWxIG4B0E%0Az2PR8xYkxnhqOkzKF/15iwkAQGuTlGVVQX%2BIR0o3gpYEg73QfscCQNP3EnxyimBWRXzGbcnyNAPc%0A/TnUx6ICeNzgvir6prqIwcOyVHwDk6bC8BD8UhuxS%2BTHqH63JB0ZU2BHfcTrYyrzvoCKA6K7jkL3%0AnzEA/NUGZ6vlKGYuh70N8qpZEVWDFQdh6w/iQ24XuI5E7a7tK2bvWDvpYS2ex9DbBcUrJLNZuBMU%0ADV62gvd1ZMMla2Hrj1C2WUJvaxN8t1qOIIIMDNOnPKuiPTuN3KiIM5fD5lPBEB3QxZs9bolwiipZ%0AT978YOJhBCSJuXwweh4BeAbpMAcASE6DZTVQvgPSs6P3C%2Bjw4CI0HIeO5lGnjA1gRFQNCpZA7lzI%0AngVJKWK0/wW03ZK3v89jaaoRgNj%2BCwK65AlPGmMaNpqoKFhMef4HUTBUn073xyAwAJ9Ot83vo7pz%0AgJN2jayP8Xv%2BN5BEH7zJLGnvAAAAAElFTkSuQmCC%0A";

exports.Gui = Gui;
