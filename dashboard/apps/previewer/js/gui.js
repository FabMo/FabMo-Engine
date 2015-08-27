/*jslint todo: true, browser: true, continue: true, white: true*/
/*global THREE, GParser, GCodeViewer, GCodeToGeometry, dat */

/**
 * Written by Alex Canales for ShopBotTools, Inc.
 */

/**
 * This file contains the class managing the GUI.
 */

//the domElement of the canvas, callbacks functions for the button
GCodeViewer.Gui = function(domElement, callbacks) {
    "use strict";
    var that = this;

    var highlightedElt = null;

    //elt is the li element in the ul
    //lineNumber is the lineNumber corresponding to this li
    function scrollTo(elt, lineNumber) {
        var height = elt.offsetHeight;
        lineNumber--;
        elt.parentNode.scrollTop = height * lineNumber;
        elt.parentNode.scrollLeft = 0;
    }

    //Place a widget in the position
    function placeWidget(name, x, y) {
        that.widgets[name].style.left = x + "px";
        that.widgets[name].style.top = y + "px";
    }

    that.highlight = function(lineNumber) {
        var elt = document.getElementById("li-" + lineNumber);
        if(elt === null || elt === highlightedElt) {
            return;
        }
        if(highlightedElt !== null) {
            highlightedElt.children[0].style.background = "#7f7f7f";
        }
        elt.children[0].style.background = "#ff0000";
        highlightedElt = elt;
        scrollTo(elt, lineNumber);
    };

    that.setStatusAnimation = function(animationStatus) {
        if(animationStatus === "running") {
            that.widgets.resume.hidden = true;
            that.widgets.pause.hidden = false;
        } else {
            that.widgets.resume.hidden = false;
            that.widgets.pause.hidden = true;
        }
    };

    function addWidget(id, x, y, src) {
        var elt = document.createElement("img");
        elt.id = id;
        that.widgets[id] = elt;
        elt.src = src;
        elt.style.cursor = "pointer";
        elt.style.position = "absolute";
        elt.style.zIndex = 2;
        domElement.parentNode.appendChild(elt);
        placeWidget(id, x, y);
    }

    //Set the buttons for displaying the planes. X and Y for the first button
    function setAxesButtons(x, y, callbackX, callbackY, callbackZ) {
        addWidget("showX", x, y, "data:image/png;base64," + GCodeViewer.xImage);
        y += GCodeViewer.iconSize + that.margin;
        addWidget("showY", x, y, "data:image/png;base64," + GCodeViewer.yImage);
        y += GCodeViewer.iconSize + that.margin;
        addWidget("showZ", x, y, "data:image/png;base64," + GCodeViewer.zImage);

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

    function setUnitButtons(x, y, callbackIn, callbackMm) {
        addWidget("displayInIn", x, y,
                "data:image/png;base64," + GCodeViewer.inImage);
        addWidget("displayInMm", x, y,
                "data:image/png;base64," + GCodeViewer.mmImage);

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

    function setCameraButtons(x, y, callbackPers, callbackOrtho) {
        addWidget("perspective", x, y,
                "data:image/png;base64," + GCodeViewer.perspectiveImage);
        addWidget("orthographic", x, y,
                "data:image/png;base64," + GCodeViewer.orthographicImage);

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

    function setAnimationButtons(y, callResume, callPause, callReset) {
        var x = (domElement.width / 2) - 34;  //middle - size image - 5 / 2

        addWidget("resume", x, y,
                "data:image/png;base64," + GCodeViewer.resumeImage);
        addWidget("pause", x, y,
                "data:image/png;base64," + GCodeViewer.pauseImage);
        x += 37;
        addWidget("reset", x, y,
                "data:image/png;base64," + GCodeViewer.resetImage);

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

    function setGCodeInterface(y) {
        var id = "divGCode";
        var div = document.createElement("div");
        var width = 200;
        div.id = id;
        div.style.position = "absolute";
        div.style.width = width + "px";
        div.style.zIndex = 2;
        div.style.background = "#7f7f7f";
        //Change text color?
        domElement.parentNode.appendChild(div);
        that.widgets[id] = div;
        placeWidget("divGCode", ((domElement.width - width) / 2), y);

        var p = document.createElement("p");
        p.style.width = "100%";
        p.style.cursor = "pointer";
        p.style.textAlign = "center";
        p.style.padding = "0px";
        p.style.margin = "0px";
        p.innerHTML = "Toggle GCode.";
        div.appendChild(p);

        var ul = document.createElement("ul");
        div.appendChild(ul);
        ul.hidden = true;
        ul.style.width = "100%";
        ul.style.background = "#7f7f7f";
        ul.style.maxHeight = "200px";
        ul.style.overflow = "auto";
        ul.style.padding = "0px";
        ul.style.margin = "0px";

        p.onclick = function() {
            ul.hidden = !ul.hidden;
        };

        that.widgets.listGCode = ul;
    }

    //This is ugly, find a way to do that in JavaScript/CSS if possible
    function lineFormat(line, numberLines) {
        var spaces = numberLines.toString().length - line.toString().length;
        var str = "";
        var i = 0;
        for(i = 0; i < spaces; i++) {
            str += " ";
        }
        return str + line + " | ";
    }

    //Weird stuff for JavaScript awesome hipstered awesomeness lolilol le meme
    // (sarcasm intended)
    function makeLiHandler(lineNumber) {
        return function() {
            return that.cbGoToLine(lineNumber);
        };
    }

    //gcode is the array in the parsed gcode
    that.setGCode = function(gcode) {
        var i = 0;
        var li, pre;
        that.widgets.listGCode.innerHTML = "";
        for(i=0; i < gcode.length; i++) {
            pre = document.createElement("pre");
            pre.style.margin = "0px";
            pre.style.padding = "0px";
            pre.style.background = "#7f7f7f";
            pre.innerHTML = lineFormat(i+1, gcode.length) + gcode[i];
            li = document.createElement("li");
            li.appendChild(pre);
            li.id = "li-"+(i+1);
            li.style.listStyleType = "none";
            li.style.background = "#7f7f7f";
            li.style.cursor = "pointer";
            that.widgets.listGCode.appendChild(li);
            li.onclick = makeLiHandler(i+1);
        }
        scrollTo(li, 0);
    };

    //To call when the canvas or container has resized
    that.resized = function() {
        var divGCode = document.getElementById("divGCode");
        var s = GCodeViewer.iconSize, m = that.margin;
        var w = domElement.width, h = domElement.height;

        var x = m, y = m;
        placeWidget("showX", x, y);
        placeWidget("showY", x, y + s + m);
        placeWidget("showZ", x, y + (s + m) * 2);

        x = m;
        y = h - m - s;
        placeWidget("displayInIn", x, y);
        placeWidget("displayInMm", x, y);

        x = w - m - s;
        y = h - m - s;
        placeWidget("perspective", x, y);
        placeWidget("orthographic", x, y);

        x = (w / 2) - s - m / 2;
        y = h - m - s;
        placeWidget("resume", x, y);
        placeWidget("pause", x, y);
        placeWidget("reset", (w / 2) + m / 2, y);

        x = (w - (parseInt(divGCode.style.width, 10))) / 2;
        y = m;
        placeWidget("divGCode", x, y);
    };

    //intialize
    that.widgets = {};

    //If not one of this, the positionning will not work correctly
    if(domElement.parentNode.style.position !== "absolute" &&
            domElement.parentNode.style.position !== "relative") {
        domElement.parentNode.style.position = "relative";
    }

    that.margin = 5; //margin between the icons

    var x = 5, y = 5;

    setAxesButtons(x, y, callbacks.showX, callbacks.showY, callbacks.showZ);

    y = domElement.height - GCodeViewer.iconSize - that.margin;
    setUnitButtons(x, y, callbacks.displayInIn, callbacks.displayInMm);

    x = domElement.width - GCodeViewer.iconSize - that.margin;
    setCameraButtons(x, y, callbacks.perspective, callbacks.orthographic);

    setGCodeInterface(5);
    that.cbGoToLine = callbacks.goToLine;

    y = domElement.height - GCodeViewer.iconSize - that.margin;
    setAnimationButtons(y, callbacks.resume, callbacks.pause, callbacks.reset);
};

GCodeViewer.iconSize = 32;

GCodeViewer.xImage = "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABHNCSVQICAgIfAhkiAAAAAlwSFlz%0AAAAB%2BgAAAfoBF4pEbwAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAARDSURB%0AVFiFvZdPTGJXFMY/HoyDVZ7KC22nkqjpQjFqY7TFlkRrNWMTM840aeKOkGiUJ0bjnwWulCpGE1cm%0AuugKDYjCZsZ/SceYLrQkOk0ZrItaSlupWDM1FtEKPh7QjRgGtQh1%2BHb33pPv/N457937Loem6RKh%0AUPgVSZJcJFEej8d/fHzcz6MoSqPRaF4SBBFKJgDLssTAwICGEAgEvMjke3t7/GQA8Hi8IEmS9wgA%0AnPDk5uZmhlQqVbjdbl4yIABwiMiRSqV6uL%2B//65cLq9OEgAuAXZ2dtK8Xm%2BKWCz%2B0%2BVyZZ2dnSXl%0ApbwsdX5%2B/j/b29sGtVpdMjIyshWe9/l8xOjoaAEATk5OzolCoXD%2Bl6Hdbn9rZmYmDwAqKipe1dXV%0A/XUrgJvE5/ODa2treaurqx9yuVxWJBJ9XV9f/%2Bqm%2BMbGxkdWq1XC5/N96%2Bvrk7H8iVgBAGA0Glco%0AijoKBAK81tbWL25qj1qt/sBqtUoAoLOzc7msrMxzJwAikYjRarXzAEIul%2BtBS0vLJ9ExW1tbgvHx%0A8c8BoLi4eCeyjf8bAABaW1t/r6mpeQEAs7OzVYuLi%2B9Ersvl8nqv15vK5/N9U1NTS7f1vTUAAMzN%0AzV22QqlUPgm3oqenp9RmsxUAQHd391JpaWnM0icEQFGUf2xs7CmHwwm5XK4Hzc3NMpvNJpicnHwI%0AACUlJTtarfbHeDzjAgAAhULhrK2tfQEAJpOpsqGhodHn86WmpqaeGQyGhXj94gYAXv8qnE6nGAB6%0AenqWi4qKTpMCQFGUv7q6%2BrLUeXl5fwwODm4n4pUQgMViyZqfn68Ij3d3d7PNZvN7SQFgWZajUCge%0AMwxznyRJj1Ao/DsYDBJdXV2PEjk/4gZQqVQf2e32XADo7%2B9fGB4efoaLDaqpqUn2RgEsFkuWTqer%0AAQCZTGbt7u62X2xQ3wOA2Wy%2BskHdGQDLshy5XP6YYZgUkiRP9Hr98/Ca0WhcEQqFR4FAgBu5QSUE%0AQBDXM9E0LXU4HLkAoFarl3Jzc73hNZFIxAwNDS3gohVKpfLjhAGuk8ViyZqenv4MAGQy2cu%2Bvr6f%0ArgH8raqq6gcAmJmZ%2BXR5efnthACCweBr44vSP2EYJkUgEJzo9fpvbjIzGAzPMzMzjwOBAI%2Bm6QaG%0AYWI%2BYMwApVIpdTgcOcDV0kcrOzv7XKvVPgMQcjqdYpqmpbH8Y/4RFRQUHA0MDJhJkjzv6ur6JVZ8%0AW1vbr36/3%2BB2u%2B%2BnpaX5w/Onp6fc9PT0QNwAvb29P8eKiVZnZ%2BcV0MrKyi/FYvGRXq//liRJ9kaA%0Ag4MDQUdHR1m8Sa9TZmbmOZfLDQHA4eFhhtVqlUgkkvc3NjZ0YrHYdy2ATqf77i6SR8tkMpWWl5dv%0AT0xMrISThwGScic0m81PCwsLo4/rEOHxePwsyyZ0Ksaj6OQsyxIej8fPaW9vL87IyNCQJHnvTUNE%0AKnw9/xdmGsVJKdWDkQAAAABJRU5ErkJggg%3D%3D%0A";
GCodeViewer.yImage = "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABHNCSVQICAgIfAhkiAAAAAlwSFlz%0AAAAB%2BgAAAfoBF4pEbwAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAANISURB%0AVFiF7ZfPSyNnHMafvBlt6epMNIorTsXFgyTQhVJ3FcHASrqnFvbQXqVBEDOO8SCIguhMA%2BofYEAU%0AIWCCrvGwlYVtu22KhyIRqbuLSwhtiQd/gmx1mhqdeTvppbOErK6J1elln9P7vvPwfD/zZX68r8Xr%0A9d4uLy//mmVZK0yUoija0dHRCGO322VZlp8RQjJmAlBKiSRJMiktLWWyi29tbb1vBgDDMDrLskUE%0AgMVYXF1d5Zqamr46PDxkzIAAYCHZs%2B7u7vs7Ozs329vb75kEgNcAiUTiRjqdLuZ5fnd7e7vs%2BPjY%0AlIfydasbGhr%2B2tjYCA8MDNweHx9/YaxPTk7e2t/f/4BhGH1wcDBOCDk76V/puo6xsTEHpZRUVVUd%0Ad3V1JfMCOE%2BKohRLkvQlAOzu7j6emJhYe5vf5/M1BgKBzwDA7/c/vCj/7bcDoL%2B/P9Hc3PwcAKam%0Apu4vLy%2BXn%2BeNxWK26enpTwGgpaXl%2BdDQUPw/AwBAJBJ5wnHckaZpxR6P5wGl1JLr0XUdHo/nc1VV%0A32NZ9s9wOPxtPtl5AfA8f%2BL3%2B5cAZJLJZK0gCHdzPaIo3onH4/UAMDw8vFRXV5e%2BMgAA6Onp%2Bb21%0AtXUdAILBoDsajdqNaysrK7aZmRk3ALhcrl/6%2Bvp%2BzTc3bwAAmJub%2B85msx1qmlbU0dHxQFVVkt16%0AjuOU2dnZ7wvJLAigpqbmdHR09BsAmc3NzQ87OzubBUG4m0gk6gFkZFleqq2tPSkks%2BBPrtfrTS4u%0ALq5Fo9E74XC4jRCiA0BbW9tab2/vb4XmFdQBQ/Pz80/tdvsrSimjqmpxWVnZH6FQ6IfLZF0KoLKy%0AUhUEIWrMRVH8sbq6%2BtQ0AACoqKhInzU2DeCq9A7gDYCLfrfXDmC23gDQdf3/BTBbl979ut3ufUmS%0AIsb4In8qlbKWlJT8fWUATqczNTIy8jJfv8vl%2BoLn%2BVehUOgnlmXpuQB7e3ulPp/vk8uCZctms51a%0ArdYMABwcHHDr6%2BsOh8NRH4vFgjzPn5wJEAwGf76K4rlaWFj4uLGxcSMQCDw1ihsAppwJI5HII6fT%0AmcpZzhBFUTRK6bW/DbnFKaVEURTNIoriRxzHySzLFl03RLaM4/k/sFU/3aF%2B8ScAAAAASUVORK5C%0AYII%3D%0A";
GCodeViewer.zImage = "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABHNCSVQICAgIfAhkiAAAAAlwSFlz%0AAAAB%2BgAAAfoBF4pEbwAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAANySURB%0AVFiFvZdfSFNxFMeP917XUne31FXEryEEG5OSLLkGkmBQzsg/kEv0YfgiIl4Ge9G95RJEEBQEH/RB%0AB5rUlpoSKgX6YEGbkDL2IhiBXaeC5bzp/uDdXS9N1tR2t9n9Pv3u4Zzz/fwuP%2B65v7SWlpaC7Ozs%0AFyRJ4iCiWJY92t/ff07k5ORYLBbLKoZhYTEBOI7DOjo6LJhMJiOizRmGkYoBQBAET5JkOgYAaZGg%0A0%2BmUFxcXN3q9XkIMCABIw6KfWltbH3k8nqsGg6FMJAA4BlhbW8v0%2B/0ShNDW5ubmJZ/PJ8qhPH7V%0AGo3m0O12vzSbzQXd3d2uSNzpdMrn5uZQMs0rKioYiqL2BQGcpenpaVVXV9fTZACCweAkRVGuf%2BXE%0ABcjNzfUjhDxCTT0ezxWe53EAAKVS6YuXHxfAZDKtm0ymdSHmbW1tt3t6emoAAEpKSlaF1GHxEoRq%0AdHT0em9v7xMAgLy8vO%2Bzs7PvhNSdC4DL5ZLRNK0PhUKETCb7NTk5aSdJkhMFwOv1EpWVlXUsy5IE%0AQXCDg4OvCgsLWaH1KQNUVVU93tjYQAAANE3P1tfXbyZSnxJAU1PTvaWlpTsAADqd7nNfX9%2BXRHsk%0ADTAyMqIaHh5%2BCACgVqu/TU1NvU%2BmT1IADodDQdN0Hc/zuEKh8M7MzLyRSqW8KAB7e3vptbW1z3w%2B%0AXyZBEEdDQ0M2jUZzmIx5wgA8z0N5eXk1wzDXACBsNpun9Xq94K9kygAGg%2BH%2B8vLyTQCA6urqj52d%0Ane5UzBMC6O/vvzE%2BPl4GAKDVar/abLbFVM1PBcCwk0wLCws57e3t%2BnA4jCmVyh/z8/N2iUSS1KGL%0ACxCrra2tCw0NDXWBQEAqkUiCVqv1tUqlCpyHOcAp05Dn/95YY2Pjg52dncsAADiOh5qbm2uENqco%0Aan1iYmIhIYBYsSx7MbL2%2B/0ZDMNkCAVACO3Gy4kLYDQaHTqdbk2oabTUarU3sj44OMCzsrJCCQP8%0AGS4JDZjTVFpaWosQ%2Bjk2NrYYPapPAGxvb8uMRuPdVA0BABQKRRDH8TAAwO7urnxlZUWr1WpvOBwO%0AK0IocCqA1Wr9dB7msbLZbIVFRUXugYGBDxHzCIAod0K73f42Pz//ICYcxliWPeI47tz%2BDc9SrDnH%0AcRjLskdpNE3fksvlFpIk0/83RLQi1/PfVxlGUjKPh5AAAAAASUVORK5CYII%3D%0A";
GCodeViewer.mmImage = "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABHNCSVQICAgIfAhkiAAAAAlwSFlz%0AAAAB%2BgAAAfoBF4pEbwAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAMSSURB%0AVFiF7VdPSNtQHP41idG0MbXJWHuZtBUZQyqO2cPECU5QEUWCeFNQYQdBFDyIoFgz8JBenKsMxqCF%0AeZ%2BXHsYKZWBh4ArKkLFLXOpk/mlta9bV2abJDq5brIztIHWwfrf38f3e7/u9j8fj6UZHR%2Btpmn5I%0AURQKRYQkSdnj42MXxjAMx3HcJoIgajENyLKMzM/Pc0hlZSVW7OYAABiGKRRFlSEAoCt2cw10yBU2%0ABwCAkoGSgZIBBAAgGAwyHMfVybKsW15etvf19d0fGBi4Fw6HjQAAqVQKnZ2ddbAs2zYxMXEnkUiU%0AaTdZXV21uN3um4qiwMLCwi2WZdtGRkbuCoKgBwCIRqP45OTkbZZl26anp%2BszmcyvwXme9w8PD78E%0AALWzs/MNSZJf7Ha7WF5efqLX678GAgFPTU2NyDDMkc1miyAIIlut1p1sNjuvqqpLVVVXvs7pdL4z%0AGo1Ju90uYhiWoWk6vra29shsNh9YLJaD6urqXQBQGhsbt1RVdfE87z8XQSQSuSaK4pIgCL5gMPj0%0A9PQU7%2B3tHXE4HDuHh4ePt7e3vXNzcy9EUbyxuLhYq61NpVIkjuO5/f39JUEQfF6v93k8Hjd1dHQ8%0A6O/vX9/b23sSiUSeDQ0NBcLhcJ3f7zf/jCAPjuOCDMNkAQCampoSVqt1N5fLoSsrK68R5Ew6MzPz%0AHkXR3MbGhqUwT5/P96qiokIBABgcHPxkMpmSJEmmPR5POK8ZHx/fAgAIhUIXDbS0tMS0a4qiTmia%0ATpAkmctzGIapBEGcJBIJvVZLEES6trY2reUMBkPaYrEcaTmbzZYGAIhGo4YLBgiCUAqGUjEMK%2BRA%0Ap7v4fv1Oh6JoTsvlT1JVzx7gf%2BMa/tcGMACA5ubmz7FYLITj%2BLkc29vbPySTyYrCou7u7vWGhoaD%0A/Lq1tfWjyWRKF%2Bq6uro2q6qqvmk5HMeVnp6e0I%2Be13U8z/unpqbeXt5Mfw%2B32%2B288ghKBkoGSgYQ%0AACj6t0wDFZEkKSvLctFPQpZlRJKkrG5sbMxhNBo5iqLK/lx2ech/z78DrDYvVP5MJBYAAAAASUVO%0ARK5CYII%3D%0A";
GCodeViewer.inImage = "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABHNCSVQICAgIfAhkiAAAAAlwSFlz%0AAAAB%2BgAAAfoBF4pEbwAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAHFSURB%0AVFiF7Zcxa2JBEIDn7W2ak7feUxJTHZx2krsm2ISLCyktRM7OTlIJYmkbNzYqBDm83vD8ATZBhLRG%0AizTBLqDNewdPDi7ggmnc97xKkKTZoKzkcLpZZme%2BnWVmGC2Xy30LBAKXhJAPoFA45/PpdHqBg8Eg%0AY4w9IIQWKgGEEKhUKjGk6zpWHRwAAGPsEUL2EABoqoOviIa2GBwAAHYA7wcgHA6fFwqF460B2LZ9%0A6DiOvmkALGs4Ho%2BvdF13Nw0gnQHTNL8MBgNjqXc6nYNyuRwFAGg0GpF0On2WzWZPut3u/lsApDPA%0AGPuRSqXuEonEHwCAZrMZbbfb33u93ud%2Bv38UCoX%2BOo6z32q1zkzTvM5kMr9l/K5VBa7r4slk8smy%0ArJ%2Bj0ag5HA5/%2BXy%2B50qlcirrY%2B0yrNfrt4ZhzAEAIpHIcywWe7Rt%2B1AJAELIi8fjT6tnhmHMZrPZ%0ARyUAmqZ5GONXk3SxkB%2Bu76cT/rcA0n0gmUwOKKXWUqeUWq7r9l/aUUotz/OkH6ZVq9WbYrF4L3th%0Ak1Kr1WJb/4IdwA5gB4AAQPlatiILxDmfCyGUZ0IIgTjncy2fz3/1%2B/2MELKnEmC5nv8DktidGDLf%0AVUMAAAAASUVORK5CYII%3D%0A";
GCodeViewer.perspectiveImage = "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABHNCSVQICAgIfAhkiAAAAAlwSFlz%0AAAAB%2BgAAAfoBF4pEbwAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAATjSURB%0AVFiFvVddSBtZFD6ZTn5Mybg2f2rY2o2EEHUbFFtJHwQffDCtDWqpTxVaGmhqfNBIiSElzcaIoFGw%0AEKHYJxEEkdKfh1BlkUWMuyvGxHa3EtfNBrLxZ9XMNKk1TpN92ZSsJmZi3f2eZuae%2Bb5vzpx77r00%0AjUZz8dy5c99hGHYG/kcQBHGA47gJ5XK5ZrPZvIQgSJzqy9FoFHE4HPz5%2BXkhk8n8VFNTE6yurt7J%0AxgBJksijR4/MKIfDQTOJu91uzvT0dH44HGYAAEQiEVQmk%2B0aDIa3CILAzMwM9%2BHDh2U4jjMBAPh8%0A/l5DQ4O/rKwsnI4TRdEYhmF0FABoyQPBYJDpcDiEfr%2Bf848Yncfj7d28edN/4cKFvVRkSqVyU6lU%0AbibuA4EA8/Xr18LJycmiZI4bN274xWJxMgcNTVxdu3atViKRbAsEgg9KpTJw%2B/Zt/3FZOQ4ikWj/%0A8PsLCwu54%2BPjRVtbW2yv18t99erVFAAAkggQi8U7NBotzuPxPsrl8vcnFU%2BHyspKvLCw8EMkEqGf%0AP38%2BlHj%2B2QCbzT4YGBhwCQSCj/fu3bvs9XrZpyW%2BtraW09bWVslisT49efLkRwzD9hNj6OFglUq1%0AfvXq1Y2%2Bvj5pPB4HvV7/DkGQw2GUEIvFoL%2B/X4rjOMNmsy0yGIzY4ZgjBgAAUBSNd3V1vXO73ZzW%0A1tbLjY2Na7W1tX9lI/78%2BfP8Fy9efNPZ2emRyWSRdHHHfppcLn8/PDz808rKCqbT6coJgkhpOBlb%0AW1uM9vb2imAwmPP06VPnceIAaTJwGFqtdm17e5tuMpkulpSU7KjVal%2BqOLvdLl5dXc01m80eDMNI%0AKtyUfy6Xyz0YHBxcFAgEHzUazb%2BKdHZ2Nu/%2B/fuXysvLdwYGBlxUxQEoZiAZKpVqva6ubtNsNpey%0A2Wxyd3eXKRKJwna7/edsuQCSMoDjOCscDlNakBgMRsxqtS7H43FoaWn5rb29fZWqIEEQaCgUYh0x%0A0NPT49LpdJVUiQAAWCzWp2zSDQDw4MGDCovFsnTEQF5e3sGdO3dWuru7ZdkQZgODwXCxpaXFy%2Bfz%0Ao0cMAABUVVWFhELh3ujo6NenLT4yMlIkkUhCV65c2U1%2BfmQWqNVq3/LyMtflcmGnJe50Or8KBAJn%0AUy1wKadhb2/vkt1uL6HSeDJhY2ODMTIyIjOZTL%2BkGk9pAEEQ6OnpWdTr9eVfIh6LxcBoNFYMDg6m%0AnaJpGxGfz4/eunXLa7VaT1yUHR0dFVqt9u1xM%2BXYTqhQKEICgeBERTk0NFSsUCjWM%2B0tMrZitVrt%0AW1pa4rndbg5V8ampKR5BEIzm5uY/M8VSWgv6%2Bvpcjx8/LqXSKX0%2BX87Lly%2BLjEbjr1S4KRlAEASs%0AVmvGoiRJktbd3S3v7%2B93UeGlbAAAQCgURpuamn63WCwl6WLa2toudXV1eVLtfL7YAABATU3NdkFB%0AQWRiYqLw8Fhvb6%2B0vr7eV1xc/CEbzqw3e3fv3v1jbm4u3%2BPxfC7KZ8%2Be5dPp9Fjy2eA/MwAAYLPZ%0AFoeGhkr39/fPeL3es06nM1%2Bn03lPwoUCAOUzYQIIgoDFYnFdv369/s2bN5tjY2M/nEQcAOIoQRAH%0AJEkiKIpSLhwAgIKCgn2bzfa9VCoNn2TbTpIkQhDEAU2r1X6bm5trxjCMnjXLFyBxPP8b4OzuAcjW%0AyZQAAAAASUVORK5CYII%3D%0A";
GCodeViewer.orthographicImage = "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABHNCSVQICAgIfAhkiAAAAAlwSFlz%0AAAAB%2BgAAAfoBF4pEbwAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAARFSURB%0AVFiF1VdNTCJnGP6YHx1/QCNJMdbYXQyrNq4NWknkYjgZuGFi5KwHF5BAQvyJKMygiT9hIB4EjSYe%0AvEg8GE5q4sVT665birI2Ndptt7Bl1WmXSaVahqEHQ%2BMCKiO7Tfoc53vneZ55v/f5Zoan1WqbKioq%0A7AKBAAb/IWiajkejURsiFAoJgiC%2BhyAoyZVkbW2tCgAAurq63nK9l2EYCMdxAuLz%2BQhX8bOzswKL%0AxfI0kUjwEARhjUZjSzgcLuTCgSAIKxAIUAQAwONyo9vtFh8fH5fZ7fb90tLSBAAAKJXK08nJyYaC%0AggLWYrH8wIGOB%2BVaGQgE%2BGazWSqVSn93Op3%2BlDgAAGAYxhIE8UqlUoXNZrN0d3e3PFde5L6Cy8tL%0AKPV0JEn676qVSqW0VCr1u91usdfrfXyzSw8ysL6%2BXrm5ufnF0NDQvlgs/us%2BsynodLqfQqEQZrVa%0Am2Qy2alGownfVpt1C1JDdnV1BS8sLOxyEU%2Bhurr60ul0%2BgsLCxMmk6n5tiHN6MD4%2BPiXFxcXCI7j%0AQQzDWK7C6VCr1RGlUnmK43hjSUkJMzY2dnhzPaMD5%2BfnRfF4HPb5fJX5iqewtbX1WTQaxSKRSEn6%0AWoaBoqKiOEmSfhRFkw/J901QFIWOjIw0xWIx2OPxPOfz%2BVfpNbcOYWdn528qlerd9PR0A4IgXPMN%0A3G63%2BOTkpIwgiDuTcOc5gGEYa7PZXikUiohOp2vNJd%2BBQICv1%2Btb6%2BvroyRJ%2BvOKYQpyufwPuVz%2B%0AwuPxPPb5fDVWqzVjQBmG4Tkcjicsy/Lm5uZe5MKbs4EUtFrt61AohFkslq9kMtm77u7utwAA4PP5%0AKjc2NmoGBgaCtbW1MS6cnAwAcJ1vkiT9q6urnxuNxhYAAGhra4vMz88/58r1IAMpaDSaMIIgLAzD%0ASbVaHXkoz4MNAAAAiqJJGIY5f0fcRM5vw0%2BF/7cBHo%2BXV/vzNgAAACyb3/sqwwDDMJ9sW7JxZ1yQ%0ASCTvTSZTM0VR6McSpigKNZlMzRKJ5H36WkYM%2B/r6fo7FYr9OTU01VFVVXTx79ux1PuLLy8s1BwcH%0AQhzH98vLy5n09aztLi4uTtjt9mBdXR3d29vb5vf7BdnqIOj23To8PCw1GAxfi0SiS6fT6c8mDsA9%0AB5FCoaDa29u/cTgcdV6v99HExMQBgiAfTH4ymfzgs55lWTAzM1NH03Shy%2BV6mV7PyQAA1085ODj4%0AYzAYLDWbzc0qlepNR0fHWbbanZ2dipWVlSdarfawpaWFvo8bAA4xbGxs/HN2dvbl0dGRQK/Xt9I0%0A/a/5WCwGDw8PN%2B3t7QmXlpa%2BzVUcgOsOcDpMDAbDCUVRb2w2WxMEQUkURdnt7e3q0dHRfZFI9DcX%0ALgBAEqFpOs4wDIQgSM4nilAojLtcru8WFxcfwTCc7Onp%2BYWjMGAYBqJpOs7r7%2B9/WlZWRggEgo%2BW%0A%2B1yQ%2Bj3/Bz6xvWimnAfzAAAAAElFTkSuQmCC%0A";
GCodeViewer.resumeImage = "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABHNCSVQICAgIfAhkiAAAAAlwSFlz%0AAAADWQAAA1kBmTMNQgAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAKmSURB%0AVFiFvZc/aBpRHMfvXk4oFp/XpFDbFI7eoIbYdvCWQNAEMrhEKdFNLYVajJgbApn1dE6WC7q4ubuY%0AMaW0kSItKUFog1IKIVJBsOijrbY%2BvSyFWI3/z/uO9%2B533w/f3/3e45Hb29tP5ufnIxDCOUJBIYSa%0AtVotRC0sLAiCIJwBACQlATDGIBwOC0Cj0VBKmxMEQVAU1YYQqgBBEGTnQiwWYyuVikohDhJ0P0kk%0AEhzLsjs8z5sbjUbPutzqMQAASAghKIriJsMwAUEQltvttnIAJHndkXK5fDccDrtYln2ZSCQYpQB6%0AfsiLi4uHPp/vhdFo9B4dHd2bKcCgicjn86zdbvevrKw8y%2BVympkA3JRApyRJIrPZ7FOO43i73b5R%0ALBZvyQow6p7QbDZV6XR6Va/X816vdxUhRMkCMCyBbtXrdXUymdxgGGaH53kzxpgcXjUAYNJdsVqt%0AakVR3GRZ1hePxx9NDDBuAt26vLx8EAgEnhuNRm8qlbo/NoBc50I%2Bn2edTucrjuNcmUzmzsgA0ybQ%0AKUmSyNPT0%2BW1tbXg%2Bvr65vn5%2Be2hALM4GVut1lypVKILhULP3tEzOnID6HS68u7u7vHe3l7hpvUe%0AALlaQNN01ePxnBwcHHyiKKrvN2VPQK1W/97a2np/eHiYhRDiYe/LloBKpfprs9k%2BxOPxk8XFxT%2Bj%0A1k2dAACgZbFYzkRRfGMymX6OUzstgGQ2m7/s7%2B%2B/tlqtP8Y17gswSgsMBsO3aDR67HK5vk9q3Bdg%0AUAI6na7s9/vfhkKhz9Ma9wW4KQGapmsej%2BfdsJGSHWDckZIFAAAgTTpSsgA4HI6vkUjk49LS0q9Z%0AGncC/NdTt9tdVML4nySAEGpijGd%2BA%2BoWxhgghJpkMBh8rNVqBQihUvdBgiCur%2BdXNNkFK5ayuaAA%0AAAAASUVORK5CYII%3D%0A";
GCodeViewer.pauseImage = "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABHNCSVQICAgIfAhkiAAAAAlwSFlz%0AAAADWQAAA1kBmTMNQgAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAEPSURB%0AVFiF7dexaoUwFAbgmOZuTQTdAtm69s53K76ATyBkFnwCl5oOvofg7OALSLc7ls7dAu7GuxRDb6dC%0ASU3bKdM54zF//CDTH5VleUyS5IkxdoMCjjFmW5blkaRpqpRSLxjja0iAtRY3TaMwpZSE/jlCCBFC%0APhhjB4IQityPXdeJaZqEL8w5v7Rt%2B/p9V9f1cZ7nW18myzItpdTOOiJ7h8dxvBuG4cF3mRBidgF9%0A35%2B01tyXWdf1eQeAsC8QagAAAAAAAAAAAAAAAAAAAOz2gjzP3yil774Q5/zi7oqiOP9VTHyAH7VM%0ASrnXYn4dt6j8c67YGLNZa4M/hbUWG2O2qKqq%2BziOFWPsEBLwVc8/AZLPYZwuE0NQAAAAAElFTkSu%0AQmCC%0A";
GCodeViewer.resetImage = "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABHNCSVQICAgIfAhkiAAAAAlwSFlz%0AAAADWQAAA1kBmTMNQgAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAUuSURB%0AVFiFvZddTFNnGMf/51DpWsrpKAP5aBuUAgJKDYSAlhU3PwNSZmYavkbicJk6iUaNu3Mw8UIjXknU%0Am2ZeSVNTs4UZIkadpW3InCOyDEj6pVu1MjraQ7rW4%2BF0Fw6DtNTyMZ%2Brc973ed7/L%2Be8z/s8L3Hw%0A4MESiUTyLUVRCXiHRtP0S7/f/w0vNTW1s7Ozc5gkyfC7BGBZluzo6Ogkk5OTeSspPjU1tcrtdvPf%0A5sfj8TiKolaRAIjlCDIMQxoMhqzW1taqdevWtaanp39ts9mS4gwneEsRtdvtwu7u7mKr1bp2bGws%0AJxQKCWbnUlJSfNXV1X/HuxYZj1NfX9/que%2BZmZkvLBZL7vDwcOFccQCYnp4WtbW1bQqFQnGtHdOJ%0AYRhSq9Vuqa%2Bv//LcuXMFs%2BNCoXDGYrEYlErl2PwYlmV5Op1up0Kh%2BMJqtb6/ZACWZQm1Wv2JwWDY%0AwnEcaTQai%2BfOC4XCmcHBQUNJSclrCIIgwlu3bv2ZJEnO7XZn7tq16/P%2B/v60JQHU1dXtHBoaKgGA%0A2tpa8507d76f7yMSiWbMZvNrCJlM9vT27ds/Xr16VScQCP6haZpqaGhocTgcgvmxMQEuX768pr%2B/%0AvwIANBrNYF9f34BQKJyJ5jsHYrysrMwOAC0tLX9ev379Oz6fH/L7/eK9e/dqFgJI2L59e5NKpXo6%0AO8AwDKnRaJoDgUBSfn6%2Bw2Qy3SCI2JmamJgYbm5uHisoKPBKpdIQAOTl5QVCoZDfZDIVeTyetOzs%0AbFdZWZlvbpzZbM6O%2BAKXLl1aOzEx8QFBEFxPT89NkoxrM4OiKLaiouINga6urpG8vDwXAFy8eHFT%0AtLiI1a9du1YCAIWFhY5t27ZNxqUew/bv328FgJGRkXyXyxWxFyIAxsfH5QCwY8eO35crDgAHDhyw%0AJyQksOFwmDAajdKYAM%2BePeP7fD4xAFRWVnpWAoCiKFYqlXoA4OHDhxkxAZxOpxD/1YbCwsLplQAA%0AAJFIFASAYDC4KiZAUlISO/scCARWrD%2BYrbYsy0b88jcGsrKyXhAEwQHA6OioeKUAnj9/ngIAMpnM%0AN3/uDYC0tDQmIyNjAgDu3bsnWwnxJ0%2BevDc5OSkBgI0bN/4VEwAA1q9f/xgABgYGNnAct2yAs2fP%0AbuA4LkEgEAS1Wq37rQBHjx79BUDY4/GsvnDhQv5yxGma5un1%2BkoA2Lx5828URbHzfSIAampqJoqL%0Ai20AcObMmdpoh0e8tm/fvg%2B9Xm8qj8djT506ZY3ms1Axusnn81/4fD5xTU3Np16vNyJ93mYnT55U%0AGo1GNQDs2bNnUK1WR%2B2SogJUVVVNnThxog9AeHR0VFFeXv7ZgwcP4soKhmHIhoaG6vPnz9cDIIqK%0Aimw6nc60kP%2BClaarq2vk2LFjP5AkyTmdTrlKpfqqsbFR/ejRo%2BSFhE%2BfPl2kUCja9Hr9R%2BFwmMzN%0AzX18//59vUgkilrKASBmU9rd3f2rXC6f7ujoqPP5fOLe3t6P9Xr9lpycHLdcLp%2BgKCrIcRzhcrnS%0AHA6HLBgMCoBXndHu3bvNvb29dxfqI%2BICAIAjR47Ympqaeg4dOqS6detWKU3TyU6nU%2BZ0OiPOCYIg%0AuNLS0tHjx49bGhsbI1JuSQDAqwPKYDDcZRjmpytXrqwZGhrKstls6QzD8EiS5CQSSaC8vPwPrVbr%0AUiqVi6ohi7oXJCYmcu3t7fb29nb7YuJiGQngnd4J51mYpGn6ZbQq9X8by7IkTdMvicOHD28Qi8Wd%0AFEUt%2BrBZjs1ez/8FTSsMx/kJ0skAAAAASUVORK5CYII%3D%0A";
