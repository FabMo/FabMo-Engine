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
    };



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
}




    // function mobileDebug(message) {
    //     // Create a floating debug div
    //     const debug = document.createElement('div');
    //     debug.style.cssText = `
    //         position: fixed; top: 10px; right: 10px; 
    //         background: red; color: white; padding: 5px; 
    //         z-index: 9999; font-size: 12px; max-width: 200px;
    //     `;
    //     debug.textContent = new Date().toLocaleTimeString() + ': ' + message;
    //     document.body.appendChild(debug);
    //     setTimeout(() => debug.remove(), 4000);
    // }

    Keypad.prototype.init = function () {
        var e = this.elem;
        var Hammer = require("./hammer.min.js");

        var drive_buttons = e.find(".drive-button");
        drive_buttons.each(
            function (index, element) {
                var hammer = new Hammer.Manager(element);
                
                // Track if Hammer events are working
                this.hammerEventHandled = false;
                
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

                // Track Hammer events to prevent double-firing
                hammer.on("tap", function(evt) {
                    console.log("🔄 Hammer tap detected");
                    mobileDebug("Tap detected: " + element.className);
                    this.hammerEventHandled = true;
                    this.onDriveTap(evt);
                    // Clear flag after a delay
                    setTimeout(() => { this.hammerEventHandled = false; }, 100);
                }.bind(this));
                
                hammer.on("press", function(evt) {
                    console.log("🔄 Hammer press detected"); 
                    mobileDebug("Press detected: " + element.className);
                    this.hammerEventHandled = true;
                    this.onDrivePress(evt);
                    // Clear flag after a delay
                    setTimeout(() => { this.hammerEventHandled = false; }, 100);
                }.bind(this));
                
                hammer.on("pressup", this.end.bind(this));
                hammer.on("panend", this.end.bind(this));
                hammer.on("pancancel", this.end.bind(this));
                hammer.on("panstart", this.end.bind(this));
                hammer.on("panmove", function(evt) {
                    if (evt.distance > 15) {
                        this.end();
                    }
                }.bind(this));

                // Touch tracking to replace mouseleave functionality
                $(element).on("touchstart", function(evt) {
                    // Prevent mouseleave from firing during touch
                    this.touchStartTime = Date.now();
                    this.currentTouchElement = element;
                    
                    mobileDebug("📱 TOUCHSTART - blocking mouseleave events");
                    
                    this.touchNudgeTimer = setTimeout(function() {
                        if (this.touchStartTime && !this.hammerEventHandled) {
                            mobileDebug("Touch press fallback");
                            this.onDrivePress({target: element});
                        }
                    }.bind(this), 250);
                }.bind(this));
               
                // Touch move tracking to replace mouseleave
                $(element).on("touchmove", function(evt) {
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
                            console.log("🔄 Touch moved outside button - ending like mouseleave");
                            mobileDebug("Touch left button area");
                            this.end();
                        }
                    }
                }.bind(this));
                
                $(element).on("touchend", function(evt) {
                    mobileDebug("📱 TOUCHEND - re-enabling mouseleave events");
                    console.log("🔄 Touch end on element");
                    
                    if (this.touchNudgeTimer) {
                        clearTimeout(this.touchNudgeTimer);
                        this.touchNudgeTimer = null;
                    }
                    
                    // Add a delay before clearing touch protection
                    setTimeout(() => {
                        this.touchStartTime = null;
                        this.currentTouchElement = null;
                        mobileDebug("📱 Touch protection cleared");
                    }, 50); // Give time for any delayed mouse events

                    if (this.touchStartTime && !this.hammerEventHandled) {
                        const touchDuration = Date.now() - this.touchStartTime;
                        this.touchStartTime = null;
                        
                        if (touchDuration < 250) { // Match press time
                            mobileDebug("Touch nudge fallback");
                            this.onDriveTap({target: element});
                        } else {
                            // Long press ended normally
                            this.end();
                        }
                    } else {
                        // Reset even if Hammer handled it
                        this.touchStartTime = null;
                    }
                    
                    // Always clean up the current touch element
                    this.currentTouchElement = null;
                }.bind(this));

                // Clean up existing handlers
                $(element).on("blur", this.end.bind(this));
                $(element).on("mouseleave", this.onDriveMouseleave.bind(this));
                $(element).on("touchcancel", this.end.bind(this));
                
                $(document).on("scroll", this.end.bind(this));
                element.addEventListener("contextmenu", function (evt) {
                    evt.preventDefault();
                });
            }.bind(this)
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

    Keypad.prototype.setEnabled = function (enabled) {
        // Add debug logging to catch when enabled is set to false
        if (!enabled && this.enabled) {
            const callStack = new Error().stack;
            const callerInfo = callStack.split('\n')[2] || 'unknown caller';
            
            mobileDebug("🚫 SETENABLED(FALSE) CALLED!");
            mobileDebug("📍 SetEnabled(false) from: " + callerInfo.trim());
            console.warn("Keypad: setEnabled(false) called from:", callerInfo);
        }

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
        mobileDebug("🔄 REFRESH: enabled=" + this.enabled + " going=" + this.going);
        
        // Defensive state checking
        if (!this.enabled || !this.going) {
            mobileDebug("🛑 REFRESH stopping motion - enabled:" + this.enabled + " going:" + this.going);
            console.log("Keypad: Stopping refresh due to state check", {
                enabled: this.enabled, 
                going: this.going,
                hasInterval: !!this.interval
            });
            
            // Clear the interval and stop
            if (this.interval) {
                clearTimeout(this.interval);
                this.interval = null;
            }
            
            // Only emit stop if we were actually going
            if (this.going) {
                this.emit("stop", null);
                this.going = false;
            }
            return;
        }
        
        // Continue motion
        this.emit("go", this.move);
        
        // Set up next refresh
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

    Keypad.prototype.end = function () {
        // Capture more detailed debugging info
        const callStack = new Error().stack;
        const callerInfo = callStack.split('\n')[2] || 'unknown caller';
        
        console.log("Keypad: End called - state going:", this.going, "enabled:", this.enabled);
        
        // Enhanced mobile debug with call stack info
        mobileDebug("🛑 END CALLED - going:" + this.going + " enabled:" + this.enabled);
        mobileDebug("📍 Called from: " + callerInfo.trim());
        
        // Check what event might have triggered this
        if (this.touchStartTime) {
            mobileDebug("📱 Touch active: startTime=" + this.touchStartTime);
        }
        if (this.currentTouchElement) {
            mobileDebug("📱 Touch element: " + this.currentTouchElement.className);
        }
        if (this.hammerEventHandled) {
            mobileDebug("🔨 Hammer event recently handled");
        }
        if (this.touchNudgeTimer) {
            mobileDebug("⏱️ Touch nudge timer active");
        }
        if (this.interval) {
            mobileDebug("🔄 Refresh interval active");
        }

        // Force complete state reset
        this.going = false;
        this.enabled = false;
        this.target = null;
        
        // Clear any pending intervals
        if (this.interval) {
            clearTimeout(this.interval);
            this.interval = null;
        }
        
        // Clean up all visual states
        this.elem
            .find(".drive-button")
            .removeClass("drive-button-active")
            .removeClass("drive-button-active-transient")
            .addClass("drive-button-inactive");
        
        // Force a stop emission to ensure server-side cleanup
        this.emit("stop", null);
        
        mobileDebug("✅ End complete - state reset");
        console.log("Keypad: End complete - state reset");
    };

    Keypad.prototype.onDrivePress = function (evt) {
        const pressTime = Date.now();
        mobileDebug("🔄 PRESS START: " + evt.target.className + " at " + pressTime);
        
        // Only stop current motion if there is any
        if (this.going) {
            mobileDebug("⚠️ STOPPING previous motion before new press");
            this.stop();
        }
        
        this.target = evt.target;
        
        mobileDebug("🟢 Setting enabled=true before start");
        this.setEnabled(true);
        
        var e = $(evt.target);
        e.focus();

        if (e.hasClass("drive-button-fixed")) {
            mobileDebug("🔧 Fixed mode - calling onDriveTap");
            this.onDriveTap(evt);
        } else {
            // Start immediately - no timeout needed
            if (!this.going) {
                mobileDebug("🚀 STARTING motion for: " + evt.target.className);
                
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
                } else {
                    mobileDebug("❌ No matching axis class found");
                    return;
                }
                
                const postStartTime = Date.now();
                mobileDebug("✅ Motion started - enabled: " + this.enabled + " going: " + this.going + " time: " + (postStartTime - pressTime) + "ms");
                
                e.addClass("drive-button-active").removeClass("drive-button-inactive");
            } else {
                mobileDebug("⚠️ Not starting - already going: " + this.going);
                console.warn("Keypad: Not ready for press - already going:", this.going);
            }
        }
    };

    Keypad.prototype.onDriveTap = function (evt) {
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
        // FIXED: Don't process mouseleave events during active touch interactions
        if (this.touchStartTime || this.currentTouchElement) {
            mobileDebug("🚫 MOUSELEAVE ignored - touch interaction active");
            console.log("Keypad: Ignoring mouseleave during touch interaction");
            return;
        }
        
        // FIXED: Add a small delay to avoid race conditions with touch events
        setTimeout(() => {
            // Double-check we're not in a touch interaction
            if (!this.touchStartTime && !this.currentTouchElement) {
                mobileDebug("🖱️ MOUSELEAVE triggered end() (delayed)");
                console.log("Keypad: Mouse/touch leave detected");
                this.end();
            } else {
                mobileDebug("🚫 MOUSELEAVE cancelled - touch detected during delay");
            }
        }, 10); // Small delay to let touch events settle
    };

    return Keypad;
});
