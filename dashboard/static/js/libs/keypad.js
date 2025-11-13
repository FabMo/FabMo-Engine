/* eslint-disable no-undef */
/* eslint-disable no-unused-vars */
(function (root, factory) {
    /* CommonJS */
    if (typeof module == "object" && module.exports) module.exports = factory();
    /* AMD module */
    /* Browser global */ else root.WheelControl = factory(Hammer, $);
})(this, function (Hammer) {
    "use strict";

    var Keypad = function (id, options) {
        this.id = id;
        this.elem = $(id);
        //this.elem.attr('tabindex', 0) // For keyboard
        this.setOptions(options);
        this.init();
        this.move = null;
        this.going = false;
        this.interval = null;
        this.enabled = false;
        this.listeners = { go: [], stop: [], nudge: [], exit: [], enter: [] };
        this.pressThreshold = 50;
        this.pressTime = 150;
        this.tapInterval = 150;
        this.target = null;
        this.slideOffDetected = false; // Track slide-off state
    };


    /* Potentially useful for future Keypad debugging !
    function mobileDebug(message) {
        // Create or get existing debug console
        let debugConsole = document.getElementById('mobile-debug-console');
        
        if (!debugConsole) {
            // Create the debug console container
            debugConsole = document.createElement('div');
            debugConsole.id = 'mobile-debug-console';
            debugConsole.style.cssText = `
                position: fixed; 
                top: 10px; 
                right: 10px; 
                width: 280px; 
                max-height: 400px;
                background: rgba(0, 0, 0, 0.9); 
                color: #00ff00; 
                padding: 10px; 
                z-index: 10000; 
                font-family: monospace;
                font-size: 11px; 
                border: 2px solid #333;
                border-radius: 5px;
                overflow-y: auto;
                overflow-x: hidden;
                word-wrap: break-word;
            `;
            
            // Create header with close button and clear button
            const header = document.createElement('div');
            header.style.cssText = `
                background: #333; 
                margin: -10px -10px 10px -10px; 
                padding: 5px 10px; 
                border-radius: 3px 3px 0 0;
                display: flex;
                justify-content: space-between;
                align-items: center;
            `;
            
            const title = document.createElement('span');
            title.textContent = 'Mobile Debug Log';
            title.style.fontWeight = 'bold';
            
            const buttons = document.createElement('div');
            
            // Clear button
            const clearBtn = document.createElement('button');
            clearBtn.textContent = 'Clear';
            clearBtn.style.cssText = `
                background: #666; 
                color: white; 
                border: none; 
                padding: 2px 6px; 
                margin-right: 5px;
                border-radius: 3px;
                font-size: 10px;
                cursor: pointer;
            `;
            clearBtn.onclick = function() {
                const logContent = debugConsole.querySelector('#debug-log-content');
                logContent.innerHTML = '';
            };
            
            // Close button
            const closeBtn = document.createElement('button');
            closeBtn.textContent = '×';
            closeBtn.style.cssText = `
                background: #ff4444; 
                color: white; 
                border: none; 
                padding: 2px 8px; 
                border-radius: 3px;
                font-weight: bold;
                cursor: pointer;
            `;
            closeBtn.onclick = function() {
                document.body.removeChild(debugConsole);
            };
            
            buttons.appendChild(clearBtn);
            buttons.appendChild(closeBtn);
            header.appendChild(title);
            header.appendChild(buttons);
            
            // Create scrollable content area
            const logContent = document.createElement('div');
            logContent.id = 'debug-log-content';
            logContent.style.cssText = `
                max-height: 350px;
                overflow-y: auto;
                line-height: 1.3;
            `;
            
            debugConsole.appendChild(header);
            debugConsole.appendChild(logContent);
            document.body.appendChild(debugConsole);
            
            // Make it draggable
            let isDragging = false;
            let startX, startY, startLeft, startTop;
            
            header.addEventListener('mousedown', function(e) {
                if (e.target === clearBtn || e.target === closeBtn) return;
                isDragging = true;
                startX = e.clientX;
                startY = e.clientY;
                const rect = debugConsole.getBoundingClientRect();
                startLeft = rect.left;
                startTop = rect.top;
                
                function handleMouseMove(e) {
                    if (!isDragging) return;
                    const deltaX = e.clientX - startX;
                    const deltaY = e.clientY - startY;
                    debugConsole.style.left = (startLeft + deltaX) + 'px';
                    debugConsole.style.top = (startTop + deltaY) + 'px';
                    debugConsole.style.right = 'auto';
                }
                
                function handleMouseUp() {
                    isDragging = false;
                    document.removeEventListener('mousemove', handleMouseMove);
                    document.removeEventListener('mouseup', handleMouseUp);
                }
                
                document.addEventListener('mousemove', handleMouseMove);
                document.addEventListener('mouseup', handleMouseUp);
            });
            
            // Touch support for dragging
            header.addEventListener('touchstart', function(e) {
                if (e.target === clearBtn || e.target === closeBtn) return;
                const touch = e.touches[0];
                const mouseEvent = new MouseEvent('mousedown', {
                    clientX: touch.clientX,
                    clientY: touch.clientY
                });
                header.dispatchEvent(mouseEvent);
            });
        }
        
        // Add the new message
        const logContent = debugConsole.querySelector('#debug-log-content');
        const timestamp = new Date().toLocaleTimeString() + '.' + String(Date.now()).slice(-3);
        
        const logEntry = document.createElement('div');
        logEntry.style.cssText = `
            margin-bottom: 2px; 
            padding: 2px 0; 
            border-bottom: 1px solid #333;
        `;
        
        const timeSpan = document.createElement('span');
        timeSpan.style.color = '#cdcdcd';
        timeSpan.textContent = timestamp + ': ';
        
        const messageSpan = document.createElement('span');
        messageSpan.textContent = message;
        */
        /*
        logEntry.appendChild(timeSpan);
        logEntry.appendChild(messageSpan);
        logContent.appendChild(logEntry);
        
        // Auto-scroll to bottom
        logContent.scrollTop = logContent.scrollHeight;
        
        // Limit to last 100 entries to prevent memory issues
        const entries = logContent.children;
        if (entries.length > 100) {
            logContent.removeChild(entries[0]);
        }
    }*/

    // Simplified mobile debug that does nothing in production
        function mobileDebug(message) {
        // No-op in production - uncomment the full function above for debugging
    }    


    Keypad.prototype.init = function () {
        var e = this.elem;
        var Hammer = require("./hammer.min.js");

        var drive_buttons = e.find(".drive-button");
        drive_buttons.each(
            function (index, element) {
                var hammer = new Hammer.Manager(element);
                
                hammer.add(
                    new Hammer.Tap({
                        time: 300,
                        interval: this.tapInterval,
                        threshold: 20,
                        taps: 1
                    })
                );
                
                hammer.add(
                    new Hammer.Press({
                        time: this.pressTime,
                        threshold: this.pressThreshold,
                    })
                );
                
                hammer.add(new Hammer.Pan({ threshold: this.pressThreshold }));

                hammer.on("tap", function(evt) {
                    // FIXED: More thorough exit button detection
                    if (this.isExitButtonEvent(evt)) return;
                    this.onDriveTap(evt);
                }.bind(this));
                
                hammer.on("press", function(evt) {
                    if (this.isExitButtonEvent(evt)) return;
                    this.onDrivePress(evt);
                }.bind(this));
                
                hammer.on("pressup", function(evt) {
                    if (this.isExitButtonEvent(evt)) return;
                    this.end();
                }.bind(this));
                
                // FIXED: Only end once when pan starts, don't trigger repeatedly
                hammer.on("panstart", function(evt) {
                    if (this.isExitButtonEvent(evt)) return;
                    if (this.going) {
                        this.cleanStop();
                    }
                }.bind(this));
                
                $(element).on("touchstart", function(evt) {
                    if (this.isExitButtonEvent(evt)) return;
                    
                    this.touchStartTime = Date.now();
                    this.currentTouchElement = element;
                }.bind(this));
                
                $(element).on("touchmove", function(evt) {
                    if (this.isExitButtonEvent(evt)) return;
                    if (!this.touchStartTime) return;
                    
                    var touch = evt.originalEvent.touches[0];
                    if (touch) {
                        var elementRect = element.getBoundingClientRect();
                        var isInside = (
                            touch.clientX >= elementRect.left &&
                            touch.clientX <= elementRect.right &&
                            touch.clientY >= elementRect.top &&
                            touch.clientY <= elementRect.bottom
                        );
                        
                        if (!isInside) {
                            this.end();
                        }
                    }
                }.bind(this));
                
                $(element).on("touchend", function(evt) {
                    if (this.isExitButtonEvent(evt)) return;
               
                    // Only call end if we haven't already handled slide-off
                    if (this.going && !this.slideOffDetected) {
                        this.end();
                    }

                setTimeout(() => {
                    this.touchStartTime = null;
                    this.currentTouchElement = null;
                    this.slideOffDetected = false;
                }, 50);
                    
                }.bind(this));

                $(element).on("blur", this.end.bind(this));
                $(element).on("mouseleave", this.onDriveMouseleave.bind(this));
                $(element).on("touchcancel", function(evt) {
                    if (this.isExitButtonEvent(evt)) return;
                    if (this.going && !this.slideOffDetected) {
                        this.cleanStop();
                    }
                    this.slideOffDetected = false;
                }.bind(this));
                
                $(document).on("scroll", this.end.bind(this));
                element.addEventListener("contextmenu", function (evt) {
                    evt.preventDefault();
                });
            }.bind(this)
        );
    };

    Keypad.prototype.isExitButtonEvent = function(evt) {
        if (!evt || !evt.target) return false;
        
        var target = evt.target;
        var $target = $(target);
        
        // Check multiple ways buttons/controls might be identified
        return (
            // Direct exit button
            $target.hasClass('manual-drive-exit') ||
            $target.closest('.manual-drive-exit').length > 0 ||
            target.id === 'manual-drive-exit' ||
            
            // Action buttons (C2, C3, JH, etc.)
            $target.hasClass('action-button') ||
            $target.closest('.action-button').length > 0 ||
            target.id === 'action-1' ||
            target.id === 'action-2' ||
            target.id === 'action-3' ||
            target.id === 'action-4' ||
            target.id === 'action-5' ||
            
            // Go To, Set Coordinates, Manual Stop buttons
            $target.hasClass('go-to') ||
            $target.closest('.go-to').length > 0 ||
            $target.hasClass('set-coordinates') ||
            $target.closest('.set-coordinates').length > 0 ||
            $target.hasClass('manual-stop') ||
            $target.closest('.manual-stop').length > 0 ||
            
            // Zero buttons
            $target.hasClass('zero-button') ||
            $target.closest('.zero-button').length > 0 ||
            target.className && target.className.includes('zero-') ||
            
            // Speed slider and fixed distance controls
            target.id === 'manual-move-speed' ||
            $target.hasClass('slider') ||
            $target.closest('.slidecontainer').length > 0 ||
            $target.hasClass('fixed-switch') ||
            $target.closest('.fixed-switch').length > 0 ||
            $target.hasClass('fixed-step-value') ||
            $target.closest('.fixed-input-container').length > 0 ||
            
            // Axis input boxes that trigger goto
            $target.hasClass('axi') ||
            $target.hasClass('modal-axi') ||
            target.id === 'X' || target.id === 'Y' || target.id === 'Z' ||
            target.id === 'A' || target.id === 'B' || target.id === 'C' ||
            
            // Any button or input in the go-to container
            $target.closest('.go-to-container').length > 0 ||
            $target.closest('.read-out-container').length > 0 ||
            
            // General exit-related text detection
            (target.textContent && target.textContent.toLowerCase().includes('exit')) ||
            (target.textContent && target.textContent.toLowerCase().includes('goto')) ||
            (target.textContent && target.textContent.toLowerCase().includes('zero')) ||
            (target.alt && target.alt.toLowerCase().includes('exit')) ||
            (target.title && target.title.toLowerCase().includes('exit'))
        );
    };

    Keypad.prototype.setOptions = function (options) {
        options = options || {};
        this.refreshInterval =
            options.refreshInterval || this.refreshInterval || 50;
        this.pressTime = options.pressTime || this.pressTime || 250;
        this.pressThreshold =
            options.pressThreshold || this.pressThreshold || 10;
        this.tapInterval = options.tapInterval || this.tapInterval || 250;
    };

    Keypad.prototype.emit = function (evt, data) {
        if (evt in this.listeners) {
            var listeners = this.listeners[evt];
            for (var i = 0; i < listeners.length; i++) {
                try {
                    listeners[i](data);
                } catch (e) {
                    console.error("Error calling listener: " + e);
                }
            }
        }
    };

    Keypad.prototype.on = function (evt, func) {
        if (evt in this.listeners) {
            this.listeners[evt].push(func);
        }
    };

    /* Keyboard keys and mouse-keypad keys work similarly, but not identically. Idea is that presses up to a threshold
     length will trigger a "fixed move" (via nudge process) as will any presses with "fixed" button on. Presses longer
     will trigger longer moves assuming "fixed" button off. */
    /* Beginning 9/2023 the maintenance of motion is handled by the server to prevent punctuation of smooth motion from
     network. This may have been the original intent. Run-on motion is prevented in case of client disconnect. It may be
     that we also need some keydown checking in the client to prevent stuck keys. */

    Keypad.prototype.guardAgainstExitButton = function() {
        // Check for any recent button clicks that should disable keypad events
        const now = Date.now();
        const timeout = 500; // ms
        
        if ((window._exitButtonClicked && (now - window._exitButtonClicked) < timeout) ||
            (window._actionButtonClicked && (now - window._actionButtonClicked) < timeout) ||
            (window._gotoButtonClicked && (now - window._gotoButtonClicked) < timeout) ||
            (window._setButtonClicked && (now - window._setButtonClicked) < timeout) ||
            (window._zeroButtonClicked && (now - window._zeroButtonClicked) < timeout)) {
            console.log("Ignoring keypad event - control button recently clicked");
            return true;
        }
        return false;
    };

     Keypad.prototype.setEnabled = function (enabled) {
        this.enabled = enabled;
        if (!enabled) {
            this.elem
                .find(".drive-button")
                .addClass("drive-button-inactive")
                .removeClass("drive-button-active");
        }
    };

    Keypad.prototype.enter = function () {
        this.emit("enter", null);
    };

    Keypad.prototype.refresh = function () {
        if (!this.enabled || !this.going) {
            if (this.interval) {
                clearTimeout(this.interval);
                this.interval = null;
            }
            
            if (this.going) {
                this.emit("stop", null);
                this.going = false;
            }
            return;
        }
        
        this.emit("go", this.move);
        
        this.interval = setTimeout(
            this.refresh.bind(this),
            this.refreshInterval || 50
        );
    };

    Keypad.prototype.start = function (
        axis,
        direction,
        second_axis,
        second_direction
    ) {
        // Always clear any existing refresh timers first
        if (this.interval) {
            clearTimeout(this.interval);
            this.interval = null;
        }
        
        // Always ensure clean state before starting
        if (this.going) {
            this.stop();
        }
        
        // Force enable if we're trying to start
        if (!this.enabled) {
            this.setEnabled(true);
        }
        
        if (second_axis) {
            this.move = {
                axis: axis,
                dir: direction,
                second_axis: second_axis,
                second_dir: second_direction,
            };
        } else {
            this.move = { axis: axis, dir: direction };
        }
        this.going = true;

        // Start the continuous motion loop
        this.emit("go", this.move);
        
        // Clear any existing timer before setting new one
        if (this.interval) {
            clearTimeout(this.interval);
            this.interval = null;
        }
        
        // Start refresh loop
        this.interval = setTimeout(() => {
            this.refresh();
        }, this.refreshInterval || 50);
    };

    Keypad.prototype.nudge = function (
        axis,
        direction,
        second_axis,
        second_direction
    ) {
        if (this.going) {
            console.warn("Keypad: Already in motion, ignoring nudge command");
            mobileDebug("Nudge blocked - already moving");
            return;
        }

        mobileDebug("Nudge: " + axis + " " + direction);

        if (second_axis) {
            var nudge = {
                axis: axis,
                dir: direction,
                second_axis: second_axis,
                second_dir: second_direction,
            };
        } else {
            nudge = { axis: axis, dir: direction };
        }

        this.emit("nudge", nudge);
    };

    Keypad.prototype.stop = function () {
        console.log("Keypad: Stop called");
        
        // Clear the refresh timer immediately
        if (this.interval) {
            clearTimeout(this.interval);
            this.interval = null;
        }
        
        this.going = false;
        this.emit("stop", null);
    };

    // Simplified end function
    Keypad.prototype.end = function () {
        if (this.guardAgainstExitButton()) return;
        this.going = false;
        this.enabled = false;
        this.target = null;
        
        if (this.interval) {
            clearTimeout(this.interval);
            this.interval = null;
        }
        
        this.elem
            .find(".drive-button")
            .removeClass("drive-button-active")
            .removeClass("drive-button-active-transient")
            .addClass("drive-button-inactive");
        
        this.emit("stop", null);
    };

    Keypad.prototype.cleanStop = function () {
        console.log("Keypad: Clean stop called (slide-off detected)");
        
        // Immediately set flags to prevent re-entry
        if (!this.going) {
            return; // Already stopped
        }
        
        this.going = false;
        this.enabled = false;
        
        // Clear the refresh timer
        if (this.interval) {
            clearTimeout(this.interval);
            this.interval = null;
        }
        
        // Update UI
        this.elem
            .find(".drive-button")
            .removeClass("drive-button-active")
            .removeClass("drive-button-active-transient")
            .addClass("drive-button-inactive");
        
        // Emit stop ONCE
        this.emit("stop", null);
    };    

    Keypad.prototype.onDrivePress = function (evt) {
        if (this.guardAgainstExitButton()) return;
        if (this.going) {
            this.stop();
        }
        
        this.target = evt.target;
        this.setEnabled(true);
        
        var e = $(evt.target);
        e.focus();

        if (e.hasClass("drive-button-fixed")) {
            this.onDriveTap(evt);
        } else {
            if (!this.going) {
                if (e.hasClass("x_pos") && e.hasClass("y_pos")) {
                    this.start("x", 1, "y", 1);
                } else if (e.hasClass("x_neg") && e.hasClass("y_pos")) {
                    this.start("x", -1, "y", 1);
                } else if (e.hasClass("x_neg") && e.hasClass("y_neg")) {
                    this.start("x", -1, "y", -1);
                } else if (e.hasClass("x_pos") && e.hasClass("y_neg")) {
                    this.start("x", 1, "y", -1);
                } else if (e.hasClass("x_pos")) {
                    this.start("x", 1);
                } else if (e.hasClass("x_neg")) {
                    this.start("x", -1);
                } else if (e.hasClass("y_pos")) {
                    this.start("y", 1);
                } else if (e.hasClass("y_neg")) {
                    this.start("y", -1);
                } else if (e.hasClass("z_pos_fast")) {
                    this.start("z_fast", 1);
                } else if (e.hasClass("z_pos_slow")) {
                    this.start("z_slow", 1);
                } else if (e.hasClass("z_neg_fast")) {
                    this.start("z_fast", -1);
                } else if (e.hasClass("z_neg_slow")) {
                    this.start("z_slow", -1);
                } else if (e.hasClass("a_pos")) {
                    this.start("a", 1);
                } else if (e.hasClass("a_neg")) {
                    this.start("a", -1);
                } else if (e.hasClass("b_pos")) {
                    this.start("b", 1);
                } else if (e.hasClass("b_neg")) {
                    this.start("b", -1);
                } else if (e.hasClass("c_pos")) {
                    this.start("c", 1);
                } else if (e.hasClass("c_neg")) {
                    this.start("c", -1);
                    return;
                }
                e.addClass("drive-button-active").removeClass("drive-button-inactive");
            }
        }
    };

    Keypad.prototype.onDriveTap = function (evt) {
        if (this.guardAgainstExitButton()) return;
        var e = $(evt.target);

        if (this.going) {
            this.end();
        } else {
            if (e.hasClass("x_pos") && e.hasClass("y_pos")) {
                this.nudge("x", 1, "y", 1);
            } else if (e.hasClass("x_neg") && e.hasClass("y_pos")) {
                this.nudge("x", -1, "y", 1);
            } else if (e.hasClass("x_neg") && e.hasClass("y_neg")) {
                this.nudge("x", -1, "y", -1);
            } else if (e.hasClass("x_pos") && e.hasClass("y_neg")) {
                this.nudge("x", 1, "y", -1);
            } else if (e.hasClass("x_pos")) {
                this.nudge("x", 1);
            } else if (e.hasClass("x_neg")) {
                this.nudge("x", -1);
            } else if (e.hasClass("y_pos")) {
                this.nudge("y", 1);
            } else if (e.hasClass("y_neg")) {
                this.nudge("y", -1);
            } else if (e.hasClass("z_pos_fast")) {
                this.nudge("z", 1);
            } else if (e.hasClass("z_pos_slow")) {
                this.nudge("z", 1);
            } else if (e.hasClass("z_neg_fast")) {
                this.nudge("z", -1);
            } else if (e.hasClass("z_neg_slow")) {
                this.nudge("z", -1);
            } else if (e.hasClass("a_pos")) {
                this.nudge("a", 1);
            } else if (e.hasClass("a_neg")) {
                this.nudge("a", -1);
            } else if (e.hasClass("b_pos")) {
                this.nudge("b", 1);
            } else if (e.hasClass("b_neg")) {
                this.nudge("b", -1);
            } else if (e.hasClass("c_pos")) {
                this.nudge("c", 1);
            } else if (e.hasClass("c_neg")) {
                this.nudge("c", -1);
            } else {
                return;
            }
            e.addClass("drive-button-active-transient").removeClass(
                "drive-button-inactive"
            );
            setTimeout(
                function () {
                    if (!this.going) {
                        e.removeClass("drive-button-active-transient").addClass(
                            "drive-button-inactive"
                        );
                    }
                }.bind(this),
                200
            );
        }
    };

    Keypad.prototype.onExitTap = function (evt) {
        this.exit();
    };

    Keypad.prototype.onEnterTap = function (evt) {
        this.enter();
    };

    Keypad.prototype.onDriveMouseleave = function (evt) {
        // Don't process mouseleave for exit button
        if ($(evt.target).closest('.manual-drive-exit').length > 0) {
            return;
        }
        
        // Don't process mouseleave during active touch interactions
        if (this.touchStartTime || this.currentTouchElement) {
            return;
        }
        
        // Don't process mouseleave if we're not actually in motion
        if (!this.going) {
            return;
        }
        
        // Only process once - use cleanStop instead of end
        if (this.going) {
            console.log("Keypad: Mouse left button - clean stopping");
            this.cleanStop();
        }
    };

    return Keypad;
});
