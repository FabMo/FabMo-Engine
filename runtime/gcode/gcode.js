var fs = require("fs");
var stream = require("stream");
var log = require("../../log").logger("gcode");
var config = require("../../config");
var countLineNumbers = require("../../util").countLineNumbers;
var LineNumberer = require("../../util").LineNumberer;

function GCodeRuntime() {
    this.machine = null;
    this.driver = null;
    this.ok_to_disconnect = true;
    this.completeCallback = null;
    this._file_or_stream_in_progress = false;
}

GCodeRuntime.prototype.toString = function () {
    return "[GCodeRuntime]";
};

// pass through function for compatibility with opensbp runtime
// eslint-disable-next-line no-unused-vars
GCodeRuntime.prototype.needsAuth = function (s) {
    return true;
};

GCodeRuntime.prototype.connect = function (machine) {
    this.machine = machine;
    this.driver = machine.driver;
    this.status_handler = this._onDriverStatus.bind(this);
    this.error_handler = this._onErrorStatus.bind(this);
    this.status_report = {};
    this.driver.on("status", this.status_handler);
    this.driver.on("error", this.error_handler);
    log.info("Connected G-Code Runtime");
};

GCodeRuntime.prototype.disconnect = function () {
    if (this.ok_to_disconnect) {
        this.driver.removeListener("status", this.status_handler);
        this.driver.removeListener("error", this.error_handler);
        log.info("Disconnected G-Code Runtime");
    } else {
        throw new Error("Cannot disconnect GCode Runtime");
    }
};

GCodeRuntime.prototype.pause = function () {
    this.driver.feedHold();
    this.machine.status.inFeedHold = true;
};

GCodeRuntime.prototype.quit = function () {
    this.driver.quit();
};

GCodeRuntime.prototype.resume = function () {
    this.driver.resume();
    this.machine.status.inFeedHold = false;
};

GCodeRuntime.prototype._changeState = function (newstate) {
    if (newstate != "idle") {
        this.ok_to_disconnect = false;
    }
    if (this.machine.status.state != newstate) {
        this.machine.setState(this, newstate);
    }
};

GCodeRuntime.prototype._limit = function () {
    var er = this.driver.getLastException();
    if (er && er.st == 203) {
        var msg = er.msg.replace(/\[[^[\]]*\]/, "");
        this.driver.clearLastException();
        this._fail(msg);
        return true;
    }
    return false;
};

GCodeRuntime.prototype._onDriverStatus = function (status) {
    // Update the machine copy of g2 status variables
    for (var key in this.machine.status) {
        if (key in status) {
            this.machine.status[key] = status[key];
        }
    }
    // Update the machine copy of g2 status variables
    for (key in status) {
        this.status_report[key] = status[key];
    }

    this.machine.emit("status", this.machine.status);
};

GCodeRuntime.prototype._onErrorStatus = function (error) {
    this._fail(error);
};

GCodeRuntime.prototype._die = function () {
    this.machine.status.current_file = null;
    this.machine.status.line = null;
    this.machine.status.nb_lines = null;
    try {
        this.machine.status.job.fail();
    } catch (e) {
        log.error(e);
    } finally {
        this.machine.status.job = null;
        this.machine.setState(this, "dead", {
            error: "A G2 exception has occurred. You must reboot your tool.",
        });
    }
};

GCodeRuntime.prototype._fail = function (message) {
    this.machine.status.current_file = null;
    this.machine.status.line = null;
    this.machine.status.nb_lines = null;
    try {
        this.machine.status.job.fail();
    } catch (e) {
        log.error(e);
    } finally {
        this.machine.status.job = null;
        this.machine.setState(this, "stopped", { error: message[2] });
    }
};

GCodeRuntime.prototype._idle = function () {
    this.machine.status.current_file = null;
    this.machine.status.line = null;
    this.machine.status.nb_lines = null;
    var job = this.machine.status.job;
    // Set the machine state to idle and return the units to their default configuration
    var finishUp = function () {
        this.driver.setUnits(
            config.machine.get("units"),
            function () {
                var callback = this.completeCallback || function () {};
                this.ok_to_disconnect = true;
                this.completeCallback = null;
                this.machine.setState(this, "idle");
                callback();
            }.bind(this)
        );
    }.bind(this);

    if (job) {
        if (job.pending_cancel) {
            this.machine.status.job.cancel(
                // eslint-disable-next-line no-unused-vars
                function (err, job) {
                    this.machine.status.job = null;
                    finishUp();
                }.bind(this)
            );
        } else {
            this.machine.status.job.finish(
                // eslint-disable-next-line no-unused-vars
                function (err, job) {
                    this.machine.status.job = null;
                    finishUp();
                }.bind(this)
            );
        }
    } else {
        finishUp();
    }
};

GCodeRuntime.prototype._handleStop = function () {
    this._idle();
};

GCodeRuntime.prototype._handleStateChange = function (stat) {
    switch (stat) {
        case this.driver.STAT_HOLDING:
            this._changeState("paused");
            break;
        case this.driver.STAT_RUNNING:
            this.machine.status.inFeedHold = false;
            this._changeState("running");
            break;
        case this.driver.STAT_STOP:
            // This that the g2core is in stat:3, meaning it has processed all available gcode
            // so we need to tell it to move to stat:4 by sending an end of job "M30"
            // There may have been an M30 in the file but the g2core will have ignored it, this
            // may change someday in the future on the g2core end, so we may end up revisiting this.
            // OTOH, an extra M30 should not cause a problem.

            // As of 04/04/2022 the extra m30 seems to be a problem.
            // Before commenting out this.driver.sendM30, files would end whenever a stat 3 was received
            // which is not always at the end of the file. If the operator forgets to add an m30
            // to the end of their file then FabMo will stall and show an empty footer, requiring ESC key to be hit.
            // I am writing that up as a seperate enhancement issue
            this._changeState("stopped");
            if (this._file_or_stream_in_progress) {
                //this.driver.sendM30();
                this._file_or_stream_in_progress = false;
            }
            break;
        default:
            // TODO:  Logging or error handling?
            break;
    }
};

// Run a given stream input
GCodeRuntime.prototype.runStream = function (st) {
    if (this.machine) {
        this.machine.setState(this, "running");
    }

    var manualPrime =
        this.machine.status.nb_lines < this.driver.primedThreshold;
    var ln = new LineNumberer();
    return this.driver
        .runStream(st.pipe(ln), manualPrime) ////## This is where we might put prepend RE: Rob
        .on("stat", this._handleStateChange.bind(this))
        .then(this._handleStop.bind(this));
};

// Run a file given the filename
GCodeRuntime.prototype.runFile = function (filename) {
    this._file_or_stream_in_progress = true;
    if (
        this.machine.status.state === "idle" ||
        this.machine.status.state === "armed"
    ) {
        //  TODO:  Can we count line numbers before streaming without reading the file twice?
        countLineNumbers(
            filename,
            function (err, lines) {
                this.machine.status.nb_lines = lines;
                var st = fs.createReadStream(filename);
                return this.runStream(st);
            }.bind(this)
        );
    }
};

// Run the provided string
// TODO: Should this all be incorporated with executeCode?
//		Do we have any need for running gCode strings outside of the editor/job/macro system?
GCodeRuntime.prototype.runString = function (string) {
    if (
        this.machine.status.state === "idle" ||
        this.machine.status.state === "armed"
    ) {
        // count lines and set file length
        var lines = string.match(/\n/g) || "";
        this.machine.status.nb_lines = lines.length;
        //convert string to stream and pass to streamRun
        var stringStream = stream.Readable.from(string);
        return this.runStream(stringStream);
    }
};

// Run the given string as gcode
GCodeRuntime.prototype.executeCode = function (string) {
    this._file_or_stream_in_progress = true;
    return this.runString(string);
};

exports.GCodeRuntime = GCodeRuntime;
