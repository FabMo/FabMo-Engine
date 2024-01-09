/*
 * g2.js
 *
 * This module defines the G2 driver, which is responsible for managing communication
 * between the host and a g2 motion conroller.  Other objects and functions are
 * defined here as well to support this capability.
 */
var SerialPort = require("serialport");
var fs = require("fs");
var events = require("events");
var async = require("async");
var util = require("util");
var Queue = require("./util").Queue;
var log = require("./log").logger("g2");
var process = require("process");
var stream = require("stream");
var Q = require("q");

// Values of the **stat** field that is returned from G2 status reports
var STAT_INIT = 0;
var STAT_READY = 1;
var STAT_ALARM = 2;
var STAT_STOP = 3;
var STAT_END = 4;
var STAT_RUNNING = 5;
var STAT_HOLDING = 6;
var STAT_PROBE = 7;
var STAT_CYCLING = 8;
var STAT_HOMING = 9;
var STAT_INTERLOCK = 11;
var STAT_SHUTDOWN = 12;
var STAT_PANIC = 13;

// Should take no longer than CMD_TIMEOUT to do a get or a set operation
var CMD_TIMEOUT = 100000;
var EXPECT_TIMEOUT = 300000;

var _promiseCounter = 1;
var resumePending = false;
var intendedClose = false;
var THRESH = 1;
var PRIMED_THRESHOLD = 10;

// var pat = /s*(G(28|38)\.\d|G2(0|1))/g; Not used yet

// Error codes defined by G2
// See https://github.com/synthetos/g2/blob/edge/TinyG2/tinyg2.h for the latest error codes and messages
try {
    var G2_ERRORS = JSON.parse(
        fs.readFileSync("./data/g2_errors.json", "utf8")
    );
} catch (e) {
    G2_ERRORS = {};
}

// A cycle context is created when you run a stream, and is a way to access driver events in the context of the current run
// It is a sort of token that you can recieve events from while the machining cycle is active,
// and that will resolve like a promise when the machining cycle is done.
function CycleContext(driver, st, promise) {
    this.done = false;
    this._firmed = false;
    this._driver = driver;
    this._stream = st;
    this._paused = false;
    this._promise = promise.then(
        function () {
            this.firm(); // Firm the tool
            this.finish();
        }.bind(this)
    );
    this.eventHandlers = {}; // eventname -> [listener]
    this.eventQueue = {}; // eventname -> {f : listener, data : data to pass to listener}
}

// A cycle context is "firmed" when it has turned over itself as a promise through the then() call, or when the
// run finishes, whichever comes first.
CycleContext.prototype.firm = function () {
    if (this.firmed) {
        return;
    }
    log.debug("Firming the cycle context.");
    try {
        for (var event in this.eventQueue) {
            var handlers = this.eventQueue[event];
            for (var i = 0; i < handlers.length; i++) {
                handlers[i].f(handlers[i].data);
            }
        }
        this.firmed = true;
    } catch (e) {
        delete this.eventQueue;
        throw e;
    }
    delete this.eventQueue;
};

// Bind the listener to the provided event name.
// Events bound in this way are queued, so if any have occurred between the beginning of the run and when
// the binding occurs, they will be triggered when the cycle is firmed
CycleContext.prototype.on = function (event, f) {
    log.debug("Binding to the " + event + " event in the cycle context: " + f);
    if (event in this.eventHandlers) {
        this.eventHandlers[event].push(f);
    } else {
        this.eventHandlers[event] = [f];
    }
    return this;
};

// Return a promise that resolves when the cycle is complete (Q Promises)
CycleContext.prototype.then = function (f) {
    this.firm();
    return this._promise.then(function () {
        return f();
    });
};

// Sort of a do-nothing, for now
CycleContext.prototype.finish = function () {
    log.debug("Finishing up the cycle context.");
};

// Emit the provided data to all the listeners to the subscribed event
CycleContext.prototype.emit = function (event, data) {
    var handlers = this.eventHandlers[event];

    if (handlers) {
        for (var i = 0; i < handlers.length; i++) {
            handlers[i](data);
        }
    }
};

// Pause the run by pausing the stream that is piping data into this context
CycleContext.prototype.pause = function () {
    this._paused = true;
    this._stream.pause();
};

// Resume the run by resuming the stream that is piping data into this context
CycleContext.prototype.resume = function () {
    this._paused = false;
    this._stream.resume();
};

// The G2 object represents the connection to the driver, which happens as serial over USB
function G2() {
    this._currentData = [];
    this._currentGCodeData = [];
    this.g2_status = { stat: null, posx: 0, posy: 0, posz: 0 };
    this.status = { stat: "idle", posx: 0, posy: 0, posz: 0 };
    this._seen_ready = false;
    this.gcode_queue = new Queue();
    this.command_queue = new Queue();

    this.pause_flag = false;
    this.connected = false;

    // OpenSBP Pause
    this.pause_hold = false;

    // Feedhold/flush
    this.quit_pending = false;
    this.stat = null;
    this.hold = null;
    this.manual_hold = false;

    // Readers and callbacks
    this.expectations = [];
    this.readers = {};

    // Members related to streaming
    this.qtotal = 0;
    this.flooded = false;
    this.send_rate = 1;
    this.lines_sent = 0;
    this.primedThreshold = PRIMED_THRESHOLD;

    this.context = null;

    // Event emitter inheritance and behavior setup
    events.EventEmitter.call(this);
    this.setMaxListeners(50);
    this.lines_to_send = 4;
    this._ignored_responses = 0;
    this._primed = false;
    this._streamDone = false;

    this.lineBuffer = [];
}

util.inherits(G2, events.EventEmitter);

// Creates a cycle context, which has a pass-through stream into which data can be piped
G2.prototype._createCycleContext = function () {
    if (this.context) {
        throw new Error(
            "Cannot create a new cycle context.  One already exists."
        );
    }
    // Create and setup the pass-through stream
    var st = new stream.PassThrough();
    st.setEncoding("utf8");
    this._streamDone = false;
    this.lineBuffer = [];
    this.flushcallback = null;

    // Handle data coming in on the stream
    st.on(
        "data",
        function (chunk) {
            // Stream data comes in "chunks" which are often multiple lines
            chunk = chunk.toString();
            var newLines = false;
            // Repartition incoming "chunked" data as lines
            for (var i = 0; i < chunk.length; i++) {
                var ch = chunk[i];
                this.lineBuffer.push(ch);
                if (ch === "\n") {
                    newLines = true;
                    var s = this.lineBuffer.join("").trim();

                    // Enqueue individual lines in the g-code queue
                    this.gcode_queue.enqueue(s);

                    // The G2 sender doesn't actually start sending until it is "primed"
                    // Priming happens either when the number of lines to send reaches a certain threshold
                    // or the prime() function is called manually.
                    if (this.gcode_queue.getLength() >= PRIMED_THRESHOLD) {
                        this._primed = true;
                    }
                    this.lineBuffer = [];
                }
            }
            // If new lines were enqueued as a part of the re-chunkification process, send them.
            if (newLines) {
                this.sendMore();
            }
        }.bind(this)
    );

    ////####
    // Items that need to be pre-pended for all normal motions cycles.
    // So, if we are not in IdleRuntime, then ...
    // Set absolute, spindle speed default, units, and turn on output 4 & ...
    // M0 sets G2 to 'File Stop' stat:3; thus avoids accidentally starting in stat:4 (needs to be in first 4 commands or vulnerable)
    // ... these conditions are exited when in machine as it goes back to idle
    ////## S1000 is default for spindle speed so that m3 (and SO,1,1) will work correctly w/delay w/o speed
    ////## TODO: create default variable for S-value for VFD spindle control, just a dummy here now
    ////## TODO: fix this kludge to get the current_runtime !
    if (global.CUR_RUNTIME != "[IdleRuntime]") {
        log.debug("PREPEND to cycle - " + global.CUR_RUNTIME);
        st.write(
            "N1 M0\n" +
                "N2 G90\n" +
                "N3 G61\n" +
                "N4 M100 ({out4:1})\n" +
                "N5 S1000\n"
        );
    }

    // Handle a stream finishing or disconnecting.
    st.on(
        "end",
        function () {
            log.debug("cycle context end event");
            // Send whatever is left in the queue.  (There may be stuff unsent even after the stream is over)
            this._primed = true;
            this._streamDone = true;
            this.sendMore();
            log.debug("***Stream END event.");
        }.bind(this)
    );

    // Handle a stream being piped into this context (currently do nothing)
    // chunk is defined but never used
    st.on("pipe", function (/* chunk */) {
        log.debug("Stream PIPE event");
    });
    // Create the promise that resolves when the machining cycle ends.
    var promise = this._createStatePromise([STAT_END]).then(
        function () {
            this.context = null;
            this._primed = false;
            return this;
        }.bind(this)
    );

    // Actually create and return the context built from these configured entities
    var ctx = new CycleContext(this, st, promise);

    // The G2 instance keeps track of its current (singleton) cycle context.
    this.context = ctx;
};

// Actually open the serial port and configure G2 based on stored settings
G2.prototype.connect = function (path, callback) {
    // Store paths for safe keeping
    this._serialPath = path;

    // Open the serial port.  This used to be two ports, but now is only the one.
    log.info("Opening G2 port: " + this._serialPath);
    this._serialPort = new SerialPort(this._serialPath, {
        flowcontrol: ["RTSCTS"],
        autoOpen: false,
    });
    this._serialToken = "S";

    // Handle errors
    this._serialPort.on("error", this.onSerialError.bind(this));
    this._serialPort.on("close", this.onSerialClose.bind(this));

    // The control port is the only one to truly handle incoming data
    this._serialPort.on("data", this.onData.bind(this));

    // Flush and get status once the "ready" message has been received from the controller.
    // G2 reports a "SYSTEM READY" message on connect that indicates that the system is prepared to
    // recieve g-codes and JSON commands.  We don't want to do anything until we get that.
    this.once(
        "ready",
        function () {
            this.connected = true;

            ////## Have tested both reset and end-file during this start-up to clear "alarm" and bad stop
            ////##    a reset works, but disconnects G2 and requires new manual fabmo start
            ////##		this._write('\x18\n', function() {   ////## try reset not a kill
            ////##		this._write('M30\n', function() {    ////## try end file
            ////## Kludging 2 kills seems to allow a restart when g2 stuck
            this._write("\x04\n", function () {});
            this._write(
                "\x04\n",
                function () {
                    this.requestStatusReport(
                        function () {
                            callback(null, this);
                        }.bind(this)
                    );
                }.bind(this)
            );
        }.bind(this)
    );

    // Actually perform the connect, and wait for the 'ready' event.
    // We give 3 seconds for the ready event to materialize, which is plenty of time.  Typical
    // times to ready the system are on the order of tens or hundreds of milliseconds.
    this._serialPort.open(
        function (error) {
            if (error) {
                log.error("ERROR OPENING CONTROL PORT " + error);
                return callback(error);
            } else {
                log.info("G2 Port Opened.");
                setTimeout(
                    function checkConnected() {
                        if (!this.connected) {
                            return callback(
                                new Error("Never got the SYSTEM READY from g2.")
                            );
                        }
                    }.bind(this),
                    3000
                );
            }
        }.bind(this)
    );
};

// Close the serial port - important for shutting down the application and not letting resources "dangle"
G2.prototype.disconnect = function (reason, callback) {
    log.info(reason);
    if (reason === "firmware") {
        intendedClose = true;
    }
    this._serialPort.close(callback);
};

// Log serial errors.  Most of these are exit-able offenses, though.
G2.prototype.onSerialError = function (data) {
    log.error(new Error("There was a serial error"));
    log.error(data);
};

// When the serial link to G2 is closed, exit the engine with an error
// In a production environment, the system service manager (usually systemd)
// will simply restart the process and attempt to reconnect
G2.prototype.onSerialClose = function () {
    this.connected = false;
    log.error("G2 Core serial link was lost.");
    if (!intendedClose) {
        process.exit(14);
    }
};

// Write to the serial port (and log it)
G2.prototype._write = function (s, callback) {
    log.g2(this._serialToken, "out", s);
    this._serialPort.write(
        s,
        function () {
            if (callback) {
                this._serialPort.drain(callback);
            }
        }.bind(this)
    );
};

// Clear the "alarm" state on the g2 controller.  Alarms happen in a few cases:
// - Limit switch triggered (not well handled)
// - Soft limit encountered (also not well handled)
// - Command recieved after a queue flush has  been issued (this is handled well by this module)
// - Firmware errors in G2 that put it in the alarm state as a safety feature
G2.prototype.clearAlarm = function () {
    this.command({ clear: null });
};

// Units are sort of weird, and our fork of the g2 firmware hijacks the "gun" command
// to set the system units.  (Conventionally, you have to use a G-code to do this)
// stat is defined but never used
G2.prototype.setUnits = function (units, callback) {
    this.command({ gun: units === 0 || units == "in" ? 0 : 1 });
    this.requestStatusReport(function (/* stat */) {
        callback();
    });
};

// Request a status report from G2
// The callback, if provided, is called with the status report contents.
G2.prototype.requestStatusReport = function (callback) {
    // Register the callback to be called when the next status report comes in
    typeof callback === "function" && this.once("status", callback);
    this.command({ sr: null });
};

// Called for every chunk of data returned from G2
G2.prototype.onData = function (data) {
    var t = new Date().getTime(); // Get current time for logging
    // raw_data event for listeners that want to snoop on all data.
    // Not usually used except for debugging
    this.emit("raw_data", data);

    // Although data comes in "chunks" from the serial stream, the information is processed as lines
    // The following section repartitions the incoming chunk as lines so that it can be interpreted
    var s = data.toString("ascii");
    var len = s.length;
    for (var i = 0; i < len; i++) {
        var c = s[i];
        if (c === "\n") {
            var json_string = this._currentData.join("");
            // eslint flags t as unused, used for logging
            // eslint-disable-next-line no-unused-vars
            t = new Date().getTime();
            log.g2("S", "in", json_string);
            try {
                // Responses from G2 are in JSON format (always) so we parse them out, and handle the messages
                var obj = JSON.parse(json_string);
                this.onMessage(obj);
            } catch (e) {
                this.handleExceptionReport(e);
                throw e;
            } finally {
                // if we hit a linefeed, we try to parse, if we succeed we clear the line and start anew
                // and if we fail to parse, we still clear the line and start anew.
                this._currentData = [];
            }
        } else {
            this._currentData.push(c);
        }
    }
};

// The footer is the part of the JSON response message that contains error information
// If the footer indicates an error code, we do a lookup on the error message and emit an error event
// Note that G2_ERRORS must be up-to-date with the current firmware in order for the lookup to be meaningful.
G2.prototype.handleFooter = function (response) {
    if (response.f) {
        if (response.f[1] !== 0) {
            var err_code = response.f[1];
            var err_msg = G2_ERRORS[err_code] || [
                "ERR_UNKNOWN",
                "Unknown Error",
            ];
            this.emit("error", [err_code, err_msg[0], err_msg[1]]);
            return new Error(err_msg[1]);
        }
    }
};

// When there is an exception in the G2 firmware, it issues an "exception report"
// which comes as a part of the normal JSON response.  There are a number of ways
// to react to this, depending on the exception.  In time past, certain exceptions were
// ignored or handled in a special way.  Now, we mostly just make a note of the exception and report it in the log.
G2.prototype.handleExceptionReport = function (response) {
    if (response.er) {
        this._lastExceptionReport = response.er;
        var stat = response.er.st;
        if (stat === 207 && this.quit_pending) {
            this.quit_pending = false;
        }
        log.error("Response with an exception report:");
        log.error(JSON.stringify(response));
    }
};

G2.prototype.getLastException = function () {
    return this._lastExceptionReport || null;
};
G2.prototype.clearLastException = function () {
    this._lastExceptionReport = null;
};

/*
 * This function handles status reports that are returned by the tool.
 * Status reports contain position, velocity, status, input/output data, etc.
 * When they arrive, we update internal state, fire events, etc.
 *
 * 0	machine is initializing
 * 1	machine is ready for use
 * 2	machine is in alarm state (shut down)
 * 3	program stop or no more blocks (M0, M1, M60)
 * 4	program end via M2, M30
 * 5	motion is running
 * 6	motion is holding
 * 7	probe cycle active
 * 8	machine is running (cycling)
 * 9	machine is homing
 */
G2.prototype.handleStatusReport = function (response) {
    if (response.prb) {
        log.debug("GOT PROBE FINISH REPORT! Target at:  " + response.prb.z);
        if (response.prb.e === 1) {
            // Special Case: When a probe move starts very close to the target,
            // ... a STAT_PROBE may not have been issued before it is hit. So we add this flag, which is usually redundant.
            this.status.targetHit = true;
            log.debug("HIT TARGET!");
        }
        // Don't clear probePending until next stat:3; managed in "opensbp"
    }
    if (response.sr) {
        // Update our copy of the system status
        for (var key in response.sr) {
            var value = response.sr[key];
            if (key === "unit") {
                value = value === 0 ? "in" : "mm";
            }
            this.status[key] = value;
        }

        // "stat" is the system state (detailed in the list above)
        if ("stat" in response.sr) {
            switch (response.sr.stat) {
                // If we stopped and flushed, we might have provided a callback
                // We call it once we get the confirmation that the tool has actually stopped and flushed.
                case STAT_STOP:
                    if (this.flushcallback) {
                        this.flushcallback(null);
                        this.flushcallback = null;
                    }
                    break;
                case STAT_END:
                    this.status.line = null;
                    break;
                // A really bad error in the firmware causes a "panic" - these are rare, but they do
                // happen.  A panic is not resolvable without resetting the micrcontroller hosting G2
                // TODO: We might want to actually kill the engine here, or issue some kind of reset.
                case STAT_PANIC:
                    log.error("Panicked Response:");
                    log.error(JSON.stringify(response));
                    break;
            }

            // this.quit_pending is set when a quit is issued while the tool is running.
            // The reason to have this flag is that once a stop and flush are issued to the g2 controller
            // a second stop and flush can cause the system to crash.  A second quit will not be sent if
            // another quit is pending.  The quit is pending until g2 has fully transitioned to STAT_END
            // If it moves into STAT_STOP or STAT_HOLD during a pending quit, a stop and flush are
            // sent to exit the machining cycle.  A stop/flush that is issued too soon after the transition
            // to STAT_STOP or STAT_HOLDING can also cause the system to crash, so we give 50ms before doing
            // this.
            // TODO - This state jiggerypokery is because there are issues with state management surrounding
            //        job kills in the firmware.  Those issues should be resolved so that this is not necessary.
            if (this.quit_pending) {
                switch (response.sr.stat) {
                    case STAT_STOP:
                    case STAT_HOLDING:
                        log.info("Issuing the job kill command.");
                        setTimeout(
                            function () {
                                this._write("\x04\n", function () {});
                            }.bind(this),
                            50
                        );
                        break;
                    case STAT_END:
                        log.info("Clearing the quit pending state.");
                        this.lines_to_send = 4;
                        this.quit_pending = false;
                        this.pause_flag = false;
                        this.status.inFeedHold = false;
                        break;
                }
            } else {
                // If we move into the holding state, set a flag indicating that we're paused,
                // and pause the cycle context if it exists.
                switch (response.sr.stat) {
                    case STAT_HOLDING:
                        this.pause_flag = true;
                        this.status.inFeedHold = true; // for sensing input-generated-hold
                        if (this.context) {
                            this.context.pause();
                        }
                        break;
                    default:
                        this.pause_flag = false;
                        this.status.inFeedHold = false;
                        this.status.resumeFlag = false;
                        if (this.context) {
                            this.context.resume();
                        }
                        break;
                }
            }

            // this.expectations is a list of "expected states" and callbacks.
            // Certain function
            if (this.expectations.length > 0) {
                var expectation = this.expectations.pop();
                var stat = states[this.status.stat];
                if (stat in expectation) {
                    if (expectation[stat] === null) {
                        this.expectations.push(expectation);
                    } else {
                        expectation[stat](this);
                    }
                } else if (null in expectation) {
                    expectation[null](this);
                }
            }
        }

        this.stat =
            this.status.stat !== undefined ? this.status.stat : this.stat;
        this.hold =
            this.status.hold !== undefined ? this.status.hold : this.hold;

        if (this.context) {
            this.context.emit("status", this.status);
        }

        // Emit status no matter what
        if ("stat" in response.sr) {
            this.emit("stat", response.sr.stat);
            if (this.context) {
                this.context.emit("stat", response.sr.stat);
            }
        }
        this.emit("status", this.status);

        //If an input induced feedhold is received during a resume then adjust so that
        // another resume can be received and feedhold can be properly reestablished.
        if (this.hold > 0 && resumePending) {
            //Set resumeFlag to false so that resume/quit will display in the UI
            this.status.resumeFlag = false;
            resumePending = false;
            this.pause_flag = true;
        }
    }
};

// Called once a proper JSON response is decoded from the chunks of data that come back from G2
G2.prototype.onMessage = function (response) {
    // TODO more elegant way of dealing with "response" data.

    if (response.r) {
        if (!this._seen_ready) {
            // Special message type for initial system ready message
            if (response.r.msg && response.r.msg === "SYSTEM READY") {
                this.emit("ready", this);
                return;
            }
        }
        if (this._ignored_responses > 0) {
            this._ignored_responses--;
        } else {
            this.lines_to_send += 1;
            this.sendMore();
        }
        var r = response.r;
        this.emit("response", false, response.r);
    } else {
        r = response;
    }

    // Deal with G2 status (top priority)
    this.handleStatusReport(r);

    // Deal with exceptions
    this.handleExceptionReport(r);

    // Deal with footer
    var err = this.handleFooter(response);

    // Emitted everytime a message is received, regardless of content
    this.emit("message", response);

    for (var key in r) {
        if (key in this.readers) {
            if (
                typeof this.readers[key][this.readers[key].length - 1] ===
                "function"
            ) {
                var callback = this.readers[key].shift();
                if (err) {
                    callback(err);
                } else {
                    callback(null, r[key]);
                }
            }
        }
    }
};

// Handling normal and raw now the same
// eslint flags callback as unused, gets used in driver.js
// eslint-disable-next-line no-unused-vars
G2.prototype.manualFeedHold = function (callback) {
    this.pause_flag = true;
    log.debug("Processing manualFeedHold");
};

G2.prototype.manualResume = function () {
    this.status.resumeFlag = true;
    resumePending = true;
    log.debug("Processing manualResume");
};

// "pause" the current machining cycle by issuing a feedhold
// callback is called when the next state change takes place
G2.prototype.feedHold = function (callback) {
    this.pause_flag = true;
    this.flooded = false;
    typeof callback === "function" && this.once("state", callback);
    log.debug("Sending a feedhold");
    if (this.context) {
        this.context.pause();
    }
    this._write("!\n");
};

// Clears the queue, this means both the queue of g-codes in the engine to send,
// and whatever gcodes have been received but not yet executed in the g2 firmware context
G2.prototype.queueFlush = function (callback) {
    log.debug("Sending FabMo Queue Clear");
    this.flushcallback = callback;
    this.lines_to_send = 4;
    this.gcode_queue.clear(); // clear FabMo
    this._write("%\n"); // clear G2, though redundant in case of quitting a file
};

// Bring the system out of feedhold
// Like the quit() function below, to issue another resume while the first one is pending can
// make the system crashy - so we're careful not to do that.
// This function returns a promise that resolves when the machining cycle has resumed.
G2.prototype.resume = function () {
    this.status.resumeFlag = true;
    var thisPromise = _promiseCounter;
    if (resumePending) {
        return;
    }
    log.info("Creating promise " + thisPromise);
    _promiseCounter += 1;
    resumePending = true;
    var deferred = Q.defer();
    var that = this;
    var onStat = function (stat) {
        if (stat !== STAT_RUNNING) {
            if (this.quit_pending && stat === STAT_HOLDING) {
                return;
            }
            that.removeListener("stat", onStat);
            log.info("Resolving promise (resume): " + thisPromise);
            resumePending = false;
            deferred.resolve(stat);
        }
    };

    this.on("stat", onStat);
    this._write("~"); //cycle start command character

    if (this.context) {
        this.context.resume();
    }

    this.requestStatusReport(
        function () {
            this.pause_flag = false;
        }.bind(this)
    );

    return deferred.promise;
};

// Quit means to stop the tool and abandon the machining cycle.
G2.prototype.quit = function () {
    if (this.quit_pending) {
        log.warn("Not quitting because a quit is already pending.");
        return;
    }
    this.quit_pending = true;
    if (this.stream) {
        this.stream.end();
    }
    // Issue kill and clear queues.
    this._write("\x04\n");
    this.queueFlush(function () {
        //Finally clear context and _reset primed flag so we're not reliant on getting a stat 4 to clear the context.
        this.context = null;
        this._primed = false;
    });
};

// When the gcode runtime asks that an M30 be sent, send it. This is pulled out from the
//  normal queuing and writing path because of a timing issue with the g2core that needs to be
//  resolved. Right now, when the g2core runs out of gcode in the buffer, it seems like it
//  goes to stat:3. However, if the last line of gcode was M30, it seems to either ignore it,
//  or consider it satisfied by stat:3. (maybe there is some time required to get to stat:3 from stat:5?
//  In any case, by sending the M30 after we receive the stat:3 status change update, we ensure
//  that the M30 is processed and that the g2core goes to stat:4 so that we end our current CycleContext
//  and can start a new one.
G2.prototype.sendM30 = function () {
    if (this.quit_pending) {
        log.warn("Not quitting because a quit is already pending.");
        return;
    }

    this.quit_pending = true;

    if (this.stream) {
        this.stream.end();
    }
    // Clear the gcodes we have queued up
    this.gcode_queue.clear();
    // Issue the M30
    this._write("M30\n");
};

// get the specified configuration value from g2.
// key can be an array of keys as well, in which case an object will be returned mapping keys to values
// This function is expected to not take too long, even if we're busy running a file, so a timeout is implemented.
G2.prototype.get = function (key, callback) {
    // Deal with possible array-ness of this
    // TODO - This sort of thing is pretty ugly - we should probably break this out into a get
    //        and a getMany or something like that.
    var keys;
    if (key instanceof Array) {
        keys = key;
        var is_array = true;
    } else {
        is_array = false;
        keys = [key];
    }

    // For each key
    async.map(
        keys,
        // Function called for each item in the keys array
        function (k, cb) {
            cb = cb.bind(this);
            var cmd = {};
            cmd[k] = null;

            // this.readers contains the key values that we're expecting to read back, and maps them
            // to the callbacks that are called once the values are retrieved
            if (k in this.readers) {
                this.readers[k].push(cb);
            } else {
                this.readers[k] = [cb];
            }

            // Ensure that an error callback is called if the data isn't read out
            setTimeout(
                function () {
                    if (k in this.readers) {
                        var callbacks = this.readers[k];
                        var stored_cb = callbacks[callbacks.length - 1];
                        // TODO - using the right equals here?
                        if (cb == stored_cb) {
                            if (typeof cb == "function") {
                                this.readers[k].shift();
                                cb(new Error("Timeout"), null);
                            }
                        }
                    }
                }.bind(this),
                CMD_TIMEOUT
            );

            // Actually issue the read to the controller, now that the response
            // handling is all set up correctly
            this.command(cmd);
        }.bind(this),

        // Function to call with the list of results
        function (err, result) {
            if (err) {
                return callback(err, result);
            } else {
                // If given an array, return one.  Else, return a single item.
                if (is_array) {
                    return callback(err, result);
                } else {
                    return callback(err, result[0]);
                }
            }
        }
    );
};

// Set configuration keys to values provided in the supplied object
// callback is called with an object that represents the actual values set
// For example:
// for obj = {'2su' : 400.18625 } : if, because of the internal resolution of that value,
// only 400.2 is achievable the callback will be called with {'2su' : 400.18625}
G2.prototype.setMany = function (obj, callback) {
    var keys = Object.keys(obj);
    async.map(
        keys,
        // Function called for each item in the keys array
        function (k, cb) {
            var cmd = {};
            cmd[k] = obj[k];
            if (k in this.readers) {
                this.readers[k].push(cb.bind(this));
            } else {
                this.readers[k] = [cb.bind(this)];
            }
            this.command(cmd);
        }.bind(this),

        // Function to call with the list of results
        function (err, result) {
            if (err) {
                return callback(err, result);
            } else {
                var retval = {};
                try {
                    for (var i = 0; i < keys.length; i++) {
                        retval[keys[i]] = result[i];
                    }
                } catch (e) {
                    callback(e, null);
                }
                return callback(null, retval);
            }
        }
    );
};

// Set works just like setMany above, but for a single value only
// TODO: This is just a specific version of above, rewrite this to call the above function!
G2.prototype.set = function (key, value, callback) {
    if (value === undefined) {
        return callback(new Error("Undefined value passed to G2"));
    }
    var cmd = {};
    cmd[key] = value;
    if (key in this.readers) {
        this.readers[key].push(callback);
    } else {
        this.readers[key] = [callback];
    }

    // Ensure that an errback is called if the data isn't read out
    setTimeout(
        function () {
            if (key in this.readers) {
                var callbacks = this.readers[key];
                var stored_cb = callbacks[callbacks.length - 1];
                if (callback == stored_cb) {
                    if (typeof callback == "function") {
                        this.readers[key].shift();
                        callback(new Error("Timeout"), null);
                    }
                }
            }
        }.bind(this),
        CMD_TIMEOUT
    );

    this.command(cmd);
};

// Send a command to G2 (can be string or JSON)
G2.prototype.command = function (obj) {
    var cmd;
    if (typeof obj == "string") {
        cmd = obj.trim();
        this.gcode_queue.enqueue(cmd);
    } else {
        // G2 supports a "truncated" format that allows for more compact JSON
        cmd = JSON.stringify(obj);
        cmd = cmd.replace(/(:\s*)(true)(\s*[},])/g, "$1t$3");
        cmd = cmd.replace(/(:\s*)(false)(\s*[},])/g, "$1f$3");
        this.command_queue.enqueue(cmd);
    }
    this.sendMore();
};

// Return a promise that resolves when one of the provided states is encountered
// states - a list of states which will cause the promise to resolve
// The promise resolves with the state that caused the resolution as an argument
G2.prototype._createStatePromise = function (states) {
    // Track the promise created (debug)
    var thisPromise = _promiseCounter;
    log.info("Creating promise " + thisPromise);
    _promiseCounter += 1;
    var deferred = Q.defer();
    var that = this;
    var onStat = function (stat) {
        for (var i = 0; i < states.length; i++) {
            if (stat === states[i] && !this.manual_hold && !this.pause_hold) {
                that.removeListener("stat", onStat);
                log.info(
                    "Resolving promise " +
                        thisPromise +
                        " because of state " +
                        stat +
                        " which is one of " +
                        states
                );
                deferred.resolve(stat);
            }
        }
    };
    this.on("stat", onStat);
    return deferred.promise;
};

// Wait for a state or states (as reported in the status report 'stat' member)
// See _createStatePromise for more information
// states - either a single state or list of states
G2.prototype.waitForState = function (states) {
    if (!states.length) {
        states = [states];
    }
    return this._createStatePromise(states);
};

// Run data from a stream, rather than a string or a list
// This allows us to run huge files from disk, or say, http, or from
// a stream processor that is streaming from one of those sources without
// having to load the entire file into memory.
G2.prototype.runStream = function (s, manualPrime = false) {
    this._createCycleContext();
    if (manualPrime) {
        this.prime();
    }
    s.pipe(this.context._stream);
    return this.context;
};

// G2 begins running G-Codes as soon as it recieves them, and in certain cases, it is possible for
// G2 to "plan to a stop" when this is not the desired behavior.  This typically happens at the start of
// of a run, when the host has only sent a few moves down, and G2's planner outpaces the moves coming in.
// To resolve this, this module provides a "priming" behavior that will prevent it from sending any g-codes
// to G2 until it is "primed" with enough of them so that it's not going to starve the planner after it starts
// sending.  The difficulty with this is, if the prime threshold is 10 g-codes, and the host wants to send a
// file that is only 5 g-codes long, the system will never be primed, and no g-codes are sent.  The prime()
// function then, is provided for cases where we know we're not sending anymore g-codes, and we want G2
// to just run whatever we've sent so far.
G2.prototype.prime = function () {
    log.info("Priming driver (manually)");
    this._primed = true;
    this.sendMore();
};

// TODO - This was mostly an informational thing that should no longer be needed
G2.prototype.getInfo = function () {
    return (
        "G2: primed:" +
        (this._primed ? "1" : "0") +
        " l2s:" +
        this.lines_to_send +
        " gcq:" +
        this.gcode_queue.getLength()
    );
};

// This function is called internally when it's time to send more g-codes or commands from the queue.
// This implements the so-called "linemode" protocol (see G2 source documentation for more info)
// https://github.com/synthetos/g2/wiki/g2core-Communications
G2.prototype.sendMore = function () {
    // Don't ever send anything if we're paused
    if (this.pause_flag) {
        return;
    }

    // "commands" (JSON messages) preempt g-codes.  Send these first, regardless of whether or not we're primed.
    var count = this.command_queue.getLength();
    if (count) {
        var to_send = count;
        var codes = this.command_queue.multiDequeue(count);
        codes.push("");
        this._ignored_responses += to_send;
        this._write(codes.join("\n"), function () {});
    }

    // If we're primed, go ahead and send more g-codes
    if (this._primed) {
        count = this.gcode_queue.getLength();
        if (this.lines_to_send >= THRESH) {
            if (count >= THRESH || this._streamDone) {
                // Send some lines, but no more than we are allowed per linemode protocol
                to_send = Math.min(this.lines_to_send, count);
                codes = this.gcode_queue.multiDequeue(to_send);
                // Ensures that when we join below that we get a \n on the end
                codes.push("");
                if (codes.length > 1) {
                    this.lines_to_send -= to_send /*-offset*/;
                    this._write(codes.join("\n"), function () {});
                }
            }
        }
    } else {
        if (this.gcode_queue.getLength() > 0) {
            log.debug("Not sending because not primed.");
        }
    }
};

// Set the position of the motion system using the G28.3 code (on start)
// position - An object mapping axes to position values. Axes that are not included will not be updated.
G2.prototype.setMachinePosition = function (position, callback) {
    var axes = ["x", "y", "z", "a", "b", "c", "u", "v", "w"];
    var gcodes = new stream.Readable();
    let mult = this.status.unit === "mm" ? 1 : 1 / 25.4; // Convert saved position from mm to current for restore

    // ** UPDATE INITIAL LOCATION (offsets + values) **
    gcodes.push("G55 \n"); // Set coordinate system to G55 to match FabMo
    axes.forEach(function (axis) {
        // For each axis, if it is in the position object, add a G28.3 command to the stream
        if (position[axis] != undefined) {
            gcodes.push(
                "G28.3 " + axis + (position[axis] * mult).toFixed(5) + "\n"
            );
        }
    });
    gcodes.push(null);

    //TODO: Set manualPrime false once uvw enabled
    this.runStream(gcodes, true).then(function () {
        callback && callback();
    });
};

// Function works like "once()" for a state change
// callbacks is an associative array mapping states to callbacks
// If the *next* state change matches a state in the associative array, the callback it maps to is called.
// If null is specified in the array, this callback is used for any state that is unspecified
//
// eg:
// this.expectStateChange {
//                          STAT_END : end_callback,
//                          STAT_PAUSE : pause_callback,
//                          null : other_callback};
//
// In the above example, when the next change of state happens, the appropriate callback is called in the case
// that the new state is either STAT_END or STAT_PAUSE.  If the new state is neither, other_callback is called.

G2.prototype.expectStateChange = function (callbacks) {
    if ("timeout" in callbacks) {
        var fn = callbacks.timeout;
        setTimeout(
            function () {
                if (this.expectations.length > 0) {
                    callbacks = this.expectations[this.expectations.length - 1];
                    if (callbacks.timeout === fn) {
                        log.debug("Calling timeout function");
                        this.expectations.pop();
                        fn(this);
                    }
                }
            }.bind(this),
            EXPECT_TIMEOUT
        );
    }
    this.expectations.push(callbacks);
};

// Name helper for the states - useful for error messages.
var states = {
    0: "init",
    1: "ready",
    2: "alarm",
    3: "stop",
    4: "end",
    5: "running",
    6: "holding",
    7: "probe",
    8: "cycling",
    9: "homing",
    11: "interlock",
    12: "shutdown",
    13: "panic",
};

// export the class
exports.G2 = G2;

// Convenient names for states
exports.STAT_INIT = STAT_INIT;
exports.STAT_READY = STAT_READY;
exports.STAT_ALARM = STAT_ALARM;
exports.STAT_STOP = STAT_STOP;
exports.STAT_END = STAT_END;
exports.STAT_RUNNING = STAT_RUNNING;
exports.STAT_HOLDING = STAT_HOLDING;
exports.STAT_PROBE = STAT_PROBE;
exports.STAT_CYCLING = STAT_CYCLING;
exports.STAT_HOMING = STAT_HOMING;
exports.STAT_INTERLOCK = STAT_INTERLOCK;
exports.STAT_SHUTDOWN = STAT_SHUTDOWN;
exports.STAT_PANIC = STAT_PANIC;

G2.prototype.STAT_INIT = STAT_INIT;
G2.prototype.STAT_READY = STAT_READY;
G2.prototype.STAT_ALARM = STAT_ALARM;
G2.prototype.STAT_STOP = STAT_STOP;
G2.prototype.STAT_END = STAT_END;
G2.prototype.STAT_RUNNING = STAT_RUNNING;
G2.prototype.STAT_HOLDING = STAT_HOLDING;
G2.prototype.STAT_PROBE = STAT_PROBE;
G2.prototype.STAT_CYCLING = STAT_CYCLING;
G2.prototype.STAT_HOMING = STAT_HOMING;
G2.prototype.STAT_INTERLOCK = STAT_INTERLOCK;
G2.prototype.STAT_SHUTDOWN = STAT_SHUTDOWN;
G2.prototype.STAT_PANIC = STAT_PANIC;
