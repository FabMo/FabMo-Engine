/*
 * runtime/manual/driver.js
 *
 * This module defines ManualDriver, which is a helper object that manages
 * manual control of the machine.  It is the real implementation for the ManualRuntime
 * but exists as a helper so that it can be used inside of other runtimes that need to use the
 * manual state, and want to do it in the same way that the manual runtime does.
 *
 * OVER TIME, Manual has gotten a little crazy because it serves many purposes:
 *  - the Normal Keypad (which is in incremental mode and has relied at different times on
 *      different types of pumping; many acc commands to support keypad extras)
 *  - truly manual uses for sending individual commands for other purposes, as well as providing
 *      the direct calls for developing other manual motion handlers beyond the normal keypad
 */
var log = require("../../log").logger("manual");
var config = require("../../config");
var util = require("util");
var events = require("events");
var Q = require("q");

// Parameters related to filling the queue, motion, etc.
// These are fussy.
var T_RENEW = 300;
var SAFETY_FACTOR = 4.0;
// TODO should be in the ManualDriver instance?!
var count = 0;
var RENEW_SEGMENTS = 10;
var FIXED_MOVES_QUEUE_SIZE = 3;

// ManualDriver constructor
// The manual driver provides functions for managing the state of the G2 driver while "manually"
// streaming commands to it, as is done when in "pendant" mode or similar
//   drv - The driver instance to manage
//    st - An open stream feeding into an active machining cycle on that driver
function ManualDriver(drv, st, mode) {
    this.stream = st;
    this.driver = drv;
    this.renew_timer = null;
    this.movement_timer = null;
    this.fixedQueue = [];
    this.entered = false;
    this.exited = false;
    this.fromFile = false;
    this.gotoModeHold = false;

    // True while the tool is known to be in motion
    this.moving = false;

    // True while the user intends (as far as we know) for the tool to continue moving
    this.keep_moving = false;

    // Set to true to exit the manual state once the current operation is completed
    this.exit_pending = false;
    this.stop_pending = false;

    // The default mode is "normal" (feed the queue with constant movement along a vector)
    if (mode === "raw") {
        this.mode = "raw";
    } else {
        this.mode = "normal";
    }

    // Current trajectory
    this.current_axis = null;
    this.current_speed = null;
    this.completeCallback = null;
    this.status_handler = this._onG2Status.bind(this);

    // Setup to process status reports from G2
    this.driver.on("status", this.status_handler);
}
util.inherits(ManualDriver, events.EventEmitter);

// Enter the machining cycle
// This does a little setup too (sets manual state jerk values, etc)
// TODO: Pass the setup stuff in?  (In case runtimes want to do things differently?)
// Returns a promise that resolves on exit
ManualDriver.prototype.enter = function () {
    if (this.entered) {
        return;
    }
    this.driver.manual_hold = true;
    switch (this.mode) {
        case "normal":
            // Disable the spindle off during feedhold in manual mode
            this.stream.write("M100 ({spph:false})\n");
            // Retrieve the manual-mode-specific jerk settings and apply them (temporarily) for this manual session
            var jerkXY = config.machine._cache.manual.xy_jerk || 100;
            var jerkZ = config.machine._cache.manual.z_jerk || 100;
            this.stream.write("M100 ({xjm:" + jerkXY + "})\n");
            this.stream.write("M100 ({yjm:" + jerkXY + "})\n");
            this.stream.write("M100 ({zjm:" + jerkZ + "})\n");
            // Turn off z-lift, set incremental mode, and send a
            // "dummy" move to prod the machine into issuing a status report
            this.stream.write("M0\nG91\n G0 X0 Y0 Z0\n");
            //			this.stream.write('M100 ({zl:0})\nM0\nG91\n G0 X0 Y0 Z0\n'); ////## no longer need to turn off z-lift?
            this.driver.prime();
            break;
        case "raw":
            this.stream.write("M0\n");
            //			this.stream.write('M100 ({zl:0})\nM0\n');                    ////## no longer need to turn off z-lift?
            this.driver.prime();
            break;
        default:
            log.warn("Unknown manual drive mode on enter: " + this.mode);
            break;
    }
    this.entered = true;
    this.deferred = Q.defer();

    return this.deferred.promise;
};

// Exit the machining cycle
// This stops motion if it is in progress, and restores the settings changed in enter()
ManualDriver.prototype.exit = function () {
    if (this.isMoving()) {
        // Don't exit yet - just pend.
        log.debug("Pending the exit");
        this.exit_pending = true;
        this.stopMotion();
    } else {
        log.debug("Executing immediate exit");
        this.driver.manual_hold = false; // PROBLEM area for exiting SK when used in file
        switch (this.mode) {
            case "normal":
                // Restore the sbp_runtime config settings for jerk
                var jerkXY = config.opensbp._cache.xy_maxjerk || 75;
                var jerkZ = config.opensbp._cache.z_maxjerk || 75;
                this.stream.write("M100 ({xjm:" + jerkXY + "})\n");
                this.stream.write("M100 ({yjm:" + jerkXY + "})\n");
                this.stream.write("M100 ({zjm:" + jerkZ + "})\n");
                // Restore generic feedrate (this is mostly for appearance of first move if a rapid)
                var feedXY = config.opensbp._cache.movexy_speed || 3;
                // Restore spindle on during feedhold
                this.stream.write("M100 ({spph:true})\n");
                var uMult = 1;
                if (config.machine._cache.units === "in") {
                    uMult = 25.4;
                }
                feedXY = feedXY * uMult * 60; // convert to mm/min
                this.stream.write("M100 ({feed:" + feedXY + "})\n");
                // Other potential additional Manual Keypad post-pend commands
                break;
            case "raw":
                // Potential additional Manual 'raw' post-pend commands
                break;
            default:
                log.warn("Unknown manual drive mode on exit: " + this.mode);
                break;
        }
        this.stream.write("G61\n"); // don't leave in exact stop mode from nudge
        if (this.fromFile) {
            this.stream.write("M0\n"); // avoid triggering stat:4 when in file
        } else {
            this.stream.write("M30\n");
            this.stream.write("{out4:0}\n");
            this.stream.write("{out1:0}\n"); // just in case, turn off spindle
        }
        this.driver.removeListener("status", this.status_handler);
        this.exited = true;
        this._done();
    }
};

// Start motion on the specified axis (and optional second axis) at the specified speed
// TODO - This function should really just take an arbitrary vector
//           axis - The first axis to move (eg "X")
//          speed - The speed in current units
//    second_axis - The second axis to move
//   second_speed - The second axis speed
ManualDriver.prototype.startMotion = function (axis, speed, second_axis, second_speed) {
    var dir = speed < 0 ? -1.0 : 1.0;
    var second_dir = second_speed < 0 ? -1.0 : 1.0;
    speed = Math.abs(speed);
    this.gotoModeHold = false;
    // Raw mode doesn't accept start motion command
    if (this.mode != "normal") {
        throw new Error("Cannot start movement in " + this.mode + " mode.");
    }
    // Don't start motion if we're in the middle of stopping (can do it from stopped, though)
    if (this.stop_pending) {
        return;
    }

    // If we're moving already, maintain motion
    if (this.moving) {
        if (axis === this.currentAxis && speed === this.currentSpeed) {
            this.maintainMotion();
        } else {
            this.stopMotion();
            // TODO Deal with direction changes here
        }
    } else {
        // Deal with one axis vs 2 (See TODO above)
        if (second_axis) {
            this.second_axis = second_axis;
            this.second_currentDirection = second_dir;
        } else {
            this.second_axis = null;
            this.second_currentDirection = null;
        }
        // Set Heading
        this.currentAxis = axis;
        this.currentSpeed = speed;
        this.currentDirection = dir;

        // Flag that we're kicking off a move
        this.moving = this.keep_moving = true;

        // Length of the moves we pump the queue with, based on speed vector
        this.renewDistance = speed * (T_RENEW / 60000) * SAFETY_FACTOR;
        // Make sure we're in relative moves and the speed is set
        this.stream.write("G91 F" + this.currentSpeed.toFixed(3) + "\n" + "G61" + "\n");

        // Start pumping moves
        this._renewMoves("start");
    }
};

// Set the flag that indicates to this driver that motion is still requested along the current heading
// This function only has any effect if the machine is already moving
ManualDriver.prototype.maintainMotion = function () {
    if (this.moving) {
        this.keep_moving = true;
    }
};

// Stop all movement
ManualDriver.prototype.stopMotion = function () {
    this.stop_pending = true;
    this.keep_moving = false;
    if (this.renew_timer) {
        clearTimeout(this.renew_timer);
    }
    this.driver.feedHold();
    if (!this.gotoModeHold) {
        this.driver.queueFlush(
            function () {
                this.driver._write("%\n"); // Will send flush as callback
            }.bind(this)
        );
    }
};

// Stop all movement (also? TODO: What's this all about?)
ManualDriver.prototype.quitMove = function () {
    this.keep_moving = false;
    this.driver.queueFlush(
        function () {
            this.driver._write("%\n"); // Will send flush as callback
        }.bind(this)
    );
    if (this.moving) {
        this.stop_pending = true;
        this.driver.quit();
        this.driver.queueFlush();
    } else {
        this.stop_pending = false;
    }
};

ManualDriver.prototype.resumeMove = function () {
    this.driver.manual_hold = false;
    this.keep_moving = true;
    this.stop_pending = false;
    this.emit("manual");
    this.driver.manualResume();
    this.keep_moving = true;
    if (this.moving) {
        this.driver.resume();
    } else {
        this.stop_pending = false;
    }
};

ManualDriver.prototype.runGCode = function (code) {
    if (this.mode == "raw") {
        ////## section for betaInsert
        log.debug("... possibly converting special codes in betaInsert");
        code = code.replace(/&/g, "\n"); // for use in creating multiple lines
        code = code.replace("^", "\x04\n"); // to insert a kill
        code = code.replace("!", "\x21\n"); // to insert a hold
        code = code.replace("~", "\x7E\n"); // to insert a resume
        code = code.replace("#", "\x18\n"); // to insert RESET-G2
        ////## Not really working right yet if you do a hold
        if (this.moving) {
            log.debug("writing gcode while moving"); ////##
            this.stream.write(code.trim() + "\n");
            this.maintainMotion();
        } else {
            log.debug("writing gcode while static");
            this.moving = true;
            this.stream.write(code.trim() + "\n");
            this.maintainMotion();
            this._renewMoves("start");
        }
    } else {
        throw new Error("Cannot run gcode when in " + this.mode + " mode.");
    }
};

// Go to a specified absolute position
//   pos - Position vector as an object, eg: {"X":10, "Y":5, "F":60} Speed is optionally added
// The speed will be vectored based on the current speed setting on the slider; but limited to axis maximums
ManualDriver.prototype.goto = function (pos) {
    // We may want to consider whether GOTOs are moves or jogs; for now, they're moves w/speed set by slider (safer)
    var hasZABC = false;
    var move = "G90\nG1 ";
    for (var key in pos) {
        if (Object.prototype.hasOwnProperty.call(pos, key)) {
            move += key + pos[key] + " ";
            if (key === "Z" || key === "A" || key === "B" || key === "C") {
                // To see if we should set a lower speed; check to see is this special axis is actually a move given the current location of the axis
                var testa = this.driver.status["pos" + key.toLowerCase()];
                var testb = pos[key];
                if (Math.abs(testa - testb) > 0.001) {
                    hasZABC = true;
                }
            }
        }
    }
    if (hasZABC) {
        move += "F" + 60 * config.machine._cache.manual.z_fast_speed;
    } else {
        move += "F" + 60 * config.machine._cache.manual.xy_speed;
    }
    this.gotoModeHold = true;
    move += "\nM0\nG91\n";
    this.driver.prime();
    this.stream.write(move);
};

// Toggle an output in manual [currenting only doing output1 for spindle]
//   out - Output as a state, eg: {"1":1} or {"1":0} (i.e. using g-code json format)
//   ... such that the short hand version looks like {out1:1}
ManualDriver.prototype.output = function (out, val) {
    var newOut = "{out" + out + ":" + val + "}\n";
    log.info("ManualDriver.output called with: " + newOut);
    this.mode = "raw"; // or this.driver.mode = "raw"
    this.stream.write(newOut);
    this.mode = "normal"; // or this.driver.mode = "normal";
};

// Set the machine position to the specified "location"
// TODO: Is it possible that timing could produce an inaccurate position update here???
//   pos - New position vector as an object,  eg: {"X":10, "Y":5}
ManualDriver.prototype.set = function (pos) {
    var toSet = {};
    var unitConv;
    if (this.driver.status.unit === "in") {
        // inches
        unitConv = 0.039370079;
    } else {
        unitConv = 1;
    }
    // Deal with unit conversion for ABC which can be rotary(1);linear(2);radius(3) [these are ints!]
    if (config.driver._cache.aam === 1) {
        var unitConvA = 1; //never a converion for rotary
    } else {
        unitConvA = unitConv; // linear use current units
    }
    if (config.driver._cache.bam === 1) {
        var unitConvB = 1;
    } else {
        unitConvB = unitConv;
    }
    if (config.driver._cache.cam === 1) {
        var unitConvC = 1;
    } else {
        unitConvC = unitConv;
    }

    if (this.mode === "normal") {
        // var gc = 'G10 L20 P2 ';
        this.driver.get(
            "mpo",
            function (err, MPO) {
                Object.keys(pos).forEach(
                    function (key) {
                        log.debug(key);
                        switch (key) {
                            case "X":
                                toSet.g55x = Number((MPO.x * unitConv - pos[key]).toFixed(5));
                                break;
                            case "Y":
                                toSet.g55y = Number((MPO.y * unitConv - pos[key]).toFixed(5));
                                break;
                            case "Z":
                                toSet.g55z = Number((MPO.z * unitConv - pos[key]).toFixed(5));
                                break;
                            case "A":
                                toSet.g55a = Number((MPO.a * unitConvA - pos[key]).toFixed(5));
                                break;
                            case "B":
                                toSet.g55b = Number((MPO.b * unitConvB - pos[key]).toFixed(5));
                                break;
                            case "C":
                                toSet.g55c = Number((MPO.c * unitConvC - pos[key]).toFixed(5));
                                break;
                            default:
                                log.error("don't understand axis");
                        }
                    }.bind(this)
                );
                config.driver.setMany(
                    toSet,
                    // eslint-disable-next-line no-unused-vars
                    function (err, value) {
                        //total hack to update the positions
                        this.stream.write("G91\nG0\nX0\nG91");
                        this.driver.prime();
                        config.driver.reverseUpdate(
                            ["g55x", "g55y", "g55z", "g55a", "g55b", "g55c"],
                            // eslint-disable-next-line no-unused-vars
                            function (err, data) {}
                        );
                    }.bind(this)
                );
            }.bind(this)
        );
    } else {
        throw new Error("Can't set from " + this.mode + " mode.");
    }
};

// Internal function for handling nudges. (This function called "Fixed" moves in Sb3; there, nudges were
// moves inserted at a Stop in the middle of a file; G2 could allow implementation of this behavior.)
// Nudges are little fixed incremental moves that are usually initiated by a short tap on one of the
// direction keys on a pendant display, or by pressing the direction keys in a specified "fixed" mode
// and executed at the end of the current move.  This is the function that dequeues and executes them.
// Nudges are made fixed and individual by G61.1.
// TODO: Like start above, nudges should be arbritrary vectors rather than axis, second_axis
// Returns the number of nudges
ManualDriver.prototype._handleNudges = function () {
    count = this.fixedQueue.length;

    if (this.fixedQueue.length > 0) {
        while (this.fixedQueue.length > 0) {
            var move = this.fixedQueue.shift();
            this.moving = true;
            this.keep_moving = false;
            var axis = move.axis.toUpperCase();

            if ("XYZABC".indexOf(axis) >= 0) {
                var moves = ["G91 G61.1"]; // set to exact fixed distance
                if (move.second_axis) {
                    var second_axis = move.second_axis.toUpperCase();
                    if (move.speed) {
                        moves.push(
                            "G1 " +
                                axis +
                                move.distance.toFixed(5) +
                                " " +
                                second_axis +
                                move.second_distance.toFixed(5) +
                                " F" +
                                move.speed.toFixed(3)
                        );
                    } else {
                        moves.push(
                            "G0 " +
                                axis +
                                move.distance.toFixed(5) +
                                " " +
                                move.second_axis.toUpperCase +
                                move.second_distance.toFixed(5) +
                                " F" +
                                move.speed.toFixed(3)
                        );
                    }
                } else {
                    if (move.speed) {
                        moves.push("G1 " + axis + move.distance.toFixed(5) + " F" + move.speed.toFixed(3));
                    } else {
                        moves.push("G0 " + axis + move.distance.toFixed(5) + " F" + move.speed.toFixed(3));
                    }
                }
                moves.forEach(
                    function (move) {
                        this.stream.write(move + "\n");
                    }.bind(this)
                );
            }
        }
        this.driver.prime();
    } else {
        this.moving = this.keep_moving = false;
    }
    return count;
};

// Issue a nudge (small fixed move).
// Don't queue more than FIXED_MOVES_QUEUE_SIZE, though, to keep the machines behavior from running away.
// (TODO: Might consider making this a typematic sort of thing where after a time you get a machine gun effect.)
// ie: You shoudln't be allowed to queue 50 nudges during a long slow move, and see them execute at the end.
//              axis - The first axis to move (eg "X")
//             speed - The speed in current units
//          distance - The length of the nudge
//       second_axis - The second axis to move
//   second_distance - The second axis speed
ManualDriver.prototype.nudge = function (axis, speed, distance, second_axis, second_distance) {
    if (this.fixedQueue.length >= FIXED_MOVES_QUEUE_SIZE) {
        log.warn("fixedMove(): Move queue is already full!");
        return;
    }
    if (second_axis) {
        this.fixedQueue.push({
            axis: axis,
            speed: speed,
            distance: distance,
            second_axis: second_axis,
            second_distance: second_distance,
        });
    } else {
        this.fixedQueue.push({ axis: axis, speed: speed, distance: distance });
    }
    if (this.moving) {
        log.warn("fixedMove(): Queueing move, due to already moving.");
    } else {
        this._handleNudges();
    }
};

// Return true if the machine is moving
ManualDriver.prototype.isMoving = function () {
    return this.moving;
};

// Internal function called to "pump" moves into the queue
// This function is called periodically until a == stop is requested ==,
// or the users intent to continue moving evaporates ////##??.
// The idea behind this function is that it is called at an interval that outpaces the
// reason - The reason this functon is being called (used for -debug- purposes)
// eslint-disable-next-line no-unused-vars
ManualDriver.prototype._renewMoves = function (reason) {
    if (this.mode === "normal") {
        if (this.moving && this.keep_moving) {
            this.keep_moving = true;
            if (global.CLIENT_DISCONNECTED) {
                ////## added to prevent runaway; TODO: sovled this without global!
                this.keep_moving = false;
            }
            var segment = this.currentDirection * (this.renewDistance / RENEW_SEGMENTS);
            var second_segment = this.second_currentDirection * (this.renewDistance / RENEW_SEGMENTS);
            var moves = [];
            if (this.second_axis) {
                for (var i = 0; i < RENEW_SEGMENTS; i++) {
                    var move =
                        "G1" +
                        this.currentAxis +
                        segment.toFixed(4) +
                        this.second_axis +
                        second_segment.toFixed(4) +
                        "\n";
                    moves.push(move);
                }
            } else {
                // eslint-disable-next-line no-redeclare
                for (var i = 0; i < RENEW_SEGMENTS; i++) {
                    // eslint-disable-next-line no-redeclare
                    var move = "G1" + this.currentAxis + segment.toFixed(4) + "\n";
                    moves.push(move);
                }
            }
            this.stream.write(moves.join(""));
            this.driver.prime();
            this.renew_timer = setTimeout(
                function () {
                    this._renewMoves("timeout");
                }.bind(this),
                T_RENEW
            );
        } else {
            this.stopMotion();
        }
    } else {
        if (!(this.moving && this.keep_moving)) {
            // TODO:  Why is this disabled?
            //this.stopMotion();
        } else {
            this.renew_timer = setTimeout(
                function () {
                    this._renewMoves("timeout");
                }.bind(this),
                T_RENEW
            );
        }
    }
};

// Status handler
ManualDriver.prototype._onG2Status = function (status) {
    if (this.movement_timer) {
        clearTimeout(this.movement_timer);
    }

    this.movement_timer = setTimeout(function () {
        this.moving = false;
    }, 2000);

    switch (status.stat) {
        case this.driver.STAT_INTERLOCK:
        case this.driver.STAT_SHUTDOWN:
        case this.driver.STAT_PANIC:
            this.emit("crash");
            break;
        case this.driver.STAT_ALARM:
            // no handler in manual
            break;
        case this.driver.STAT_RUNNING:
            this.moving = true;
            break;
        case this.driver.STAT_STOP:
            this.stop_pending = false;
        // Fall through is intended here, do not add a break
        case this.driver.STAT_END:
        case this.driver.STAT_HOLDING:
            // Handle nudges once we've come to a stop
            if (this._handleNudges()) {
                // Nudges got handled
            } else {
                // extra flushes may be coming from here
                this.stop_pending = false;
                if (!this.driver.pause_hold && this.driver.status.hold === 0) {
                    this.driver._write("%\n"); // flush feed-hold and get stat
                }
                if (this.exit_pending) {
                    this.exit();
                }
            }
            break;
    }
};

// Internal call that is issued when manual mode is done
// Resolves the promise created by the enter() function and resets internal state
ManualDriver.prototype._done = function () {
    this.moving = false;
    this.keep_moving = false;
    this.stream = null;
    this.entered = false;
    this.deferred.resolve();
};

module.exports = ManualDriver;
