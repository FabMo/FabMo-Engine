/*
 * runtime/manual/index.js
 *
 * This module defines the ManualRuntime, which is the runtime used for interactive
 * control over the tool, such as would be used by a pendant, or interactive control app.
 */
var log = require("../../log").logger("manual");
var stream = require("stream");
var ManualDriver = require("./driver");

// TODO - member of the instance rather than global to this file?!
var currentCmd;

// ManualRuntime constructor
function ManualRuntime() {
    this.machine = null;
    this.driver = null;
    this.fixedQueue = [];
}

ManualRuntime.prototype.toString = function () {
    return "[ManualRuntime]";
};

// pass through function for compatibility with opensbp runtime
// eslint-disable-next-line no-unused-vars
ManualRuntime.prototype.needsAuth = function (s) {
    return true;
};

ManualRuntime.prototype.connect = function (machine) {
    this.machine = machine;
    this.driver = machine.driver;
    this.ok_to_disconnect = true;

    // True while the tool is known to be in motion
    this.moving = false;

    // True while the user intends (as far as we know) for the tool to continue moving
    this.keep_moving = false;

    // Set to true to exit the manual state once the current operation is completed
    this.exit_pending = false;

    // Make sure we haven't got a left-over disconnect flag (clean up when getting rid of global here)
    global.CLIENT_DISCONNECTED = false;

    // Current trajectory
    this.current_axis = null;
    this.current_speed = null;
    this.completeCallback = null;
    this.status_handler = this._onG2Status.bind(this);
    this.driver.on("status", this.status_handler);
};

// Disconnect from the machine model
ManualRuntime.prototype.disconnect = function () {
    if (this.ok_to_disconnect && !this.stream) {
        this.driver.removeListener("status", this.status_handler);
        log.info("Disconnected MANUAL runtime.");
    } else {
        throw new Error("Cannot disconnect while manually driving the tool.");
    }
};

// Enter the manual drive state (and thus, the machining cycle)
ManualRuntime.prototype.enter = function (mode, hideKeypad) {
    this.stream = new stream.PassThrough();

    // At a high level, this opens a stream to the driver, that subsequent commands
    // will pump commands into.  When we exit the machining cycle with an M2 or M30,
    // we clean up and exit the manual state.
    this.driver.runStream(this.stream).then(
        function () {
            delete this.stream;
            delete this.helper;
            this.machine.setState(this, "idle");
        }.bind(this)
    );

    // Create a helper that is used to do the pumping of commands.
    this.helper = new ManualDriver(this.driver, this.stream, mode);

    // Soft-limit indicator state (persistent on machine.status, survives arm/disarm)
    this.helper.on(
        "softLimit",
        function (er) {
            log.info("Soft limit reached: " + er.axis + " " + er.dir);
            this.machine.status.softLimit = { axis: er.axis, dir: er.dir };
            this.machine.emit("status", this.machine.status);
        }.bind(this)
    );

    this.helper.on(
        "softLimitClear",
        function () {
            log.info("Soft limit cleared");
            this.machine.status.softLimit = null;
            this.machine.emit("status", this.machine.status);
        }.bind(this)
    );

    // TODO: Determine if this is needed it currently does nothing
    this.helper.enter().then(
        function () {
            log.debug("** Resolving enter promise **");
        }.bind(this)
    );
    this.machine.status.hideKeypad = hideKeypad;
    this.machine.setState(this, "manual");
};

// Execute a command.  Command structure follows:
// {cmd:"start",axis:"X",speed:2} - Start moving in +X direction at 2ips
// TODO: The 2-axis form of 'start' is bonkers, we should just get to specify an N-dimensional speed vector
// {cmd:"start",axis:"X",speed:2, second_axis:"Y", second_speed:2}
// {cmd:"exit"} - Exit the manual mode (return to idle)
// {cmd:"stop"} - Stop movement, but do not exit the manual mode
// {cmd:"quit"} - Quit motion (from hold w/resume)
// {cmd:"maint"} - Maintain motion along the current vector // 9/2023 now in server, see elsewhere
// {cmd:"goto",move:{X:1,Y:2,Z:3}} - Go to x,y,z = 1,2,3
// {cmd:"set", move:{X:1,Y:2,Z:3}} - Set current x,y,z to 1,2,3 (No movement)
// {cmd:"output", output:out, value:val} - Set output to value, also uses raw, see driver
// {cmd:"raw", code:code - Runs raw GCode (code.code) on the machine
ManualRuntime.prototype.executeCode = function (code) {
    currentCmd = code.cmd;
    // Don't honor commands if we're not in a position to do so
    switch (this.machine.status.state) {
        case "stopped":
            return;
    }
    log.info("MANUAL CODE!!");
    log.info(JSON.stringify(code));
    switch (code.cmd) {
        case "enter":
            this.enter(code.mode, code.hideKeypad || false);
            log.debug("fail on case enter, mode= " + code.mode);
            break;
        default:
            if (!this.helper) {
                log.warn("Can't accept command '" + code.cmd + "' - not entered.");
                return;
            }
            switch (code.cmd) {
                case "exit":
                    log.debug("---- MANUAL DRIVE EXIT ----");
                    this.machine.status.softLimit = null;
                    this.helper.exit();
                    break;

                case "start":
                    this.helper.startMotion(code.axis, code.speed, code.second_axis, code.second_speed);
                    break;

                case "stop":
                    this.helper.stopMotion();
                    break;

                case "quit":
                    this.helper.quitMove();
                    break;

                case "resume":
                    this.helper.resumeMove();
                    this.machine.setState(this, "manual");
                    break;

                case "maint":
                    this.helper.maintainMotion();
                    break;

                case "goto":
                    this.helper.goto(code.move);
                    break;

                case "set":
                    this.helper.set(code.move);
                    break;

                case "fixed":
                    if (code.dist == null) {
                        break;
                    }
                    if (!this.helper) {
                        this.enter();
                    }
                    this.helper.nudge(code.axis, code.speed, code.dist, code.second_axis, code.second_dist);
                    break;

                case "output":
                    if (!code.out || typeof code.out !== "object") {
                        log.error("Invalid 'out' field in the command:", code);
                        return;
                    }
                    // this is a little awkward using the raw system here too, but it's the best way to get the output
                    this.helper.output(code.out.output, code.out.value);
                    break;

                case "raw":
                    this.helper.runGCode(code.code);
                    break;

                default:
                    log.error("Don't know what to do with '" + code.cmd + "' in manual command.");
                    break;
            }
    }
};

// Commands that need to be implemented for runtime interface, but don't do anything
ManualRuntime.prototype.pause = function () {};
ManualRuntime.prototype.quit = function () {
    this.driver.quit();
    this.executeCode({ cmd: "exit" });
};
ManualRuntime.prototype.resume = function () {
    this.driver.resume();
    this.executeCode({ cmd: "resume" });
};

// Internal management of machine status in MANUAL mode
ManualRuntime.prototype._onG2Status = function (status) {
    // Update machine copy of the system status
    for (var key in this.machine.status) {
        if (key in status) {
            this.machine.status[key] = status[key];
        }
    }
    // Detect feedhold during goto moves (including after resume within a goto).
    // Use gotoModeHold flag to reliably identify goto context rather than currentCmd,
    // which gets overwritten by stop/resume commands during feedhold/resume cycles.
    // Guard against re-entering paused state from stale inFeedHold during resume transition.
    if (status.inFeedHold === true && this.helper && this.helper.gotoModeHold) {
        if (this.machine.status.state !== "paused") {
            log.debug("Feedhold detected in goto mode");
            this.machine.setState(this, "paused");
        }
    }
    // Update machine status further because of inconsistent list match
    this.machine.status.currentCmd = currentCmd;
    this.machine.status.stat = status.stat;
    this.machine.emit("status", this.machine.status);
};

exports.ManualRuntime = ManualRuntime;
exports.ManualDriver = ManualDriver;
