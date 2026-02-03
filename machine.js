/*
 * machine.js
 *
 * Defines the "machine model" which is an abstraction of the physical machine that lives
 * sort of one layer up from the G2 driver.  It maintains a "machine state" that is similar to, but
 * not the same as G2s internal state, and provides functions for high level machine operations.
 *
 * The machine model includes the important concept of runtimes, which are individual software components
 * that get control of the machine for performing certain actions.  Runtimes are important for compartmentalizing
 * different ways of controlling the machine.  Manually driving the machine with a pendant, for example is
 * a very different sort of activity from running a g-code file, so those two activities are implemented
 * by two separate runtimes that each get a chance to take control of the machine when it is time to perform
 * their respective tasks.
 *
 * This module also sort of "meta manages" the motion systems state.  An example
 * of this is that G2 has digital inputs defined, and can specify their input mode and basic function, but the
 * machine model layers some additional function on top of them, such as their higher-level application
 * - perhaps acting as a door interlock, a tool stop button, etc.
 *
 * The machine model is a singleton.  There is only ever one of them, which is instantiated by the connect() method.
 */
/*jshint esversion: 6 */
var g2 = require("./g2");
var util = require("util");
var events = require("events");
var PLATFORM = require("process").platform;
var fs = require("fs");
var path = require("path");
var db = require("./db");
var log = require("./log").logger("machine");
var config = require("./config");
var updater = require("./updater");
var u = require("./util");
var async = require("async");
var canQuit = false;
var canResume = false;
var clickDisabled = false;
var interlockBypass = false;
var runtime = null;
var spindle = require("./spindle1");

////## temp KLUDGES because of difficulty in figuring out a couple of quick comms between modules
global.CUR_RUNTIME;
global.CLIENT_DISCONNECTED = false; // Special purpose kludge to stop any ongoing keypad or keyboard actions if client disconnects

// Load up all the runtimes that are currently defined
// TODO - One day, a folder-scan and auto-registration process might be nice here, this is all sort of hand-rolled.
var GCodeRuntime = require("./runtime/gcode").GCodeRuntime;
var SBPRuntime = require("./runtime/opensbp").SBPRuntime;
var ManualRuntime = require("./runtime/manual").ManualRuntime;
var PassthroughRuntime = require("./runtime/passthrough").PassthroughRuntime;
var IdleRuntime = require("./runtime/idle").IdleRuntime;

// Instantiate a machine, connecting to the serial port specified in the engine configuration.
// TODO: We probably don't need special keys in the config for each platform anymore.  Since the engine
//       does its first-time config platform-detecting magic (See engine.js) these ports are likely to
//       be filled with sensible defaults
function connect(callback) {
    var control_path = null;
    switch (PLATFORM) {
        case "linux":
            control_path = config.engine.get("control_port_linux");
            break;

        case "darwin":
            control_path = config.engine.get("control_port_osx");
            break;

        case "win32":
        case "win64":
            control_path = config.engine.get("control_port_windows");
            break;

        default:
            control_path = null;
            break;
    }
    if (control_path) {
        // TODO - I dunno, this is sort of a weird pattern
        exports.machine = new Machine(control_path, callback);
    } else {
        typeof callback === "function" && callback('No supported serial path for platform "' + PLATFORM + '"');
    }
}

function Machine(control_path, callback) {
    // Handle Inheritance
    events.EventEmitter.call(this);

    //    this.accessories = {};

    // Instantiate driver and connect to G2
    this.status = {
        state: "not_ready",
        posx: 0.0,
        posy: 0.0,
        posz: 0.0,
        posa: 0.0,
        posb: 0.0,
        posc: 0.0,
        in1: 1,
        in2: 1,
        in3: 1,
        in4: 1,
        in5: 1,
        in6: 1,
        in7: 1,
        in8: 1,
        in9: 1,
        in10: 1,
        in11: 1,
        in12: 1,
        spc: 0,
        out1: 0,
        out2: 0,
        out3: 0,
        out4: 0,
        out5: 0,
        out6: 0,
        out7: 0,
        out8: 0,
        out9: 0,
        out10: 0,
        out11: 0,
        out12: 0,
        fro: 1.0,
        feed: 0.0,
        job: null,
        info: null,
        unit: null,
        line: null,
        nb_lines: null,
        auth: false,
        hideKeypad: false,
        hold: 0,
        inFeedHold: false,
        resumeFlag: false,
        quitFlag: false,
        targetHit: false,
        lastState: null,
        clientDisconnected: false,
    };

    this.fireButtonDebounce = false;
    this.APCollapseTimer = null;
    this.quit_pressed = 0;
    this.fireButtonPressed = 0;
    this.info_id = 0;
    this.action = null;
    this.interlock_action = null; // Continuing to use this as interlock/lock flag after allowing mult interlock defs
    this.overrideLimit = false;
    this.pauseTimer = false;

    // Instantiate and connect to the G2 driver using the port specified in the constructor
    this.driver = new g2.G2();
    this.driver.on("error", function (err) {
        log.error(err);
    });

    this.driver.connect(
        control_path,
        function (err) {
            // Most of the setup of the machine happens here, AFTER we've successfully connected to G2
            if (err) {
                log.error(JSON.stringify(err));
                log.warn("Setting the disconnected state");
                this.die("An internal error has occurred. You must reboot your tool.");
                if (typeof callback === "function") {
                    return callback(new Error("No connection to G2"));
                } else {
                    return;
                }
            } else {
                this.status.state = "idle";
            }

            // Create runtimes for different functions/command languages
            this.gcode_runtime = new GCodeRuntime();
            this.sbp_runtime = new SBPRuntime();
            this.manual_runtime = new ManualRuntime();
            this.passthrough_runtime = new PassthroughRuntime();
            this.idle_runtime = new IdleRuntime();

            this.runtimes = [
                this.gcode_runtime,
                this.sbp_runtime,
                this.manual_runtime,
                this.passthrough_runtime,
                this.idle_runtime,
            ];

            // The machine only has one "active" runtime at a time.  When it's not doing anything else
            // the active runtime is the IdleRuntime (setRuntime(null) sets the IdleRuntime)
            this.setRuntime(
                null,
                function (err) {
                    if (err) {
                        typeof callback === "function" && callback(err);
                    } else {
                        this.driver.requestStatusReport(
                            function (result) {
                                if ("stat" in result) {
                                    switch (result.stat) {
                                        case g2.STAT_INTERLOCK:
                                        case g2.STAT_SHUTDOWN:
                                        case g2.STAT_PANIC:
                                            this.die("A G2 exception has occurred. You must reboot your tool.");
                                            break;
                                    }
                                }
                                typeof callback === "function" && callback(null, this);
                            }.bind(this)
                        );
                    }
                }.bind(this)
            );
        }.bind(this)
    );

    // If any of the axes in G2s configuration become enabled or disabled, we want to show or hide
    // them accordingly.  These change events happen even during the initial configuration load, so
    // right from the beginning, we will be displaying the correct axes.
    // And, Update status for client
    config.driver.on(
        "change",
        function (update) {
            ["x", "y", "z", "a", "b", "c"].forEach(
                function (axis) {
                    var mode = axis + "am";
                    var pos = "pos" + axis;
                    if (mode in update) {
                        if (update[mode] === 0) {
                            //log.debug("Disabling display for " + axis + " axis.");
                            delete this.status[pos];
                        } else {
                            //log.debug("Enabling display for " + axis + " axis.");
                            if (this.status[pos] === undefined) {
                                // Don't overwrite the position if it's already set
                                this.status[pos] = null;
                            }
                        }
                    }
                }.bind(this)
            );
            log.debug("G2 Driver change detected -- UPDATING STATUS");
            this.emit("status", this.status); // emit a status on any g2 driver change to deal with units, etc
        }.bind(this)
    );

    // This handler deals with inputs that are selected for special functions (authorize, ok, quit, etc)
    this.driver.on(
        "status",
        function (stat) {
            // First, update machine status from driver status (including transform check)
            this._updateStatusFromDriver(stat);
            
            var auth_input = "in" + config.machine.get("auth_input");
            var quit_input = "in" + config.machine.get("quit_input");
            var ap_input = "in" + config.machine.get("ap_input");

            // If you press a button to pause, you're not allowed to resume or quit for at least a second
            // (To eliminate the chance of a double-tap doing something you didn't intend.)
            if (this.status.state === "paused") {
                setTimeout(function () {
                    canQuit = true;
                    canResume = true;
                }, 1000);
            } else {
                canQuit = false;
                canResume = false;
            }

            // Handle okay and cancel buttons.
            // Auth = OK
            // Quit = Cancel
            // If okay/cancel
            if (auth_input === quit_input) {
                this.handleOkayCancelDual(stat, auth_input);
            } else {
                this.handleOkayButton(stat, auth_input);
                this.handleCancelButton(stat, quit_input);
            }

            // Other functions
            this.handleFireButton(stat, auth_input);
            this.handleAPCollapseButton(stat, ap_input);
            this.status.clientDisconnected = global.CLIENT_DISCONNECTED;
            
            // Note: _updateStatusFromDriver already emitted the status, 
            // so we don't need to emit it again here
        }.bind(this)
    );
}
util.inherits(Machine, events.EventEmitter);

// Given the status report provided and the specified input, perform the AP Mode Collapse behavior if necessary
// The AP mode collapse is a network failsafe.  In the case that a tool gets "lost" on a network, it can be
// provoked back into AP mode by holding down a specific button for some time.  Both the input to use for the
// button and the hold-down duration are specified in the machine settings
Machine.prototype.handleAPCollapseButton = function (stat, ap_input) {
    // If the button has been pressed
    if (stat[ap_input] & 1) {
        var ap_collapse_time = config.machine.get("ap_time");
        // For the first time
        if (!this.APCollapseTimer) {
            // Do an AP collapse in ap_collapse_time seconds, if the button is never released
            log.debug("Starting a timer for AP mode collapse (AP button was pressed)");
            this.APCollapseTimer = setTimeout(
                function APCollapse() {
                    log.info("AP Collapse button held for " + ap_collapse_time + " seconds.  Triggering AP collapse.");
                    this.APCollapseTimer = null;
                    updater.APModeCollapse();
                }.bind(this),
                ap_collapse_time * 1000
            );
        }
    }
    // Otherwise
    else {
        // Cancel an AP collapse that is pending, if there is one.
        if (this.APCollapseTimer) {
            log.debug("Cancelling AP collapse (AP button was released)");
            clearTimeout(this.APCollapseTimer);
            this.APCollapseTimer = null;
        }
    }
};

// Given the status report and specified input, process the okay/cancel behavior
// This function is called only when the ok button (authorize) and cancel button (quit)
// are assigned to the same input.  The behavior in that case is slightly
// different than if they were separate. (see below)
Machine.prototype.handleOkayCancelDual = function (stat, quit_input) {
    //this may be changed to user select wether to continue or to cancel
    if (!(stat[quit_input] & 1) && this.status.state === "paused" && canQuit && this.quit_pressed) {
        log.info("Cancel hit!");
        this.quit(function (err, msg) {
            if (err) {
                log.error(err);
            } else {
                log.info(msg);
            }
        });
    } else if (this.status.state === "interlock" && this.quit_pressed) {
        log.info("Okay hit, resuming from interlock");
        this.resume(function (err, msg) {
            if (err) {
                log.error(err);
            } else {
                log.info(msg);
            }
        });
    } else if (this.status.state === "lock" && this.quit_pressed) {
        log.info("Okay hit, resuming from lock");
        this.resume(function (err, msg) {
            if (err) {
                log.error(err);
            } else {
                log.info(msg);
            }
        });
    } else if (this.status.state === "limit" && this.quit_pressed) {
        log.info("Okay hit, resuming and over-riding from limit");
        this.resume(function (err, msg) {
            if (err) {
                log.error(err);
            } else {
                log.info(msg);
            }
        });
    }
    this.quit_pressed = stat[quit_input] & 1;
};

// Given the status report and specified input, process the "fire" behavior
// The machine has a state of being "armed" - either with an action, or when preparing to
// go into an authorized state.  Pressing "fire" while armed either executes the action, or
// puts the system in an authorized state for the authorization period.
Machine.prototype.handleFireButton = function (stat, auth_input) {
    if (this.fireButtonPressed && !(stat[auth_input] & 1) && this.status.state === "armed") {
        log.info("FIRE button hit!");
        this.fire();
    }
    this.fireButtonPressed = stat[auth_input];
};

// Given the status report and specified input process the "okay" behavior
// Hitting the "okay" button on the machine essentially causes it to behave as if you had
// hit the okay/resume in the dashboard UI.  It is a convenience that prevents you from
// having to return to the dashboard just to confirm an action at the tool.
Machine.prototype.handleOkayButton = function (stat, auth_input) {
    if (stat[auth_input] & 1) {
        if (clickDisabled) {
            log.info("Can't hit okay now");
            return;
        }

        if (this.status.state === "paused" && canResume) {
            log.info("Okay hit, resuming from pause");
            this.resume(function (err, msg) {
                if (err) {
                    log.error(err);
                } else {
                    log.info(msg);
                }
            });
            clickDisabled = true;
            setTimeout(function () {
                clickDisabled = false;
            }, 2000);
        } else if (this.status.state === "interlock") {
            log.info("Okay hit, resuming from interlock");
            this.resume(function (err, msg) {
                if (err) {
                    log.error(err);
                } else {
                    log.info(msg);
                }
            });
        } else if (this.status.state === "lock") {
            log.info("Okay hit, resuming from lock");
            this.resume(function (err, msg) {
                if (err) {
                    log.error(err);
                } else {
                    log.info(msg);
                }
            });
        }
    }
};

Machine.prototype.handleCancelButton = function (stat, quit_input) {
    if (stat[quit_input] & 1 && this.status.state === "paused" && canQuit) {
        log.info("Cancel hit!");
        this.quit(function (err, msg) {
            if (err) {
                log.error(err);
            } else {
                log.info(msg);
            }
        });
    }
};

/*
 * State Functions
 */
Machine.prototype.die = function (err_msg) {
    this.setState(this, "dead", {
        error: err_msg || "A G2 exception has occurred. You must reboot your tool.",
    });
    this.emit("status", this.status);
};

// This function restores the driver configuration to what is stored in the g2 configuration on disk
// It is typically used after, for instance, a running file has altered the configuration in memory.
// This is used to ensure that when the machine returns to idle the driver is in a "known" configuration
//Machine.prototype.restoreDriverState =  async function (callback) {
Machine.prototype.restoreDriverState = function (callback) {
    this.driver.setUnits(
        config.machine.get("units"),
        function () {
            this.driver.requestStatusReport(
                function (status) {
                    for (var key in this.status) {
                        if (key in status) {
                            this.status[key] = status[key];
                        }
                    }
                    log.debug("Restoring G2 from disk cache after run ...");
                    config.driver.restore(function () {
                        if (callback) {
                            callback();
                        }
                    });
                }.bind(this)
            );
        }.bind(this)
    );
};

//This is a decision making function for the arm function. It tells arm the next action to fire.
//If machine object properties are influenced, they are stored in the result_arm_object and
//returned to the arm function along with the next action. if an error should be thrown the error
// is placed in the result_obj and the next action is set to 'throw'.
// Note parameters that are simply read and modified as part of the decision making are suffixed with "_in"
//      parameters that are returned with new values to be used by the caller are suffixed with "_io"
function decideNextAction(
    require_auth_in,
    current_state_in,
    driver_status_interlock_in,
    interlock_required_io,
    interlock_action_io,
    driver_status_inFeedHold,
    current_action_io,
    bypass_in
) {
    let result_arm_obj = {
        interlock_required: null,
        interlock_action: null,
        current_action: null,
        next_action: null,
        error_thrown: null,
    };
    switch (current_state_in) {
        case "idle":
            result_arm_obj["interlock_action"] = current_action_io;
            break;
        case "limit":
            if (driver_status_inFeedHold === true) {
                // handle lock/interlock after software pause; in FeedHold
                result_arm_obj["interlock_action"] = current_action_io;
            } else {
                result_arm_obj["current_action"] = interlock_action_io || current_action_io;
            }
            break;
        case "lock":
        case "interlock":
            if (driver_status_inFeedHold === true) {
                // handle lock/interlock after software pause; in FeedHold
                result_arm_obj["interlock_action"] = current_action_io;
            } else {
                result_arm_obj["current_action"] = interlock_action_io || current_action_io;
            }
            break;
        case "manual":
            if (
                current_action_io == null ||
                (current_action_io.type == "runtimeCode" && current_action_io.payload.name == "manual")
            ) {
                break;
            }
            result_arm_obj["error_thrown"] = new Error(
                "Cannot arm machine for " + current_action_io.type + " from the manual state"
            );
            break;
        case "paused":
        case "stopped":
            if (current_action_io.type === "resume" && driver_status_inFeedHold === false) {
                require_auth_in = false;
            } // Rules out Auth request on Timed Pause; no FeedHold
            if (current_action_io.type != "resume") {
                result_arm_obj["error_thrown"] = new Error(
                    "Cannot arm the machine for " + current_action_io.type + " when " + current_state_in
                );
            }
            break;
        default:
            result_arm_obj["error_thrown"] = new Error(
                "Cannot arm the machine from the " + current_state_in + " state."
            );
            break;
    }

    if ((current_action_io && current_action_io.payload && current_action_io.payload.name === "manual") || bypass_in) {
        result_arm_obj["interlock_required"] = false;
    }

    // Record correct action to take, start with cases that abort action
    if (result_arm_obj["error_thrown"]) {
        result_arm_obj["next_action"] = "throw";
        return result_arm_obj;
    }
    if (interlock_required_io && driver_status_interlock_in) {
        result_arm_obj["next_action"] = "abort_due_to_interlock";
        return result_arm_obj;
    }

    // Now we decide what the next action should be if we haven't already aborted for some reason

    if (current_action_io && current_action_io.payload && current_action_io.payload.name === "manual") {
        var cmd = current_action_io.payload.code.cmd;
        if (cmd == "set" || cmd == "exit" || cmd == "start" || cmd == "fixed" || cmd == "stop" || cmd == "goto") {
            result_arm_obj["next_action"] = "fire";
            return result_arm_obj;
        }
    }
    if (result_arm_obj["next_action"] == "abort_due_to_interlock") {
        return result_arm_obj;
    }
    if (require_auth_in) {
        result_arm_obj["next_action"] = "set_state_and_emit";
    } else {
        result_arm_obj["next_action"] = "fire";
    }
    return result_arm_obj;
}

//This function sets the timeout and records the state we were in before arming.
//That way we can fall back to it if the timer runs out.
function recordPriorStateAndSetTimer(thisMachine, armTimeout, status) {
    if (thisMachine._armTimer) {
        clearTimeout(thisMachine._armTimer);
    }

    thisMachine._armTimer = setTimeout(
        function () {
            log.info("Arm timeout (" + armTimeout + "s) expired.");
            thisMachine.disarm();
        }.bind(thisMachine),
        armTimeout * 1000
    );

    // The info object contains any dialogs that are displayed in the dash.
    delete thisMachine.status.info;
    thisMachine.preArmedInfo = null;
    // we may need to return to the prior state if the timer pops to disarm.
    thisMachine.preArmedState = status;
}

// Before beginning or resuming any runtime action also check for "locking/interlocking" inputs that may be ACTIVE
// Locking/Interlocking Inputs are inputs defined as Stop(stop), FastStop(faststop), Interlock(interlock), or Limit(limit)
// These inputs are fucntionally similar as they produce a feedhold in G2 when effected, BUT they have different user displays and for LIMIT
// a different follow-on action -- so they are distinct for FabMo vs G2 (G2 has some similar functions we do not use because of conflicts)
// Input definitions are stored in machine.json and = "machine: di#ac" in the configuration tree
// ... but these input defs also need to be passed to G2 as current di#ac settings for feedhold (and variations)
// TABLE:
// interlock
// --state--  --action--  --locking?--     --message   --G2 di#ac settings (digital input actions)
//           -  (none)          -             -               0
//    stop   -  Stop           YES          Stop ON           1   [feedhold]
// faststop  -  FastStop       YES          Stop ON           2   [feedhold w/HiJerk] *not implemented in G2 yet ???
// interlock -  Interlock      YES        Interlock ON        1   [feedhold]
//    limit  -  Limit          YES         Limit Hit          1   [feedhold]
//  hardstop -  ImmediateStop   NO             -              3   [feedhold instant] *not implemented in G2 yet; to be used for OpenSBP "Interrupt"

// We check for interlock state before any action that ARMS tool for action and with any general change in state
function checkForInterlocks(thisMachine, action) {
    let getInterlockState = "";
    for (let pin = 1; pin < 13; pin++) {
        let checkAssignedInput = config.machine.get("di" + pin + "ac");
        // Check assignedInput for "none" in letters of any case; then set value to ""
        if (checkAssignedInput) {
            if (checkAssignedInput.toLowerCase() === "none") {
                checkAssignedInput = "";
            }
        }
        // If an "assigned" input pin is active, Set InterlockState to assigned action
        // ... if more than one, highest priority will be assigned to InterlockState
        // ... currently that is "stop" < "interlock" < "limit" ; This is where an INPUT gets LABELED
        // Related: If an input assigned to an interlock function is then selected for Probing [P*] in the opensbp runtime
        //      - for the case of Limit, the interlock function will be disabled for the duration of the probing and
        //         ... in G2, feedholds are automatically overridden during probing
        //         ... in the Dashboard, for this case the Limit messages will not be displayed (managed in fabmoui.js)
        //      - for the case of Stop, Faststop or Interlock, the opensbp runtime should generate an error with explanation
        if (checkAssignedInput) {
            if (thisMachine.driver.status["in" + pin]) {
                getInterlockState = checkAssignedInput;
            }
        }
    }
    // When overrideLimit true and starting in manual, clear interlock state to produce override; one time only
    if (thisMachine.overrideLimit === true) {
        if (action?.payload?.name) {
            // if an action is defined
            if (action.payload.name === "manual") {
                getInterlockState = "";
                if (action.payload.code === "exit") {
                    thisMachine.overrideLimit = false; // clear overrideLimit on exiting manual
                }
            }
        }
    }
    return getInterlockState;
}

// "Arm" the machine with the specified action. The armed state is abandoned after the timeout expires.
//  The "Interlocked" or "locked" status of an input is checked at start of this process
//   action - The action to execute when fire() is called.  Can be null.
//            If null, the action will be to "authorize" the tool for subsequent actions for the authorization
//            period which is specified in the settings.
//   timeout - The number of seconds that the system should remain armed
Machine.prototype.arm = function (action, timeout) {
    // It's a real finesse job to get authorize to play nice with interlock, etc. ...auth:R.Sturmer
    var requireAuth = config.machine.get("auth_required");

    var interlockRequired = true; // ... hard coded here; may need to manipulate at some point (no longer in configs)
    let isInterlocked = checkForInterlocks(this, action); // check switches before arming

    var nextAction = null;
    let arm_obj = decideNextAction(
        requireAuth,
        this.status.state,
        isInterlocked,
        interlockRequired,
        this.interlock_action,
        this.status.inFeedHold,
        action,
        interlockBypass
    );
    // Implement side-effects that the result obj has returned so state is set correctly:
    if (arm_obj["interlock_required"]) {
        interlockRequired = arm_obj["interlock_required"];
    }
    if (arm_obj["interlock_action"]) {
        this.interlock_action = arm_obj["interlock_action"];
    }
    if (arm_obj["current_action"]) {
        action = arm_obj["current_action"];
    }
    if (arm_obj["next_action"]) {
        nextAction = arm_obj["next_action"];
    }

    this.action = action;
    log.info("ARMING the machine" + (action ? " for " + action.type : "(No action)"));

    switch (nextAction) {
        case "throw":
            throw arm_obj["error_thrown"];

        case "abort_due_to_interlock":
            if (isInterlocked === "limit") {
                this.setState(this, "limit");
            } else if (isInterlocked === "interlock") {
                this.setState(this, "interlock");
            } else if (isInterlocked === "stop") {
                this.setState(this, "lock");
            }
            return;
        case "fire":
            log.info("FIRING automatically since authorization is disabled.");
            recordPriorStateAndSetTimer(this, timeout, this.status.state);
            this.fire(true);
            return;
        case "set_state_and_emit":
            recordPriorStateAndSetTimer(this, timeout, this.status.state);
            this.setState(this, "armed");
            this.emit("status", this.status);
            return;
        default:
            throw new Error("Unknown case");
    }
};

// Collapse out of the armed state.  Happens when the user hits cancel in the authorize dialog.
Machine.prototype.disarm = function () {
    if (this._armTimer) {
        clearTimeout(this._armTimer);
    }
    this.action = null;
    this.fireButtonDebounce = false;
};

// Execute the action in the chamber (the one passed to the arm() method)
Machine.prototype.fire = function (force) {
    if (this.fireButtonDebounce & !force) {
        log.debug("Fire button debounce reject.");
        log.debug("debounce: " + this.fireButtonDebounce + " force: " + force);
        return;
    }
    this.fireButtonDebounce = true;

    // Clear the timers related to authorization
    // (since we're either going to execute this thing or bounce, those will need to be reset)
    if (this._armTimer) {
        clearTimeout(this._armTimer);
    }
    if (this._authTimer) {
        clearTimeout(this._authTimer);
    }

    if (this.status.state != "armed" && !force) {
        throw new Error("Cannot fire: Not armed.");
    }

    // If no action, we're just authorizing for the next auth timeout
    if (!this.action) {
        this.authorize(config.machine.get("auth_timeout"));
        this.setState(this, "idle");
        return;
    }

    // We deauthorize the machine as soon as we're executing an action
    // that way, when the action is concluded, the user has to reauthorize again.
    // TODO - re-evaluate this decision.  The idea here is that once an action is kicked off, once it's
    //        completed there's a good chance that the user might not be close to the machine anymore.
    //        many actions take less than the authorization timeout, though, so in those cases, this causes
    //        incessant authorization prompts.
    this.deauthorize();

    var action = this.action;
    this.action = null;

    // Actually execute the action (finally!)
    switch (action.type) {
        case "nextJob":
            this._runNextJob(force, function () {});
            break;

        case "runtimeCode":
            var name = action.payload.name;
            var code = action.payload.code;
            this._executeRuntimeCode(name, code);
            break;

        case "runFile":
            var filename = action.payload.filename;
            this._runFile(filename);
            break;

        case "resume":
            this._resume(action.input);
            break;
    }
};

// Authorize the machine for the specified period of time (or the default time if unspecified)
Machine.prototype.authorize = function (timeout) {
    timeout = timeout || config.machine.get("auth_timeout");

    if (config.machine.get("auth_required") && timeout) {
        log.info("Machine is authorized for the next " + timeout + " seconds.");
        if (this._authTimer) {
            clearTimeout(this._authTimer);
        }
        this._authTimer = setTimeout(
            function () {
                log.info("Authorization timeout (" + timeout + "s) expired.");
                this.deauthorize();
            }.bind(this),
            timeout * 1000
        );
    } else {
        if (!this.status.auth) {
            log.info("Machine is authorized indefinitely.");
        }
    }
    this.status.auth = true;

    // Once authorized, clear info (which contains the auth message)
    if (this.status.info && this.status.info.auth) {
        delete this.status.info;
    }

    // Report status back to the host (since the auth state has changed)
    this.emit("status", this.status);
};

// Clear the authorized state (forbid action without a reauthorize)
Machine.prototype.deauthorize = function () {
    if (!config.machine.get("auth_timeout")) {
        return;
    }
    if (this._authTimer) {
        clearTimeout(this._authTimer);
    }
    log.debug("Machine is deauthorized.");
    this.status.auth = false;
};

Machine.prototype.isConnected = function () {
    return this.status.state !== "not_ready" && this.status.state !== "dead";
};

Machine.prototype.disconnect = function (callback) {
    this.driver.disconnect(callback);
};

Machine.prototype.toString = function () {
    return "[Machine Model on '" + this.driver.path + "']";
};

// Run the provided Job object (see db.js)
Machine.prototype.runJob = function (job) {
    db.File.getByID(
        job.file_id,
        function (err, file) {
            if (err) {
                // TODO deal with no file found
            } else {
                log.info("Running file " + file.path);
                this.status.job = job;
                this._runFile(file.path);
            }
        }.bind(this)
    );
};

// Set the preferred units to the provided value ('in' or 'mm')
// Changing the preferred units is a heavy duty operation. See below.
Machine.prototype.setPreferredUnits = async function (units, lastunits, callback) {
    let callbackCalled = false; // Flag to track if callback has been called

    const safeCallback = (err) => {
        if (!callbackCalled && callback) {
            callbackCalled = true;
            callback(err);
        }
    };

    try {
        // check to see whether the driver has a changeUnits argument that = null or undefined and if so, skip the change
        if (lastunits !== units && config.driver.changeUnits) {
            units = u.unitType(units); // Normalize units
            var uv = null;
            switch (units) {
                case "in":
                    log.info("Changing default units to INCH");
                    uv = 0;
                    break;

                case "mm":
                    log.info("Changing default units to MM");
                    uv = 1;
                    break;

                default:
                    log.warn('Invalid units "' + units + '" found in machine configuration.');
                    break;
            }
            if (uv !== null) {
                // Wrap asynchronous operations in a Promise to get updated G2 position dispaly at right time
                await new Promise((resolve, reject) => {
                    config.driver.changeUnits(
                        uv,
                        function () {
                            log.info("Done setting driver units");

                            async.eachSeries(
                                this.runtimes,
                                function runtime_set_units(item, callback) {
                                    log.info("Setting preferred units for " + item);
                                    if (item.setPreferredUnits) {
                                        return item.setPreferredUnits(uv, callback);
                                    }
                                    callback();
                                }.bind(this),
                                function (err) {
                                    if (err) {
                                        reject(err);
                                    } else {
                                        log.debug("All runtimes have set units.");
                                        resolve();
                                    }
                                }
                            );
                        }.bind(this)
                    );
                });
                // After all async operations complete, trigger the update
                log.debug("Triggering machine position update after all configurations.");
                this.driver.updateMachinePosition();
            } else {
                safeCallback(null);
            }
        } else {
            safeCallback(null);
        }
        this.emit("status", this.status); // emit a status change
    } catch (e) {
        log.warn("Couldn't access driver configuration...");
        log.error(e);
        try {
            this.driver.setUnits(uv);
        } catch (e) {
            safeCallback(e);
        }
    }
    safeCallback(null);
};

// Retrieve the G-Code output for a specific file ID.
// If the file is a g-code file, just return its contents.
// If the file is a shopbot file, instantiate a SBPRuntime, run it in simulation, and return the result
Machine.prototype.getGCodeForFile = function (filename, callback) {
    var ext = null;
    fs.readFile(
        filename,
        "utf8",
        function (err, data) {
            if (err) {
                log.error("Error reading file " + filename);
                log.error(err);
                return;
            } else {
                ext = path.extname(filename).toLowerCase();

                if (ext == ".sbp") {
                    /*
				if(this.status.state != 'idle') {
					return callback(new Error('Cannot generate G-Code from OpenSBP while machine is running.'));
				}*/

                    //this.setRuntime(null, function() {});

                    // Because preview is not a real runtime, we need to insert and track start points for SBP commands
                    var tx = this.driver.status.posx;
                    var ty = this.driver.status.posy;
                    var tz = this.driver.status.posz;
                    new SBPRuntime().simulateString(data, tx, ty, tz, callback);
                } else {
                    fs.readFile(filename, callback);
                }
            }
        }.bind(this)
    );
};

// Run a file given a filename on disk.  Choose the runtime that is appropriate for that file.
Machine.prototype._runFile = function (filename) {
    var ext = path.extname(filename).toLowerCase();

    // Set the user-friendly filename from the job object, if available
    if (this.status.job && this.status.job.name) {
        // Job name is the user-friendly name (e.g., "test36.sbp")
        // Don't overwrite if runtime has already set it
        if (!this.sbp_runtime.currentFilename && !this.gcode_runtime.currentFilename) {
            if (ext === ".sbp") {
                this.sbp_runtime.currentFilename = this.status.job.name;
            } else {
                this.gcode_runtime.currentFilename = this.status.job.name;
            }
        }
    }

    // Choose the appropriate runtime based on the file extension
    var runtime = this.gcode_runtime;
    if (ext === ".sbp") {
        runtime = this.sbp_runtime;
    }

    // Set the appropriate runtime
    this.setRuntime(runtime, function (err, runtime) {
        if (err) {
            return log.error(err);
        }
        runtime.runFile(filename);
    });
};

// Set the active runtime
// If the selected runtime is different than the current one,
// disconnect the current one, and connect the new one.
Machine.prototype.setRuntime = function (runtime, callback) {
    runtime = runtime || this.idle_runtime;
    try {
        if (runtime) {
            if (this.current_runtime != runtime) {
                if (this.current_runtime) {
                    this.current_runtime.disconnect();
                }
                this.current_runtime = runtime;
                runtime.connect(this);
                global.CUR_RUNTIME = runtime;
            }
        } else {
            this.current_runtime = this.idle_runtime;
            this.current_runtime.connect(this);
        }
    } catch (e) {
        log.error(e);
        setImmediate(callback, e);
    }
    setImmediate(callback, null, runtime);
};

// Return a runtime object given a name
// TODO - these names should be properties of the runtimes themselves, and we should look-up that way
//        (cleaner and better compartmentalized)
Machine.prototype.getRuntime = function (name) {
    switch (name) {
        case "gcode":
        case "nc":
        case "g":
            this.overrideLimit = false;
            return this.gcode_runtime;
        case "opensbp":
        case "sbp":
            this.overrideLimit = false;
            return this.sbp_runtime;
        case "manual":
            return this.manual_runtime;
        default:
            this.overrideLimit = false;
            return null;
    }
};

// Change the overall machine state
// source - The runtime requesting the change
// newstate - The state to transition to
// stateinfo - The contents of the 'info' field of the status report, if needed.
Machine.prototype.setState = function (source, newstate, stateinfo) {
    var details_newstate = newstate;
    this.fireButtonDebounce = false;
    if (source === this || source === this.current_runtime) {
        // Set the info field
        // status.info.id is the info field id - it helps the dash with display of dialogs
        if (stateinfo) {
            this.status.info = stateinfo;
            this.info_id += 1;
            this.status.info.id = this.info_id;
        } else {
            // If the info field is unspecified, we clear the one that's currently in place
            delete this.status.info;
        }

        switch (newstate) {
            case "idle":
                // Beginning a change to the idle state:
                // Go ahead and request the current machine position and write it to disk. This
                // ... is done regularly, so that if the machine is powered down it retains the current position
                if (this.status.quitFlag === true && this.current_runtime === this.manual_runtime) {
                    this.current_runtime.executeCode({ cmd: "exit" });
                } else {
                    switch (this.status.state) {
                        case "limit":
                        case "interlock":
                        case "lock":
                            log.debug("Initially skip cases of input-hit processing");
                            break;
                        default:
                            // [We should be in some state other than idle, but allow redundancy
                            // ... for a few cases such as coming out of probing on Stop input]
                            log.debug("... otherwise send final lines from machine");
                            this.driver.command({ out4: 0 }); // Permissive relay
                            this.driver.command({ gc: "m30" }); // Generate End
                            log.debug("call MPO from machine");
                            this.driver._primed = false; // * important to clear for unusual endings
                            this.driver.resumePending = false; // * important to clear for unusual endings
                            this.driver.get("mpo", function (err, mpo) {
                                if (config.instance) {
                                    config.instance.update({
                                        position: mpo,
                                    });
                                }
                            });
                            if (this.current_runtime != this.idle_runtime) {
                                this.setRuntime(null, function () {});
                            }
                            if (this.status.state === "manual") {
                                this.overrideLimit = false; // remove any temporary limit override
                            }
                            if (this.status.state === "probing") {
                                log.debug("Handle case of disrupted probe");
                                // this.status.quitFlag = true;
                            }
                    }
                    if (this.status.state === "manual") {
                        this.overrideLimit = false; // remove any temporary limit override
                    }
                }

                // Clear the fields that describe a running job
                this.status.nb_lines = null;
                this.status.line = null;

                // TODO - What's going on here?
                if (this.action) {
                    switch (this.action.type) {
                        case "nextJob":
                            break;
                        default:
                            this.authorize();
                            break;
                    }
                }
                this.action = null;

                break;
            case "paused":
                if (this.status.state != newstate) {
                    //set driver in paused state
                    this.driver.pause_hold = true;
                    // Save the position to the instance configuration.  See note above.
                    this.driver.get("mpo", function (err, mpo) {
                        if (config.instance) {
                            config.instance.update({ position: mpo });
                        }
                    });
                    // On a PAUSE (hold) check for specific input actions (stops and interlocks)
                    // Set a more detailed state processing for user displays and limit overrides
                    // ... will be immediately re-processed through here
                    var interlockRequired = true; // ... hard coded here; may need to manipulate at some point (no longer in configs)
                    let isInterlocked = checkForInterlocks(this); // check switches when setting machine state (parallels arming)
                    if (interlockRequired && isInterlocked && !interlockBypass) {
                        this.interlock_action = null;
                        this.driver.ok_to_disconnect = true;
                        switch (isInterlocked) {
                            case "limit":
                                details_newstate = "limit";
                                break;
                            case "interlock":
                                details_newstate = "interlock";
                                break;
                            case "stop":
                                details_newstate = "lock";
                                break;
                        }
                    }
                }
                break;
            case "running":
            case "limit":
            case "lock":
            case "interlock":
                this.status.resumeFlag = false;
                break;
            case "dead":
                this.status.out4 = 0;
                log.error("G2 is dead!");
                break;
            default:
                break;
        }

        this.status.lastState = this.status.state;
        newstate = details_newstate;
        this.status.state = newstate;
    } else {
        log.warn("Got a state change from a runtime that's not the current one. (" + source + ")");
    }
    this.emit("status", this.status); // ##==> Emit STATUS REPORT // primary; also from runtimes

    if (this.status.info && this.status.info["timer"]) {
        this.pauseTimer = setTimeout(
            function () {
                this.resume(function (err, msg) {
                    if (err) {
                        log.error(err);
                    } else {
                        log.info(msg);
                    }
                });
                this.pauseTimer = false;
                this.driver.resumePending = false;
            }.bind(this),
            this.status.info["timer"] * 1000
        );
    }
};


// // Pause the machine
// Machine.prototype.pause = function (callback) {
//     log.debug("====> Machine.pause() called, current state: " + this.status.state);
//     log.debug("====> pauseTimer exists: " + !!this.pauseTimer);
//     log.debug("====> current_runtime: " + (this.current_runtime ? this.current_runtime.toString() : "none"));
    
//     if (this.status.state === "running" || this.status.state === "probing") {
//         if (this.current_runtime) {
//             log.debug("====> Handling .pause in Machine, to cur_runtime.pause()");
            
//             // Clear pauseTimer if it exists (handles early Stop during file start)
//             if (this.pauseTimer) {
//                 log.debug("====> Clearing pauseTimer during running->pause transition");
//                 clearTimeout(this.pauseTimer);
//                 this.pauseTimer = false;
//             }
            
//             this.current_runtime.pause();
//             callback(null, "paused");
//         } else {
//             callback("Not pausing because no runtime provided");
//         }
//     } else if (this.status.state === "paused") {
//         // Already paused - just clear the timer if present
//         // DO NOT call setState() as that creates the center modal
//         if (this.pauseTimer) {
//             log.debug("====> User Stop during timed pause - clearing timer only");
//             clearTimeout(this.pauseTimer);
//             this.pauseTimer = false;
//             // Just emit status without changing state
//             // This allows the dashboard to show the footer modal
//             this.emit("status", this.status);
//         }
//         callback(null, "paused");
//     } else {
//         log.debug("====> Not pausing, state is: " + this.status.state);
//         callback("Not pausing because machine is not running");
//     }
// };

// Pause the machine
Machine.prototype.pause = function (callback) {
    if (this.status.state === "running" || this.status.state === "probing") {
        if (this.current_runtime) {
            log.debug("====> Handling .pause in Machine, to cur_runtime.pause()");
            this.current_runtime.pause();
            callback(null, "paused");
        } else {
            callback("Not pausing because no runtime provided");
        }
    } else if (this.status.state === "paused") {
        //clear any timed pause
        if (this.pauseTimer) {
            clearTimeout(this.pauseTimer);
            this.pauseTimer = false;
            this.setState(this, "paused", { message: "Paused in a 'Pause' programmed in your file" });
        } else {
            this.current_runtime.pause();
        }
        callback(null, "paused");
    } else {
        callback("Not pausing because machine is not running");
    }
};

// Quit
Machine.prototype.quit = function (callback) {
    // Release Pause hold if present
    this.driver.pause_hold = false;
    this.status.inFeedHold = false;
    this.status.resumeFlag = false;
    this.status.quitFlag = true;
    if (this.pauseTimer) {
        clearTimeout(this.pauseTimer);
        this.pauseTimer = false;
    }
    this.disarm();

    // Quitting from the idle state dismisses the 'info' data
    switch (this.status.state) {
        case "idle":
            delete this.status.info;
            this.status.quitFlag = false;
            this.emit("status", this.status);
            break;

        case "interlock":
            this.action = null;
            this.setState(this, "idle");
            break;

        case "lock":
            this.action = null;
            this.setState(this, "idle");

            break;

        case "limit":
            this.overrideLimit = true; ////## Only place that override is set; as user has selected QUIT
            this.action = null;
            this.setState(this, "idle");
            break;

        case "armed":
            this.action = null;
            this.setState(this, "idle");
            break;
    }
    // Cancel the currently running job, if there is one
    if (this.status.job) {
        this.status.job.pending_cancel = true;
    }
    if (this.current_runtime) {
        log.info("Quitting the current runtime...");
        this.status.quitFlag = false;
        this.current_runtime.quit();
        if (callback) {
            callback(null, "quit");
        }
    } else {
        log.warn("No current runtime!");
        if (callback) {
            callback("Not quiting because no current runtime");
        }
    }
};

// Resume from the paused state (during the resume process, a nested feedhold may occur)
Machine.prototype.resume = function (callback, input = false) {
    if (this.driver.pause_hold) {
        //Release driver pause hold
        this.driver.pause_hold = false;
    }

    //clear any timed pause
    if (this.pauseTimer) {
        clearTimeout(this.pauseTimer);
        this.pauseTimer = false;
    }
    this.arm(
        {
            type: "resume",
            input: input,
        },
        config.machine.get("auth_timeout")
    );
    if (callback) {
        callback(null, "resumed");
    } else {
        this.driver.resumePending = false; // * important to clear for multiple stackbreaks
        this.status.hold = 0  // maybe redundant with g2core?
        this.emit("status", this.status);
        log.debug("Undefined callback passed to resume; cleared .resumePending");
    }
};

// Run a file from disk
// filename - full path to the file to run
Machine.prototype.runFile = function (filename, bypassInterlock) {
    interlockBypass = bypassInterlock;
    if (!bypassInterlock) {
        interlockBypass = false;
    }
    this.arm(
        {
            type: "runFile",
            payload: {
                filename: filename,
            },
        },
        config.machine.get("auth_timeout")
    );
};

// Run the next job in the queue
// callback is called when the tool is armed for the run, NOT when the job is complete.
Machine.prototype.runNextJob = function (callback) {
    interlockBypass = false;
    db.Job.getPending(
        function (err, pendingJobs) {
            if (err) {
                return callback(err);
            }
            if (pendingJobs.length > 0) {
                this.arm(
                    {
                        type: "nextJob",
                    },
                    config.machine.get("auth_timeout")
                );
                callback();
            } else {
                callback(new Error("No pending jobs."));
            }
        }.bind(this)
    );
};

// Executes a "code" on a specific runtime.
// runtimeName - the name of a valid runtime
//        code - can be anything, it is runtime specific.
//               example: if you pass gcode to the gcode runtime, it runs g-code.
Machine.prototype.executeRuntimeCode = function (runtimeName, code) {
    interlockBypass = false;
    runtime = this.getRuntime(runtimeName);
    if (runtime === undefined) {
        log.debug("Rejecting attempt to execute runtime code with no defined runtime.");
        log.debug(JSON.stringify(code));
        return;
    }
    var needsAuth = runtime.needsAuth(code);
    if (needsAuth) {
        if (this.status.auth) {
            return this._executeRuntimeCode(runtimeName, code);
        } else {
            this.arm(
                {
                    type: "runtimeCode",
                    payload: {
                        name: runtimeName,
                        code: code,
                    },
                },
                config.machine.get("auth_timeout")
            );
        }
    } else {
        this._executeRuntimeCode(runtimeName, code);
    }
};

// Just run this SBP code immediately
// string - the code to run
Machine.prototype.sbp = function (string) {
    this.executeRuntimeCode("sbp", string);
};

// Just run this gcode immediately
// string - the gcode to run
Machine.prototype.gcode = function (string) {
    this.executeRuntimeCode("gcode", string);
};

// Handle loading and updating any machine accessories such as spindleVFD, etc (this called in the start sequence)
Machine.prototype.startAccessories = async function () {
    try {
        log.info("Initializing spindle system...");

        await spindle.loadVFDSettings();
        await spindle.connectVFD();

        // Setup spindle status listener
        spindle.on("statusChanged", (spindlestatus) => {
            this.status.spindle = spindlestatus;
            this.emit("status", this.status);
        });

        log.info("Spindle system ready");
    } catch (error) {
        // Spindle has already logged its own clean error message
        // Just ensure we have a listener for status updates
        spindle.on("statusChanged", (spindlestatus) => {
            this.status.spindle = spindlestatus;
            this.emit("status", this.status);
        });

        log.debug("Continuing without spindle functionality");
    }
};

// Machine.prototype.startAccessories = async function () {
//     try {
//         //const spindle = new Spin();
//         log.info("Spindle instance created:" + JSON.stringify(spindle));
//         // load VFD settings with wait and complete connection before listening for changes
//         await spindle.loadVFDSettings();
//         await spindle.connectVFD();
//         spindle.on("statusChanged", (spindlestatus) => {
//             log.info("EMIT New GLOBAL Spindle status : " + JSON.stringify(spindlestatus));
//             // add spindle status to global status object
//             this.status.spindle = spindlestatus;
//             this.emit("status", this.status);
//         });
//     } catch (error) {
//         //log.error("Failed to create a spindle connection:" + error);
//         log.error("Spindle RPM Failed as accessory.");
//     }
// };

// Set up the USB-drive checker
Machine.prototype.startUSBDriveManager = function () {
    this.usbDriveChecker = setInterval(() => {
        try {
            //log.debug("Checking for USB drive...");
            this.checkUSBDrive((err, drive) => {
                if (err) {
                    log.error("Error checking for USB drive: " + err);
                } else {
                    if (drive) {
                        //log.info("USB drive detected: " + drive);
                        this.status.usbDrive = drive;
                        this.emit("status", this.status);
                    } else {
                        //log.info("No USB drive detected.");
                        if (this.status.usbDrive) {
                            delete this.status.usbDrive;
                            this.emit("status", this.status); // Emit status to clear the USB drive
                        }
                    }
                }
            });
        } catch (error) {
            log.error("Exception while checking for USB drive: " + error);
        }
    }, 5000);
};

let drivePresenceReported = false;
let driveAbsenceReported = false;
// Function to determine if a USB drive is currently mounted on this Raspberry Pi server
Machine.prototype.checkUSBDrive = function (callback) {
    const usbMountPath = "/media"; // Base mount point for USB drives on Linux

    fs.readdir(usbMountPath, (err, entries) => {
        if (err) {
            log.error(`Error reading USB mount directory (${usbMountPath}): ${err.message}`);
            return callback(null, false); // No USB drive detected
        }

        // Filter out hidden files and directories (those starting with ".")
        const visibleEntries = entries.filter((entry) => !entry.startsWith("."));

        // Check each subdirectory under /media for USB drives with content
        const checkSubdirectories = (index) => {
            if (index >= visibleEntries.length) {
                if (!driveAbsenceReported) {
                    log.info("No USB drive with content detected.");
                    drivePresenceReported = false;
                    driveAbsenceReported = true;
                }
                return callback(null, false); // No USB drive with content found
            }

            const subdirectoryPath = path.join(usbMountPath, visibleEntries[index]);

            fs.readdir(subdirectoryPath, (err, subEntries) => {
                if (err || !subEntries || subEntries.length === 0) {
                    checkSubdirectories(index + 1);
                } else {
                    // Check each entry in the subdirectory for USB drives with content
                    const checkContent = (subIndex) => {
                        if (subIndex >= subEntries.length) {
                            // No valid USB drive found in this subdirectory, move to the next one
                            return checkSubdirectories(index + 1);
                        }

                        const usbDrivePath = path.join(subdirectoryPath, subEntries[subIndex]);

                        fs.readdir(usbDrivePath, (err, driveContents) => {
                            if (err || !driveContents || driveContents.length === 0) {
                                // If the drive is empty or inaccessible, check the next entry
                                checkContent(subIndex + 1);
                            } else {
                                // Found a USB drive with content
                                if (!drivePresenceReported) {
                                    log.info(`USB drive with content detected at: ${usbDrivePath}`);
                                    driveAbsenceReported = false;
                                    drivePresenceReported = true;
                                }
                                return callback(null, usbDrivePath);
                            }
                        });
                    };

                    checkContent(0); // Start checking entries in the subdirectory
                }
            });
        };

        checkSubdirectories(0); // Start checking subdirectories under /media
    });
};

// Directly set the spindle speed as an accessory (for use with any runtime)
// spindle speed / spindle RPM are currently limited HERE for command sent from DRO
//  and in tools.js for OpenSBP; typically the VFD itself will have its own smaller spread
Machine.prototype.spindleSpeed = function (new_RPM) {
    if (new_RPM >= 100 && new_RPM <= 30000) {
        try {
            log.info("----> new speed: " + new_RPM);
            spindle.setSpindleVFDFreq(new_RPM);
        } catch (error) {
            log.error("Failed to pass new RPM: " + error);
        }
    }
};


// Set a Feed Rate Override Request for injection into G2 "driver"
// ... handle this with a debounce type procedure so that the driver is not overwhelmed with commands and G2 has time to update
Machine.prototype.frOverride = function (new_override) {
    //log.info("====> frOverride called with: " + new_override);
    //log.info("====> Value check: " + (new_override >= 5 && new_override <= 300));
    //log.info("====> Driver state: pause_flag=" + this.driver.pause_flag + ", stat=" + this.driver.status.stat);
    
    if (new_override >= 5 && new_override <= 300) {
        try {
            log.info("----> new override CMD sent: " + new_override);
            // Set the new override value and format for the driver
            // ... I have tested several methods of this injection (including M101); this seems the most robust
            var cmd_to_G2 = "{fro:" + (new_override / 100).toFixed(2) + "}";
            //log.info("----> Formatted command: " + cmd_to_G2);
            //log.info("----> Command queue length before: " + this.driver.command_queue.getLength());
            this.driver.command(cmd_to_G2);
            //log.info("----> Command queue length after: " + this.driver.command_queue.getLength());
        } catch (error) {
            log.error("Failed to pass new Override: " + error);
        }
    } else {
        log.warn("====> Override value out of range: " + new_override);
    }
};

// UNUSED: Handle updating status on changes from opensbpConfig or elsewhere
// ... at some point we may need to watch other things, start something like this from engine.js start sequence
Machine.prototype.watchConfig = function () {
    // sbpConfig.on("configChanged", function (newConfig) {
    //     console.log("Configuration has changed:", newConfig);
    //     // Trigger a machine status update to clean up displays
    //     this.emit("status", this.status);
    // });
};

/*
 * ----------------------------------------------
 * Functions below require authorization to run
 * Don't call them unless the tool is authorized!
 * ----------------------------------------------
 *
 * For documentation of these functions, see their corresponding "public" methods above.
 */

Machine.prototype._executeRuntimeCode = function (runtimeName, code) {
    runtime = this.getRuntime(runtimeName);
    if (runtime) {
        if (this.current_runtime == this.idle_runtime) {
            this.setRuntime(
                runtime,
                function (err, runtime) {
                    if (err) {
                        log.error(err);
                    } else {
                        runtime.executeCode(code);
                    }
                }.bind(this)
            );
        } else {
            this.current_runtime.executeCode(code);
        }
    }
};

Machine.prototype._resume = function (input) {
    switch (this.status.state) {
        case "interlock":
            if (this.interlock_action && this.interlock_action.type != "resume") {
                this.arm(this.interlock_action);
                this.interlock_action = null;
                return;
            }
            break;
        case "lock":
            if (this.interlock_action && this.interlock_action.type != "resume") {
                this.arm(this.interlock_action);
                this.interlock_action = null;
                return;
            }
            break;
    }
    if (this.current_runtime) {
        this.current_runtime.resume(input);
    }
};

Machine.prototype._runNextJob = function (force, callback) {
    if (this.isConnected()) {
        if (this.status.state === "armed" || force) {
            log.info("Running next job");
            db.Job.dequeue(
                function (err, result) {
                    if (err) {
                        log.error(err);
                        callback(err, null);
                    } else {
                        log.info("Running job " + JSON.stringify(result));
                        this.runJob(result);
                        callback(null, result);
                    }
                }.bind(this)
            );
        } else {
            callback(new Error("Cannot run next job: Machine not idle"));
        }
    } else {
        callback(new Error("Cannot run next job: Driver is disconnected."));
    }
};

// Add transform warning to status
Machine.prototype._updateStatusFromDriver = function (status) {
    // Update the base status fields
    for (var key in status) {
        if (key in this.status) {
            this.status[key] = status[key];
        }
    }

    // Add transform warning to status
    // Check if any transforms are enabled
    try {
        var transforms = config.opensbp.get('transforms');
        if (transforms) {
            this.status.transformsEnabled = 
                transforms.rotate.apply ||
                transforms.scale.apply ||
                transforms.move.apply ||
                transforms.shearx.apply ||
                transforms.sheary.apply ||
                transforms.interpolate.apply ||
                transforms.level.apply ||
                false;
        } else {
            this.status.transformsEnabled = false;
        }
    } catch (e) {
        log.warn('Could not read transform state: ' + e);
        this.status.transformsEnabled = false;
    }
    
    // Emit the status with the new transform state
    this.emit("status", this.status);
};

exports.connect = connect;

//Any export below this line is for unit testing purposes only
exports.private_decideNextAction = decideNextAction;
