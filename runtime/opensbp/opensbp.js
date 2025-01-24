/*
 * runtime/opensbp/opensbp.js
 *
 * This module defines SBPRuntime which is the runtime responsible for
 * running OpenSBP files.  The SBPRuntime interprets OpenSBP code, generating
 * g-code and streaming it to the motion controller when appropriate.
 *
 * OpenSBP is a more feature-rich language than "strict" g-code.
 * It is essentially an answer to the "vendor extensions" to g-code that other
 * systems apply to allow for complex constructs like expression parsing, program control flow,
 * and control of systems not conventionally accessible to the g-code canonical machine.
 */

var parser = require("./parser");
var fs = require("fs");
var log = require("../../log").logger("sbp");
var sb3_commands = require("./sb3_commands");
var events = require("events");
var tform = require("./transformation");
var macros = require("../../macros");
var Leveler = require("./commands/leveler").Leveler;
var u = require("../../util");
var util = require("util");
var config = require("../../config");
var stream = require("stream");
var ManualDriver = require("../manual").ManualDriver;

// Constructor for the OpenSBP runtime
// The SBPRuntime object is responsible for running OpenSBP code.
// For more info and command reference: http://www.opensbp.com/
// Note that not ALL of the OpenSBP standard listed at the above URL is supported.
// FabMo supports a limited subset of the original standard, as not all commands make sense
// to use in the FabMo universe.
function SBPRuntime() {
    // Handle Inheritance
    events.EventEmitter.call(this);
    this.connected = false;
    this.ok_to_disconnect = true;
    this.stack = [];
    this.program = [];
    this.pc = 0;
    this.start_of_the_chunk = 0;
    this.label_index = {};
    this.stack = [];
    this.file_stack = [];

    this.output = [];
    this.running = false;
    this.quit_pending = false;
    this.cmd_result = 0;

    this.cmd_posx = undefined; // tracker for new commanded positions as file is processed
    this.cmd_posy = undefined;
    this.cmd_posz = undefined;
    this.cmd_posa = undefined;
    this.cmd_posb = undefined;
    this.cmd_posc = undefined;

    this.jogspeed_xy = 0;
    this.jogspeed_y = 0;
    this.jogspeed_z = 0;
    this.jogspeed_a = 0;
    this.jogspeed_b = 0;
    this.jogspeed_c = 0;
    this.maxjerk_xy = 100;
    this.maxjerk_y = 100;
    this.maxjerk_z = 50;
    this.maxjerk_a = 20;
    this.maxjerk_b = 20;
    this.maxjerk_c = 20;
    this.cmd_StartX = 0;
    this.cmd_StartY = 0;
    this.cmd_StartZ = 0;
    this.cmd_StartA = 0;
    this.cmd_StartB = 0;
    this.cmd_StartC = 0;
    this.paused = false;
    this.feedhold = false;
    this.resumeAllowed = true;
    this.lastNoZPullup = 0;
    this.continue_callback = null;
    this.vs_change = 0;
    this.absoluteMode = true;
    this.lastFilename = "";

    // Physical machine state
    this.machine = null;
    this.driver = null;
    this.inManualMode = false;
}
util.inherits(SBPRuntime, events.EventEmitter);

SBPRuntime.prototype.toString = function () {
    return "[SBPRuntime]";
};

// This must be called at least once before instantiating an SBPRuntime object
SBPRuntime.prototype.loadCommands = function (callback) {
    var commands = require("./commands").load();
    var proto = Object.getPrototypeOf(this);
    for (var attr in commands) {
        proto[attr] = commands[attr];
    }
    callback(null, this);
};

// Connect this runtime to the machine model
//    machine - The machine model to connect
SBPRuntime.prototype.connect = function (machine) {
    this.machine = machine;
    this.driver = machine.driver;
    this.status_handler = this._onG2Status.bind(this);
    this.driver.on("status", this.status_handler);
    this.status_report = {};
    this.machine.status.line = null;
    this.machine.status.nb_lines = null;
    this._update();
    this.cmd_posx = this.posx;
    this.cmd_posy = this.posy;
    this.cmd_posz = this.posz;
    this.cmd_posa = this.posa;
    this.cmd_posb = this.posb;
    this.cmd_posc = this.posc;
    this.cmd_StartX = this.posx;
    this.cmd_StartY = this.posy;
    this.cmd_StartZ = this.posz;
    this.cmd_StartA = this.posa;
    this.cmd_StartB = this.posb;
    this.cmd_StartC = this.posc;

    this.connected = true;
    this.ok_to_disconnect = false; ////## remove; this is a temp fix for cannot-disconnect ?
    log.info("####=Connected OpenSBP runtime.");
};

// Disconnect this runtime from the machine model.
// Throws an exception if the runtime can't be disconnected.
// (Runtime can't be disconnected when it is busy running a file)
SBPRuntime.prototype.disconnect = function () {
    if (!this.machine) {
        return;
    }

    if (this.ok_to_disconnect) {
        this.driver.removeListener("status", this.status_handler);
        this.machine = null;
        this.driver = null;
        this.connected = false;
        log.info("####=Disconnected OpenSBP runtime.");
    } else {
        throw new Error("Cannot disconnect OpenSBP runtime.");
    }
};

// Execute the provided code
// If the code is a string, interpret it as OpenSBP code
// If it is an object, interpret it as a manual drive command
//          s - The command to execute (string or object)
//   callback - Called once the command is issued (or with error if error) - NOT when the command is done executing
SBPRuntime.prototype.executeCode = function (s, callback) {
    log.info("####=.executeCode");
    this.init();

    if (typeof s === "string" || s instanceof String) {
        // Plain old string interprets as OpenSBP code segment
        this.runString(s, callback);
    } else {
        // If we're in manual mode, interpret an object as a command for that mode
        // The OpenSBP runtime can enter manual mode with the 'SK' command so we have this code here to mimick that mode
        if (this.inManualMode) {
            // The code here is essentially taken from the manual runtime, and uses the same underlying helper class,
            // ManualDriver (/runtime/manual/driver.js) to actually manage the machine state
            // TODO:  If this is duplicating manual runtime both should access shared functions for this behavior.
            switch (s.cmd) {
                case "enter":
                    this.enter();
                    break;
                default:
                    //
                    if (!this.helper) {
                        log.warn("Can't accept command '" + s.cmd + "' - not entered.");
                        this.machine.setState(this, "idle"); // switching to idle sometimes seems to create issues ?
                        return;
                    }
                    switch (s.cmd) {
                        case "exit":
                            this.helper.fromFile = true; // flag that this is SK invoked in file; will surpress M30/stat:4
                            this.helper.exit();
                            break;

                        case "start":
                            this.helper.startMotion(s.axis, s.speed, s.second_axis, s.second_speed);
                            break;

                        case "stop":
                            this.helper.stopMotion();
                            break;

                        case "quit":
                            this.helper.quitMove();
                            break;

                        case "maint":
                            this.helper.maintainMotion();
                            break;

                        case "goto":
                            this.helper.goto(s.move);
                            break;

                        case "set":
                            this.helper.set(s.move);
                            break;

                        case "fixed":
                            if (!this.helper) {
                                this.enter();
                            }
                            this.helper.nudge(s.axis, s.speed, s.dist, s.second_axis, s.second_dist);
                            break;

                        default:
                            log.error("Don't know what to do with '" + s.cmd + "' in manual command.");
                            break;
                    }
            }
        }
    }
};

// Check whether the code needs auth
// There are lots of SBP commands that need not require authorization to run,
// but we've kept it simple here and only green-lit Zeroing (Z) commands
SBPRuntime.prototype.needsAuth = function (s) {
    var lines = s.split("\n");
    lines = lines.filter(Boolean);
    for (var i = 0, x = lines.length; i < x; i++) {
        if (lines[i].toUpperCase().charAt(0) !== "Z") {
            return true;
        }
    }
    return false;
};

// Run the provided string in OpenSBP format.
// Unfortunately, because of operations that require the WHOLE file to be analyzed (analyzing labels, mainly)
// the entire file has to be read into memory and processed before motion can start.  This causes substantial slowdown
// for big files that really isn't necessary.
// Returns
// TODO The "load the whole file" thing can be fixed, or at least worked around.  It's been suggested that subroutines
//      are typically at the beginning and end of a file, so prefetching the last N lines of code from a file to fish labels out of it
//      might provide a way for *most* files to work properly, falling back to slower behavior only on truly weird files, which are rare
//      enough not to count at all.
// TODO At the very least, this function should simply take the string provided and stream it into runStream - they do the same thing.
//          s - The string to run
//   callback - Called when the program has ended
SBPRuntime.prototype.runString = function (s) {
    log.info("####=.runString");
    try {
        // Initialize the program
        this.pc = 0;
        this.program = [];
        // Break the string into lines
        var lines = s.split("\n");

        // The machine status `nb_lines` indicates the total number of lines in the currently running file
        // If this is a "top level" file (that is, the file being directly run and not a macro being called) set that value
        if (this.machine) {
            if (this.file_stack.length === 0) {
                this.machine.status.nb_lines = lines.length - 1;
            }
        }

        // Parse the program.  Bail with a useful error message if parsing fails.
        // "Useful" is relative.  The PegJS errors are pretty arcane... TODO - we could probably do better.
        // We catch parse errors separately from other errors because the *parser reports line numbers differently* than
        // they will be accessed once the program has been parsed (and we want to report the line number always when we have an error)
        try {
            this.program = parser.parse(s);
        } catch (e) {
            log.error(e);
            this._abort(e);
        } finally {
            log.tock("Parse file");
        }

        // Configure affine transformations on the file
        this._setupTransforms();

        // Initialize the runtime state
        this.init();

        // Copy the general config settings into runtime memory
        this._loadConfig();

        // Build a map of labels to line numbers
        // This step unfortunately requires the whole file
        this._analyzeLabels();
        log.debug("Labels analyzed...");

        // Check all the GOTO/GOSUBs against the label table
        this._analyzeGOTOs();
        log.debug("GOTOs analyzed...");

        // Start running the actual code, now that everything is prepped
        return this._run();
    } catch (e) {
        // A failure at any stage (except parsing) will land us here
        if (this.isInSubProgram()) {
            log.error(e);
            this._abort(e);
        } else {
            log.error(e);
            this._end(e);
        }
    }
};

// Run the provided stream of text in OpenSBP
// See documentation above for runString - this works the same way.
//   callback - Called when run is complete or with error if there was an error.
SBPRuntime.prototype.runStream = function (text_stream) {
    log.info("####=.runStream");
    try {
        // Initialize the program
        this.pc = 0;
        this.program = [];
        // Even though we're "streaming" in this function, we still have to parse
        // the entire body of data before we can continue processing the file.
        // That's why the business end of this function occurs in the 'end' handler
        var st = parser.parseStream(text_stream);

        // The stream produced by parser.parseStream produces fully parsed program lines,
        // which can just be added to the program as they come in.
        st.on(
            "data",
            function (data) {
                this.program.push(data);
            }.bind(this)
        );

        // Stream is fully processed
        st.on(
            "end",
            function () {
                try {
                    log.tock("Parse file");

                    // The machine status `nb_lines` indicates the total number of lines in the currently running file
                    // If this is a "top level" file (that is, the file being directly run and not a macro being called) set that value
                    // TODO I've never liked nb_lines as a name
                    var lines = this.program.length;
                    if (this.machine) {
                        if (this.file_stack.length === 0) {
                            this.machine.status.nb_lines = lines - 1;
                        }
                    }

                    // Configure affine transformations on the file
                    this._setupTransforms();

                    // Initialize the runtime state
                    this.init();

                    // Copy the general config settings into runtime memory
                    this._loadConfig();

                    log.tick();
                    // Build a map of labels to line numbers
                    // This step unfortunately requires the whole file
                    this._analyzeLabels();
                    log.tock("Labels analyzed...");

                    // Check all the GOTO/GOSUBs against the label table
                    this._analyzeGOTOs();
                    log.debug("GOTOs analyzed...");
                    log.tock("Analyzed GOTOs");

                    // Start running the actual code, now that everything is prepped
                    return this._run();
                } catch (e) {
                    if (this.isInSubProgram()) {
                        log.error(e);
                        this._abort(e);
                    } else {
                        log.error(e);
                        this._end(e);
                    }
                }
            }.bind(this)
        );

        // Add error handling for the stream
        st.on(
            "error",
            function (e) {
                if (this.isInSubProgram()) {
                    log.error(e);
                    this._abort(e);
                } else {
                    log.error(e);
                    this._end(e);
                }
            }.bind(this)
        );

        return undefined;
    } catch (e) {
        if (this.isInSubProgram()) {
            log.error(e);
            this._abort(e);
        } else {
            log.error(e);
            this._end(e);
        }
    }
};

// Internal function to copy config settings to local fields of this runtime
// We consult/update local fields rather than manipulating the configuration directly
// This prevents changes made to critical settings in files from being permanent (unless we want them to be)
SBPRuntime.prototype._loadConfig = function () {
    var settings = config.opensbp.getMany([
        "movexy_speed",
        "movez_speed",
        "movea_speed",
        "moveb_speed",
        "movec_speed",
        "jogxy_speed",
        "jogy_speed",
        "jogz_speed",
        "joga_speed",
        "jogb_speed",
        "jogc_speed",
        "xy_maxjerk",
        "y_maxjerk",
        "z_maxjerk",
        "a_maxjerk",
        "b_maxjerk",
        "c_maxjerk",
        "safeZpullUp",
    ]);
    this.movespeed_xy = settings.movexy_speed;
    this.movespeed_z = settings.movez_speed;
    this.movespeed_a = settings.movea_speed;
    this.movespeed_b = settings.moveb_speed;
    this.movespeed_c = settings.movec_speed;
    this.jogspeed_xy = settings.jogxy_speed;
    this.jogspeed_y = settings.jogxy_speed;
    this.jogspeed_z = settings.jogz_speed;
    this.jogspeed_a = settings.joga_speed;
    this.jogspeed_b = settings.jogb_speed;
    this.jogspeed_c = settings.jogc_speed;
    this.maxjerk_xy = settings.xy_maxjerk;
    this.maxjerk_y = settings.xy_maxjerk;
    this.maxjerk_z = settings.z_maxjerk;
    this.maxjerk_a = settings.a_maxjerk;
    this.maxjerk_b = settings.b_maxjerk;
    this.maxjerk_c = settings.c_maxjerk;
    this.safeZpullUp = settings.safeZpullUp;

    // need these to control conversion or not of ABC axis for case of rotary mode
    var axis_types = config.driver.getMany(["aam", "bam", "cam"]);
    this.axis_a = axis_types.aam;
    this.axis_b = axis_types.bam;
    this.axis_c = axis_types.cam;
};

// Save runtime configuration settings to the opensbp settings file
//   callback - Called when config has been written
SBPRuntime.prototype._saveConfig = async function (callback) {
    var sbp_values = {};
    sbp_values.movexy_speed = this.movespeed_xy;
    sbp_values.movez_speed = this.movespeed_z;
    sbp_values.movea_speed = this.movespeed_a;
    sbp_values.moveb_speed = this.movespeed_b;
    sbp_values.movec_speed = this.movespeed_c;
    sbp_values.jogxy_speed = this.jogspeed_xy; // nb special case
    sbp_values.jogy_speed = this.jogspeed_xy;
    sbp_values.jogz_speed = this.jogspeed_z;
    sbp_values.joga_speed = this.jogspeed_a;
    sbp_values.jogb_speed = this.jogspeed_b;
    sbp_values.jogc_speed = this.jogspeed_c;
    sbp_values.xy_maxjerk = this.maxjerk_xy; // nb special case
    sbp_values.y_maxjerk = this.maxjerk_xy;
    sbp_values.z_maxjerk = this.maxjerk_z;
    sbp_values.a_maxjerk = this.maxjerk_a;
    sbp_values.b_maxjerk = this.maxjerk_b;
    sbp_values.c_maxjerk = this.maxjerk_c;
    sbp_values.safeZpullUp = this.safeZpullUp;
    try {
        await config.opensbp.setManyWrapper(sbp_values);
        callback();
    } catch (error) {
        log.error(error);
    }
};

// Save runtime driver settings to settings files
//   callback - Called when config has been written
SBPRuntime.prototype._saveDriverSettings = async function (callback) {
    var g2_values = {};
    try {
        await config.driver.setManyWrapper(g2_values);
        callback();
    } catch (error) {
        log.error(error);
    }
};

// Run a file on disk.
//   filename - Full path to file on disk
//   callback - Called when file is done running or with error if error
SBPRuntime.prototype.runFile = function (filename) {
    log.info("####=.runFile");
    this.lastFilename = filename;
    var st = fs.createReadStream(filename);
    this.runStream(st);
};

// Simulate the provided file, returning the result as g-code string
////## A primary spot for preview enhancement ???
// TODO - this function could return a stream, and you could stream this back to the client to speed up simulation
//          s - OpenSBP string to run
//   callback - Called with the g-code output or with error if error
SBPRuntime.prototype.simulateString = function (s, x, y, z, callback) {
    this.cmd_StartX = x; // need to capture these for processing commands outside of runtime
    this.cmd_StartY = y;
    this.cmd_StartZ = z;
    if (this.ok_to_disconnect) {
        this.disconnect();
        var st = this.runString(s);
        var chunks = [];
        st.on("data", function (chunk) {
            chunks.push(chunk);
        });
        st.on("end", function () {
            callback(null, chunks.join(""));
        });
    } else {
        callback(new Error("Cannot simulate while OpenSBP runtime is busy."));
    }
};

// Handler for G2 status reports
//   status - The status report as sent by G2 to the host
SBPRuntime.prototype._onG2Status = function (status) {
    // This was happening at some point, so this was mostly for debug - keep an eye out.
    if (!this.connected) {
        log.warn("OpenSBP runtime got a status report while disconnected.");
        return;
    }

    // If we die then we are dead.
    // The first rule of tautology club is the first rule of tautology club.
    //TODO: Should Interlock be treated as Dead? ... Probaby, yes. This is unsupported G2 interlock, not FabMo interlock.
    switch (status.stat) {
        case this.driver.STAT_INTERLOCK:
        case this.driver.STAT_SHUTDOWN:
        case this.driver.STAT_PANIC:
            return this.machine.die("A G2 exception has occurred. You must reboot your tool.");
    }

    // Update the machine of the driver status
    // TODO: separation of concerns dictates this should be part of an update method on the machine.
    for (var key in this.machine.status) {
        if (key in status) {
            this.machine.status[key] = status[key];
        }
    }
    // Update the machine copy of g2 status variables
    for (key in status) {
        this.status_report[key] = status[key];
    }

    // TODO: separation of concerns dictates this should be part of an update method on the machine.
    this.machine.emit("status", this.machine.status);
};

// Update the internal state of the runtime with data from the tool
SBPRuntime.prototype._update = function () {
    if (this.machine) {
        var status = this.machine.status || {};
    } else {
        status = {};
    }
    this.posx = status.posx || 0.0;
    this.posy = status.posy || 0.0;
    this.posz = status.posz || 0.0;
    this.posa = status.posa || 0.0;
    this.posb = status.posb || 0.0;
    this.posc = status.posc || 0.0;
    this.cmd_StartX = status.posx || 0.0;
    this.cmd_StartY = status.posy || 0.0;
    this.cmd_StartZ = status.posz || 0.0;
    this.cmd_StartA = status.posa || 0.0;
    this.cmd_StartB = status.posb || 0.0;
    this.cmd_StartC = status.posc || 0.0;
};

// Evaluate a list of arguments provided (for commands)
// Returns a scrubbed list of evaluated arguments to be passed to command handlers
//   command - The two-character mnemonic for the command, as a string (eg MX,J3,etc)
//      args - A list of the arguments that were provided with the command by the user (as strings)
SBPRuntime.prototype._evaluateArguments = function (command, args) {
    // Scrub the argument list:  extend to the correct length, mark undefined values as undefined
    // Previously, the "prm" file (sb3_commands.json) was used to substitute default values for commands, but now, that is mostly done by
    // the command handlers themselves.  Still, this is a good place to throw an exception if an argument doesn't pass a sanity check.
    var scrubbed_args = [];
    if (command in sb3_commands) {
        var params = sb3_commands[command].params || [];

        // This is a possibly helpful warning, but is spuriously issued in some cases where commands take no arguments (depending on whitespace, etc.)
        // TODO - fix that
        if (args.length > params.length) {
            if (params.length === 0 && args.length === 1 && args[0] === "") {
                log.debug(" -- a no-parameter command");
            } else {
                log.warn(
                    "More parameters passed into " +
                        command +
                        " (" +
                        args.length +
                        ")" +
                        "(" +
                        params +
                        ")" +
                        " than are supported by the command. (" +
                        params.length +
                        ")"
                );
            }
        }

        for (var i = 0; i < params.length; i++) {
            if (args[i] !== undefined && args[i] !== "") {
                // Arguments that have meat to them are added into the scrubbed list
                scrubbed_args.push(args[i]);
            } else {
                // Arguments that aren't are added as 'undefined'
                scrubbed_args.push(undefined);
            }
        }
    } else {
        // TODO - is this really the right behavior here?
        scrubbed_args = [];
    }

    // Actually evaluate the arguments and return the list
    var retval = [];
    for (i = 0; i < scrubbed_args.length; i++) {
        retval.push(this._eval(scrubbed_args[i]));
    }
    return retval;
};

// Returns true if the provided command breaks the stack
// A stack-breaking command is the shopbot term for a command that must wait for any running commands to complete execution before
// they are able to execute.  It is similar to the difference in g-code between M100 and M101.  Any command, expression evaluation, or
// comparison that needs to read the position of the tool breaks the stack.  Certain control flow statements break the stack.
// Macro calls break the stack.  Currently conditional evaluations break the stack (IF statements) even though they should really only
// break the stack if the expression being evaluated breaks the stack.  (TODO - fix that.)
// TODO - System variable evaluations should break the stack
// TODO - we should probably distinguish between the two meanings of "command" here - the cmd argument to this function is the object
//        that represents a single line of the program but isn't necessarily one of the two-character OpenSBP commands. (Could be an IF
//        statement or GOTO or whatever)  The command type "cmd" refers specifically to the two-character OpenSBP commands.
// Returns true if the command breaks the stack, false otherwise
//   cmd - Command object to evaluate
SBPRuntime.prototype._breaksStack = function (cmd) {
    var result;
    log.info("####=._breaksStack");

    // Any command that has an expression in one of its arguments that breaks the stack, breaks the stack.
    if (cmd.args) {
        for (var i = 0; i < cmd.args.length; i++) {
            if (this._exprBreaksStack(cmd.args[i])) {
                log.warn("STACK BREAK for an expression: " + JSON.stringify(cmd.args[i]));
                return true;
            }
        }
    }

    switch (cmd.type) {
        case "cmd":
            // Commands have a means of automatically specifying whether or not they break the stack.  If their command handler
            // accepts a second argument (presumed to be a callback) in addition to their argument list, they are stack breaking.
            var name = cmd.cmd;
            if (name in this && typeof this[name] == "function") {
                var f = this[name];
                if (f && f.length > 1) {
                    return true;
                }
            }
            result = false;
            break;

        case "dialog":
        case "pause":
            return true;

        case "cond":
            //TODO , we should check the expression for a stack break, as well as the .stmt
            return true;
        case "weak_assign":
        case "assign":
            // TODO: These should only break the stack if they assign to or read from expressions that break the stack
            result = true;
            break;
        //return this._exprBreaksStack(cmd.var) || this._exprBreaksStack(cmd.expr)

        case "custom":
            // Macro calls should break the stack
            result = true;
            break;

        case "return":
        case "goto":
        case "gosub":
            // TODO - Control flow needn't necessarily break the stack
            result = true;
            break;

        case "open":
            result = true;
            break;

        case "event":
            result = true; // TODO DEPRECATE
            break;

        case "fail":
        case "quit":
        case "endall":
        case "end":
            // These statements update the system state and need to wait for the machine to stop to execute
            result = true;
            break;

        default:
            result = false;
            break;
    }
    return result;
};

// Returns true if this expression breaks the stack.
// System variable evaluation breaks the stack.  No other expressions do.
SBPRuntime.prototype._exprBreaksStack = function (expr) {
    if (!expr) {
        return false;
    }
    if (expr.op === undefined) {
        return expr[0] == "%"; // For now, all system variable evaluations are stack-breaking
    } else {
        return this._exprBreaksStack(expr.left) || this._exprBreaksStack(expr.right);
    }
};

// Start the stored program running; manage changes
// Return the stream of g-codes that are being run, which will be *fed by the asynchronous running process*.
// This function is called ONCE at the beginning of a program, and is not called again until the program
// completes, except if a macro (subprogram) is encountered, in which case it is called for that program as well.
SBPRuntime.prototype._run = function () {
    // Set state variables to kick things off
    log.info("####=._run");

    this.started = true;
    this.waitingForStackBreak = false;
    this.gcodesPending = false;
    this.probingInitialized = false;
    this.probingPending = false;
    this.probePin = null;
    log.info("Starting OpenSBP program {SBPRuntime.proto._run}");
    if (this.machine) {
        this.machine.setState(this, "running");
    }

    // Create a stat handler that does a few things:
    // 1. Call _executeNext when the motion system is out of moves to feed it more program
    // 2. Set the machine state to paused or running based on the state of the motion system
    // 3. Handle a feedhold edge case (feedhold issued while system was not executing motion)
    var onStat = function (stat) {
        if (!this.driver) {
            log.warn("OpenSBP Runtime got a status report while disconnected.");
            return;
        }
        log.debug("onSTAT ..." + stat);
        if (this.inManualMode) {
            return;
        }
        switch (stat) {
            case this.driver.STAT_STOP:
                // Only update and call execute next if we're waiting on pending gcodes or probing
                // ... and expecting this stat:3
                // For probing we do not turn off the pending if we have not passed the Initialization phase
                if ((this.probingPending && !this.probingInitialized) || this.driver.status.targetHit) {
                    this.driver.status.targetHit = false;
                    this.probingPending = false;
                    this.emit_gcode('M100.1("{prbin:0}")'); // turn off probing targets
                    this.prime();
                    //log.debug("COMPLETETED PENDING PROBING =(cleared)============####")
                    this._executeNext();
                    break;
                }
                if (this.gcodesPending) {
                    this.gcodesPending = false;
                    log.debug("COMPLETETED PENDING GCODES =(cleared)============####");
                    this._executeNext();
                    break;
                }
                break;
            case this.driver.STAT_HOLDING:
                this.feedhold = true;
                if (this.machine.pauseTimer) {
                    clearTimeout(this.machine.pauseTimer);
                    this.machine.pauseTimer = false;
                    this.machine.setState(this, "paused", {
                        message: "Paused by user.",
                    });
                } else {
                    this.machine.setState(this, "paused");
                }
                break;

            case this.driver.STAT_PROBE:
                //log.debug("PROBING INITIALIZATION COMPLETED; BUT still PENDING =====####");
                this.probingInitialized = false;
                this.machine.setState(this, "probing");
                break;

            case this.driver.STAT_RUNNING:
                if (!this.inManualMode) {
                    if (this.machine.status.state != "running") {
                        //Do not set state to running until opensbp pause is complete
                        if (this.paused) {
                            return;
                        }
                        this.machine.setState(this, "running");
                        if (this.pendingFeedhold) {
                            this.pendingFeedhold = false;
                            this.driver.feedHold();
                            this.machine.status.inFeedHold = false;
                        }
                    }
                }
                break;
            // TODO: Can we rely on STAT_END only showing up when ending a cycle and always showing up when ending a cycle.
            //      Enabaling this appears to lead to extra and pre-mature attempts to activate _end().
            case this.driver.STAT_END:
                log.debug("STAT_END: Cycle Ending ... no handling");
                break;

            default:
                log.warn("OpenSBP Runtime Unhandled Stat: " + stat);
        }
    };

    if (this.isInSubProgram()) {
        // If this function was called and we're in a subprogram, just execute the next instruction
        log.debug("Running Subprogram");
        this._executeNext();
    } else {
        // If this is a top level run, create a pass-through stream to receive the data
        // and start executing with it.  As the program is processed the stream will be fed
        this.stream = new stream.PassThrough();
        if (this.driver) {
            this.driver
                .runStream(this.stream)
                .on("stat", onStat.bind(this))
                .then(
                    function () {
                        // This ensures we run _end on driver stream end
                        this.file_stack = [];
                        //                       this._end();
                    }.bind(this)
                );
        }

        // Actually begin program execution
        this._executeNext();
    }

    // This function returns the pass-through stream (but it's also saved as this.stream)
    return this.stream;
};

// Return true if this is not the "top level" program (ie: we're in a macro call.)
SBPRuntime.prototype.isInSubProgram = function () {
    return this.file_stack.length > 0;
};

// Continue running the current program (until the next stack break)
// _executeNext() will dispatch the next chunk if appropriate, once the current chunk is finished
SBPRuntime.prototype._executeNext = function () {
    // Copy values from the machine to our local state variables
    log.info("####=._executeNext");
    this._update();

    // _executeNext is only for resuming an already running program.  It's not a substitute for _run()
    if (!this.started) {
        log.warn("Got a _executeNext() but not started");
        return;
    }

    // do not continue execution if there is a pending error
    if (this.pending_error || this.end_message) {
        log.warn("got a _execute next with pending Error or in Fail condition");
        return;
    }

    // If _executeNext is called but we're paused, stay paused. (We'll call _executeNext again on resume)
    if (this.paused) {
        log.info("Program is paused.");
        return;
    }

    if (this.feedhold) {
        log.info("Program is in feedhold.");
        return;
    }

    if (this.pc >= this.program.length) {
        log.info("End of program reached. (pc = " + this.pc + ")");
        // Here we've reached the end of the program, but there's possibly not enough
        // g-codes queued up for the driver to want to send them out, so go ahead and prime it
        // to send out those last few.
        this.prime();

        // this.gcodesPending gets set when we emit_gcode, and cleared when the tool reaches the STAT_STOP
        // state (because it's run everything that it's recieved) - If pending is true, that means there's
        // more work to do before finishing out the program.  We prime()d above, so those instructions will
        // get executed (and the stat handler will call _executeNext again once the machine stops moving)
        if ((this.gcodesPending && this.driver) || (this.probingPending && this.driver)) {
            log.debug("GCodes or Probing is still pending...");
            return;
        }

        // Handle the end of program differently if we're a subprogram
        if (this.isInSubProgram()) {
            log.debug("This is a nested end.  Popping the file stack.");
            // Pop the stack (which will restore the program state, including pc to the calling program)
            this._popFileStack();
            // Increment the pc and execute, as normal
            this.pc += 1;
            setImmediate(this._executeNext.bind(this));
            return;
        } else {
            log.debug("This is not a nested end.  No stack.");

            // This ends the machining cycle

            // If no driver, we just go straight to the _end() (as in simulation)
            if (!this.driver) {
                this._end();
            } else {
                if (!this.quit_pending) {
                    // EOF send M30.
                    this.emit_gcode("M30");
                    // ... _end triggers exit from this runtime
                    this._end();
                    // ... quit_pending is a local runtime flag to prevent multiple M30s etc
                    this.quit_pending = true;
                }
            }
            return;
        }
    }

    // Below here we're NOT at the end of the program,
    // so it's time to actually execute the next instruction
    // Pull the current line of the program from the list
    var line = this.program[this.pc];
    var breaksTheStack = this._breaksStack(line);

    if (breaksTheStack) {
        log.debug("Stack break: " + JSON.stringify(line));
        this.prime();

        // Broadly, if the next instruction is a stack breaking command, we're only
        // allowed to execute it if everything up till now has finished executing
        // (there are no instructions pending in the motion system)
        // We request a status report, just to catch the case where there are non-motion
        // g-codes executing, and we might not have gotten a report that indicates that the machine
        // has stopped executing stuff.  Of course we only do that if there's a driver (we're not simulating)

        if (this.probingPending && this.driver) {
            log.debug("Deferring because still PROBING ......");
            return; // We can return knowing that we'll be called again when the system enters STAT_STOP
        } else if (this.gcodesPending && this.driver) {
            log.debug("Deferring because g-codes PENDING ......");
            return; // We can return knowing that we'll be called again when the system enters STAT_STOP
        } else {
            // G2 is stopped, execute stack breaking command now
            try {
                log.debug("executing: " + JSON.stringify(line));
                this._execute(line, this._executeNext.bind(this));
                return;
            } catch (e) {
                // log error and trigger abort
                log.error(e);
                return this._abort(e);
            }
        }
    } else {
        // If this is a non-stack-breaking command, go ahead and execute it.
        // Mostly, these commands will call emit_gcode, which will push instructions into the stream
        // that drives the motion controller.
        try {
            this._execute(line);
            // Keep on executing!  No reason not to.
            setImmediate(this._executeNext.bind(this));
        } catch (e) {
            // log error and trigger abort
            //log.error(e);
            return this._abort(e);
        }
    }
};

// Prime the driver associated with this runtime, if it exists.
SBPRuntime.prototype.prime = function () {
    log.info("####=.prime");
    if (this.driver) {
        this.driver.prime();
    }
};

// Set a pending error and end the stream feeding the motion system
// The pending error is picked up by _executeNext and the program is ended as a result.
//   error - The error message
SBPRuntime.prototype._abort = function (error) {
    // this.pending_error = error;
    log.info("####=._abort");
    this.driver.quit();
    this._end(error);
};

// End the program
// This restores the state of both the runtime and the driver, and sets the machine state appropriately
//   error - (optional) If the program is ending due to an error, this is it.  Can be string or error object.
SBPRuntime.prototype._end = function (error) {
    // No Error populate with any pending error
    log.info("####=._end");
    if (!error && this.pending_error) {
        error = this.pending_error;
    }

    if (this.pending_error) {
        log.error("Pending error: " + this.pending_error);
        //cleanup("early abort");
        log.debug("Exiting _end method on ABORT");
        return;
    }

    // Normalize the error ending state; pass as much information as possible to report
    // Standardizing reporting format to:
    //                    An Error Occurred!
    //         @line-<line number>:  <error message>
    // ... with some variations
    this.pending_error = error;
    let error_msg = null;
    //error.line = this.pc + 1;
    if (error) {
        if (Object.prototype.hasOwnProperty.call(error, "offset")) {
            error_msg = `@line-${error.offset}(${error.column}):  ${error.message}`;
        } else if (Object.prototype.hasOwnProperty.call(error, "message")) {
            error_msg = `@line-${this.pc + 1}:  ${error.message}`;
        } else {
            error_msg = error;
        }
    }

    // Fail command message
    if (!error_msg && this.end_message) {
        error_msg = this.end_message;
    }

    log.debug("Calling the non-nested (toplevel) end");
    // Log the error for posterity
    if (error) {
        log.error(error);
    }

    // Cleanup deals the "final blow" - cleans up streams, sets the machine state and calls the end callback
    var cleanup = function (error) {
        if (this.machine && error) {
            this.machine.setState(this, "stopped", { error: error });
        }
        // TODO: verify if this is needed
        if (!this.machine) {
            this.stream.end();
        }
        // Clear the internal state of the runtime (restore it to its initial state)
        //TODO: Refactor to new reset function that both init and _end can call? Break out what needs to be initialized vs. reset.
        this.ok_to_disconnect = true;

        this.init();
        //TODO: G2 stream should be closed when this triggers keep as safety?
        this.emit("end", this);
    }.bind(this);

    //TODO: Is all this needed here? Do we need to reset state? Can this be done without nested callbacks?
    if (this.machine !== null) {
        this.resumeAllowed = false;
        this.machine.restoreDriverState(
            // eslint-disable-next-line no-unused-vars
            function (err, result) {
                this.resumeAllowed = true;
                // log.debug("Driver state restored" + JSON.stringify(this.machine.status));
                // log.debug("this.machine.status.job:" + JSON.stringify(this.machine.status.job));
                if (this.machine.status.job !== null && this.machine.status.job !== undefined) {
                    log.debug("Job is not null or undefined");
                    this.machine.status.job.finish(
                        // eslint-disable-next-line no-unused-vars
                        function (err, job) {
                            this.machine.status.job = null;
                            cleanup(error_msg);
                            this.machine.setState(this, "idle");
                        }.bind(this)
                    );
                } else {
                    cleanup(error_msg);
                    this.machine.setState(this, "idle");
                }
            }.bind(this)
        );
    } else {
        cleanup(error_msg);
        log.debug("Exiting _end method");
    }
};

// Execute the specified command
//    command - The command object to execute
//   callback - Called when execution is complete or with error if error
SBPRuntime.prototype._executeCommand = function (command, callback) {
    if (command.cmd in this && typeof this[command.cmd] == "function") {
        // Command is valid and has a registered handler
        log.info("####=._executeCommand");

        // Evaluate the command arguments and extract the handler
        var args = this._evaluateArguments(command.cmd, command.args);
        var f = this[command.cmd].bind(this);

        if (f.length > 1) {
            // Stack breakers have the callback passed in, to be called when done.
            try {
                f(
                    args,
                    function commandComplete() {
                        // advance the pc and do the callback to mvoe on to next instruction
                        // TODO - We should allow commands to use an errback?  This would allow
                        //        for asynchronous errors in addition to the throw
                        this.pc += 1;
                        callback();
                    }.bind(this)
                );
            } catch (e) {
                // TODO - Should we throw the error here?!  This feels like an issue. (Sturmer, 5 years ago)
                // Update(th-6/15/23): Yes, we should throw the error here.  Otherwise, the error is
                //         swallowed and the program continues to run. Done.
                log.error("Error in a stack-breaking command");
                var e_more = e + " (in [" + command.cmd + "] Line-" + this.pc + ").";
                log.error(e_more);
                throw e_more;
            }
            return true;
        } else {
            // This is NOT a stack breaker, run immediately, increment PC, call the callback.
            try {
                f(args);
            } catch (e) {
                log.error("Error in a non-stack-breaking command");
                log.error(e);
                throw e;
            }
            this.pc += 1;
            // We use the callback, stack breaker or not
            if (callback != undefined) {
                setImmediate(callback);
            }
            return false;
        }
    } else {
        // We don't know what this is.  Whatever it is, it doesn't break the stack.
        this._unhandledCommand(command);
        this.pc += 1;
        return false;
    }
};

// Run a custom cut (macro).  This function can be called from within another program or to start one.
//     number - The macro number to run
//   callback - Hmm.  Callback is called in simulation (and the macro is simply skipped) but not in for real times
SBPRuntime.prototype.runCustomCut = function (number, callback) {
    if (this.machine) {
        var macro = macros.get(number);
        if (macro) {
            // TODO: Should this just display the macro identifier or name?
            // log.debug("Running macro: " + JSON.stringify(macro));
            this._pushFileStack();
            this.runFile(macro.filename);
        } else {
            throw new Error("Can't run custom cut (macro) C" + number + ": Macro not found at " + (this.pc + 1));
        }
    } else {
        this.pc += 1;
        callback();
    }
    return true;
};

// Execute the provided command
// Returns true if execution breaks the stack (and calls the callback upon command completion)
// Returns false if execution does not break the stack (and callback is never called)
//   command - A single parsed line of OpenSBP code

SBPRuntime.prototype._execute = function (command, callback) {
    // Just skip over blank lines, undefined, etc.
    log.info("####=._execute");
    if (!command) {
        this.pc += 1;
        return;
    }

    // All correctly parsed commands have a type
    switch (command.type) {
        // A ShopBot Comand (M2, ZZ, etc...)
        case "cmd":
            var broke = this._executeCommand(command, callback);
            if (!broke) {
                if (callback != undefined) {
                    setImmediate(callback);
                }
            }
            return broke;

        // A C# command (custom cut)
        case "custom":
            this.runCustomCut(command.index, callback);
            return true;

        // A line of raw g-code
        case "gcode":
            log.debug("Running raw gcode in opensbp context.");
            log.debug(command.gcode);
            this.emit_gcode(command.gcode);
            this.pc += 1;
            return false;

        case "return":
            if (this.stack.length) {
                this.pc = this.stack.pop();
                setImmediate(callback);
                return true;
            } else {
                throw new Error("Runtime Error: Return with no GOSUB at " + (this.pc + 1));
            }

        case "end":
            if (this.isInSubProgram()) {
                // If in a subprogram, exit the subprogram
                this._popFileStack();
                this.pc += 1; // Move to the next instruction in the main program
                this._executeNext();
            } else {
                // If in the main program, end the runtime
                try {
                    this._end();
                } catch (err) {
                    log.error("Error during _end:", err);
                }
            }
            return true;

        case "endall":
            // Terminate the entire runtime
            try {
                this._end();
            } catch (err) {
                log.error("Error during _end:", err);
            }
            return true;

        case "fail":
            this.pc = this.program.length;
            if (command.message) {
                this.end_message = command.message;
                throw new Error(command.message);
            }
            setImmediate(callback);
            return true;

        case "goto":
            if (command.label in this.label_index) {
                var pc = this.label_index[command.label];
                log.debug("Hit a GOTO: Going to line " + pc + "(Label: " + command.label + ")");
                this.pc = pc;
                setImmediate(callback);
                return true;
            } else {
                throw new Error("Runtime Error: Unknown Label '" + command.label + "' at line " + (this.pc + 1));
            }

        case "gosub":
            if (command.label in this.label_index) {
                this.stack.push(this.pc + 1);
                log.debug("Pushing the current PC onto the stack (" + (this.pc + 1) + ")");
                this.pc = this.label_index[command.label];
                setImmediate(callback);
                return true;
            } else {
                throw new Error("Runtime Error: Unknown Label '" + command.label + "' at line " + (this.pc + 1));
            }

        case "assign":
            this.pc += 1;
            var value = this._eval(command.expr);
            this._assign(command.var, value, function () {
                callback();
            });
            return true;

        case "weak_assign":
            this.pc += 1;
            if (!this._varExists(command.var)) {
                // eslint-disable-next-line no-redeclare
                var value = this._eval(command.expr);
                this._assign(command.var, value, function () {
                    callback();
                });
            } else {
                setImmediate(callback);
            }
            return true;

        case "cond":
            if (this._eval(command.cmp)) {
                return this._execute(command.stmt, callback); // Warning RECURSION!
            } else {
                this.pc += 1;
                setImmediate(callback);
                return true;
            }

        case "comment":
            var comment = command.comment.join("").trim();
            if (comment != "") {
                //this.emit_gcode('( ' + comment + ' )') // TODO allow for comments
            }
            this.pc += 1;
            return false;

        case "label":
        case undefined:
            this.pc += 1;
            return false;

        case "pause":
            // PAUSE is somewhat overloaded.  In a perfect world there would be distinct states for pause and feedhold.
            this.pc += 1;
            if (command.expr) {
                var arg = this._eval(command.expr);
            }
            var input_var = command.var;
            if (u.isANumber(arg)) {
                // If argument is a number set pause with timer and default message.
                // In simulation, just don't do anything
                if (!this.machine) {
                    setImmediate(callback);
                    return true;
                }
                this.paused = true;
                this.machine.setState(this, "paused", u.packageModalParams({ timer: arg }));
                return true;
            } else {
                // In simulation, just don't do anything
                if (!this.machine) {
                    setImmediate(callback);
                    return true;
                }
                // If a message is provided, pause with a dialog
                var message = arg;
                if (!message) {
                    // If a message is not provided, use the comment from the previous line
                    var last_command = this.program[this.pc - 2];
                    if (last_command && last_command.type === "comment") {
                        message = last_command.comment.join("").trim();
                    }
                    if (!message) {
                        message = "Pause Command No Message.";
                    }
                }
                var modalParams = {};
                if (message) {
                    modalParams = u.packageModalParams({ message: message }, modalParams);
                }
                // Example of modal customization. Adds input param, sets ok button text to Submit, removes cancel/quit button.
                // TODO: This is an example of use for the custom modal.  We may wish to re-enable the cancel button s detailed below.
                if (input_var) {
                    var inputParams = {
                        input_var: input_var,
                        okText: "Submit",
                        cancelText: false, // remove or set new text to display cancel/quit button.
                        cancelFunc: false, // remove to enable quit job onclick
                    };
                    modalParams = u.packageModalParams(inputParams, modalParams);
                }
                this.paused = true;
                //Set driver in paused state
                this.machine.driver.pause_hold = true;
                this.machine.setState(this, "paused", modalParams);
                return true;
            }

        case "event":
            // Throw a useful exception for the no-longer-supported ON INPUT command
            this.pc += 1;
            throw new Error(
                "ON INPUT is no longer a supported command.  Make sure the program you are using is up to date.  Line: " +
                    (this.pc + 1)
            );

        default:
            // Just skip over commands we don't recognize
            // TODO - Maybe this isn't the best behavior?
            try {
                log.error("Unknown command: " + JSON.stringify(command));
            } catch (e) {
                log.error("Unknown command: " + command);
            }
            this.pc += 1;
            return false;
    }
};

// Return true if the provided variable exists in the current program context
// &Tool is a weird case.  (literally) - it will be accepted as defined no matter what it's case
// &Tool == &TOOL == &TOoL
//   identifier - The identifier to check
SBPRuntime.prototype._varExists = function (identifier) {
    if (identifier.type == "user_variable") {
        // User variable

        // Handle weird &Tool Exception case
        // (which exists because of old shopbot case insensitivity)
        if (identifier.name.toUpperCase() === "&TOOL") {
            identifier.name = "&TOOL";
        }

        return config.opensbp.hasTempVariable(identifier);
        //return config.opensbp.hasTempVariable(identifier.name);
    }

    if (identifier.type == "persistent_variable") {
        // Persistent variable
        return config.opensbp.hasVariable(identifier);
        //return config.opensbp.hasVariable(identifier.name);
    }
    return false;
};

// Assign a variable to a value
//   identifier - The variable to assign
//        value - The new value
SBPRuntime.prototype._assign = function (identifier, value) {
    // Determine the variable name
    let variableName;
    if (identifier.name) {
        variableName = identifier.name.toUpperCase();
    } else if (identifier.expr) {
        // Evaluate the expression to get the variable name
        variableName = this._eval(identifier.expr).toUpperCase();
    } else {
        throw new Error("Invalid identifier: missing 'name' and 'expr'");
    }

    let accessPath = identifier.access || [];

    // Evaluate accessPath
    accessPath = this._evaluateAccessPath(accessPath);

    // Update the variable in the config
    let variables;
    if (identifier.type === "user_variable") {
        variables = config.opensbp._cache["tempVariables"];
    } else {
        variables = config.opensbp._cache["variables"];
    }

    if (!(variableName in variables)) {
        // Initialize the variable if it doesn't exist
        variables[variableName] = {};
    }

    if (accessPath.length === 0) {
        // Direct assignment
        variables[variableName] = value;
    } else {
        // Nested assignment
        this._setNestedValue(variables[variableName], accessPath, value);
    }
};

SBPRuntime.prototype._evaluateAccessPath = function (access) {
    return access.map((part) => {
        if (part.type === "index") {
            const key = this._eval(part.value);
            return { type: part.type, value: key };
        } else if (part.type === "property") {
            return { type: part.type, value: part.name };
        } else {
            throw new Error("Unknown access part type: " + part.type);
        }
    });
};

SBPRuntime.prototype._setNestedValue = function (obj, accessPath, value) {
    let current = obj;
    for (let i = 0; i < accessPath.length - 1; i++) {
        const part = accessPath[i];
        const key = part.value;
        if (!(key in current)) {
            current[key] = {};
        }
        current = current[key];
    }
    const lastPart = accessPath[accessPath.length - 1];
    const lastKey = lastPart.value;
    current[lastKey] = value;
};

// Return the actual value of an expression.
// This function is for evaluating the leaves of the expression trees, which are either
// variables or constant numeric/string values.
//   expr - String that represents the leaf of an expression tree
SBPRuntime.prototype._eval_value = function (expr) {
    // log.debug("**-> Evaluating value: " + expr);
    if (typeof expr === "object" && (expr.type === "user_variable" || expr.type === "persistent_variable")) {
        return this._getVariableValue(expr);
    }
    if (typeof expr === "object" && expr.type === "system_variable") {
        return this.evaluateSystemVariable(expr);
    }
    var n = Number(String(expr));
    if (!isNaN(n)) {
        return n;
    }
    // If expr is a string that matches a command, return it as is
    if (typeof expr === "string" && this[expr]) {
        return expr;
    }
    return expr;
};

SBPRuntime.prototype._getVariableValue = function (identifier) {
    const variableName = identifier.name.toUpperCase();
    const accessPath = identifier.access || [];
    let variables;

    if (identifier.type === "user_variable") {
        variables = config.opensbp._cache["tempVariables"];
    } else {
        variables = config.opensbp._cache["variables"];
    }

    if (!(variableName in variables)) {
        throw new Error(`Variable ${identifier.type === "user_variable" ? "&" : "$"}${variableName} is not defined.`);
    }

    let value = variables[variableName];
    value = this._navigateAccessPath(value, accessPath);
    return value;
};

SBPRuntime.prototype._navigateAccessPath = function (value, accessPath) {
    for (let part of accessPath) {
        let key;
        if (part.type === "index") {
            key = this._eval(part.value);
        } else if (part.type === "property") {
            key = part.name;
        }
        if (value && key in value) {
            value = value[key];
        } else {
            throw new Error(`Property or index '${key}' not found.`);
        }
    }
    return value;
};

// Evaluate an expression.  Return the result.
// TODO - Make this robust to undefined user variables
//   expr - The expression to evaluate.  This is a *parsed* expression object
SBPRuntime.prototype._eval = function (expr) {
    // log.debug("Evaluating expression: " + JSON.stringify(expr));
    if (expr === undefined) {
        return undefined;
    }

    if (expr.op === undefined) {
        // Expression is unary - no operation.  Just evaluate the value.
        return this._eval_value(expr);
    } else {
        // Do the operation specified in the expression object (recursively evaluating subexpressions)
        switch (expr.op) {
            case "+":
                return this._eval(expr.left) + this._eval(expr.right);
            case "-":
                return this._eval(expr.left) - this._eval(expr.right);
            case "*":
                return this._eval(expr.left) * this._eval(expr.right);
            case "/":
                return this._eval(expr.left) / this._eval(expr.right);
            case ">":
                return this._eval(expr.left) > this._eval(expr.right);
            case "<":
                return this._eval(expr.left) < this._eval(expr.right);
            case ">=":
                return this._eval(expr.left) >= this._eval(expr.right);
            case "<=":
                return this._eval(expr.left) <= this._eval(expr.right);
            case "==":
            case "=":
                return this._eval(expr.left) == this._eval(expr.right);
            case "<>":
            case "!=":
                return this._eval(expr.left) != this._eval(expr.right);

            default:
                throw "Unhandled operation: " + expr.op;
        }
    }
};

// Initialize the runtime (set its internal state variables to their startup states)
SBPRuntime.prototype.init = function () {
    this.pc = 0;
    this.coordinateSystem = "G55";
    this.start_of_the_chunk = 0;
    this.stack = [];
    this.label_index = {};
    this.current_chunk = [];
    this.started = false;
    this.sysvar_evaluated = false;
    this.output = []; // Used in simulation mode only ??meaning??
    this.quit_pending = false; // this is runtime specific, not the global G2 driver "quit_pending"
    this.end_message = null;
    this.paused = false;
    this.feedhold = false;
    this.units = config.machine.get("units");
    this.pending_error = null;
    this.pendingFeedhold = false;

    if (this.transforms != null && this.transforms.level.apply === true) {
        this.leveler = new Leveler(this.transforms.level.ptDataFile);
    }
};

// Set the preferred units to the units provided.
// This function is called externally when the user changes the canonical system units.
//      units - The new unit system
//   callback - Called when the unit change has been made
SBPRuntime.prototype.setPreferredUnits = function (units, callback) {
    log.info("SBP runtime is setting the preferred units to " + units);
    this._loadConfig();
    this._setUnits(units);
    this._saveConfig(callback);
};

// Convert, Update, and Set parameters to the new current units
// (Converts internal state to the specified unit system; which is saved to disc)
SBPRuntime.prototype._setUnits = function (units) {
    // UNIT Primary Value is machine.units (e.g. config.machine.get("units")); though internal state is represented in multiple objects for convenience
    this.units = config.machine.get("last_units"); // current preferred units from last update
    units = u.unitType(units); // new version of unitType

    if (units === this.units) {
        return;
    }

    // Handle the update to new units and their display; using OpenSBP runtime for convenience, even it user may not use OpenSBP
    var convert = units === "in" ? u.mm2in : u.in2mm;
    var convertR = units === "in" ? u.mm2inR : u.in2mmR; // Round to keep display of speeds clean
    this.movespeed_xy = convertR(this.movespeed_xy);
    this.movespeed_z = convertR(this.movespeed_z);
    this.jogspeed_xy = convertR(this.jogspeed_xy);
    this.jogspeed_y = convertR(this.jogspeed_xy);
    this.jogspeed_z = convertR(this.jogspeed_z);
    this.maxjerk_xy = convertR(this.maxjerk_xy);
    this.maxjerk_y = convertR(this.maxjerk_xy);
    this.maxjerk_z = convertR(this.maxjerk_z);
    this.safeZpullUp = convertR(this.safeZpullUp);
    this.cmd_posx = convert(this.cmd_posx);
    this.cmd_posy = convert(this.cmd_posy);
    this.cmd_posz = convert(this.cmd_posz);
    // Only convert A, B, and C if they are in use as linear axes (#2)
    if (this.axis_a === 2) {
        this.movespeed_a = convertR(this.movespeed_a);
        this.jogspeed_a = convertR(this.jogspeed_a);
        this.maxjerk_a = convertR(this.maxjerk_a);
        this.cmd_posa = convert(this.cmd_posa);
        this.safeApullUp = convertR(this.safeApullUp);
    }
    if (this.axis_b === 2) {
        this.movespeed_b = convertR(this.movespeed_b);
        this.jogspeed_b = convertR(this.jogspeed_b);
        this.maxjerk_b = convertR(this.maxjerk_b);
        this.cmd_posb = convert(this.cmd_posb);
    }
    if (this.axis_c === 2) {
        this.movespeed_c = convertR(this.movespeed_c);
        this.jogspeed_c = convertR(this.jogspeed_c);
        this.maxjerk_c = convertR(this.maxjerk_c);
        this.cmd_posc = convert(this.cmd_posc);
    }
    this.units = units; // object representation of the current units
    config.machine.set("units", units); // Primary Storage of the current units in machine
    // See G2.js for call to update units display values
    config.machine.set("last_units", units);
};

// Compile an index of all the labels in the program
// this.label_index will map labels to line numbers
// An error is thrown on duplicate labels
SBPRuntime.prototype._analyzeLabels = function () {
    this.label_index = {};
    for (var i = 0; i < this.program.length; i++) {
        var line = this.program[i];
        if (line && line.type) {
            switch (line.type) {
                case "label":
                    if (line.value in this.label_index) {
                        throw new Error(`@line-${this.label_index[line.value]} and @line-${i + 1}: Duplicate labels `);
                    }
                    this.label_index[line.value] = i;
                    break;
            }
        }
    }
};

// Check all the GOTOS/GOSUBS in the program and make sure their labels exist
// Throw an error for undefined labels.
// TODO: Adress Macro Line Numbering issue
SBPRuntime.prototype._analyzeGOTOs = function () {
    for (var i = 0; i < this.program.length; i++) {
        var line = this.program[i];
        if (line) {
            switch (line.type) {
                case "cond":
                    if (line.stmt.type != "goto" && line.stmt.type != "gosub") {
                        break;
                    }
                    line = line.stmt;
                // No break: fall through in case of this being a label call
                case "goto":
                case "gosub":
                    if (line.label in this.label_index) {
                        // pass
                    } else {
                        // Add one to the line number so they start at 1
                        throw new Error(`@line-${i + 1}: Undefined label ` + line.label);
                    }
                    break;
                default:
                    // pass
                    break;
            }
        }
    }
};

// Return the value of the provided system variable.
//   v - System variable as a string, eg: "%(1)"
// SEE: Planning doc in progress on "Supported System Variables in FabMo"
// CURRENTLY a work in progress ...
SBPRuntime.prototype.evaluateSystemVariable = function (v) {
    var envelope = config.machine.get("envelope");
    if (v === undefined) {
        return undefined;
    }

    if (v.type != "system_variable") {
        return;
    }
    var n = this._eval(v.expr);
    switch (n) {
        case 1: // X Location
            return this.driver.status.posx;

        case 2: // Y Location
            return this.machine.status.posy;

        case 3: // Z Location
            return this.driver.status.posz;

        case 4: // A Location
            return this.machine.status.posa;

        case 5: // B Location
            return this.machine.status.posb;

        case 6: // C Location
            return this.driver.status.posc;

        case 7: // X Table Base
            return config.driver.get("g55x");

        case 8: // Y Table Base
            return config.driver.get("g55y");

        case 9: // Z Table Base
            return config.driver.get("g55z");

        case 10: // A Table Base
            return config.driver.get("g55a");

        case 11: // B Table Base
            return config.driver.get("g55b");

        case 12: // C Table Base
            return config.driver.get("g55c");

        case 25:
            var units = config.machine.get("units");
            if (units === "in") {
                return 0;
            } else if (units === "mm") {
                return 1;
            } else {
                return -1;
            }

        case 28:
            return config.opensbp.get("safeZpullUp");

        case 29:
            return config.opensbp.get("safeApullUp");

        case 51: // Note that these all fall through to the last
        case 52:
        case 53:
        case 54:
        case 55:
        case 56:
        case 57:
        case 58:
        case 59:
        case 60:
        case 61:
        case 62: // End of current inputs at #12
        case 63:
            return this.machine.status["in" + (n - 50)];

        // NOTE: More inputs are imagined here

        // PLANNING to Start Outputs at 71 with speeds above 100; so the following are just remnants at the moment
        case 71: // XY Move Speed
            return config.opensbp.get("movexy_speed");

        case 72: // XY Move Speed
            return config.opensbp.get("movexy_speed");

        case 73:
            return config.opensbp.get("movez_speed");

        case 74:
            return config.opensbp.get("movea_speed");

        case 75:
            return config.opensbp.get("moveb_speed");

        case 76:
            return config.opensbp.get("movec_speed");

        case 81:
            return config.driver.get("xjm");

        case 82:
            return config.driver.get("yjm");

        case 83:
            return config.driver.get("zjm");

        case 84:
            return config.driver.get("ajm");

        case 85:
            return config.driver.get("bjm");

        case 86:
            return config.driver.get("cjm");

        case 101: //Min Table limit X
            return envelope.xmin;

        case 102: //Max Table limit X
            return envelope.xmax;

        case 103: //Min Table limit Y
            return envelope.ymin;

        case 104: //Max Table limit Y
            return envelope.ymax;

        case 105: //Min Table limit Z
            return envelope.zmin;

        case 106: //Max Table limit Z
            return envelope.zmax;

        case 107: //Min Table limit A
            return envelope.amin;

        case 108: //Max Table limit A
            return envelope.amax;

        case 109: //Min Table limit B
            return envelope.bmin;

        case 110: //Max Table limit B
            return envelope.bmax;

        case 111: //Min Table limit C
            return envelope.cmin;

        case 112: //Max Table limit C
            return envelope.cmax;

        // PLANNING for Movespeeds starting at 121

        default:
            //throw new Error("Unknown System Variable: " + JSON.stringify(v) + " on line " + (this.pc + 1));
            // Add one to the line number so they start at 1
            throw new Error(`@line-${this.pc + 1}: Unknown System Variable:` + JSON.stringify(v));
    }
};

// Return true if the provided expression is a variable
//   v - Value to check, eg: "&Tool" or "%(1)"
SBPRuntime.prototype._isVariable = function (v) {
    return this._isUserVariable(v) || this._isPersistentVariable(v) || this._isSystemVariable(v);
};

// Return true if the provided expression is a system variable
//   v - Value to check
SBPRuntime.prototype._isSystemVariable = function (v) {
    if (v.type == "system_variable") {
        return true;
    }
    return false;
};

// Return true if the provided expression is a user variable
//   v - Value to check
SBPRuntime.prototype._isUserVariable = function (v) {
    if (v.type == "user_variable") {
        return true;
    }
    return false;
};

// Return true if the provided expression is a persistent variable
//   v - Value to check
SBPRuntime.prototype._isPersistentVariable = function (v) {
    if (v.type == "persistent_variable") {
        return true;
    }
    return false;
};

// Return a string that indicates the type of the provided variable.  Either user,system, or persistent
//   v - Value to check
SBPRuntime.prototype._variableType = function (v) {
    if (this._isUserVariable(v)) {
        return "user";
    }
    if (this._isSystemVariable(v)) {
        return "system";
    }
    if (this._isPersistentVariable(v)) {
        return "persistent";
    }
};

// TODO: improve handling of undefined user vars per rmackie
// Return the value for the provided user variable
//   v - identifier to check, eg: '&Tool'
SBPRuntime.prototype.evaluateUserVariable = function (v) {
    if (v === undefined) {
        return undefined;
    }
    if (v.type != "user_variable") {
        return undefined;
    }
    if (v.name.toUpperCase() === "&TOOL") {
        v.name = "&TOOL";
    }
    return config.opensbp.getTempVariable({ name: v.name, access: v.access || [] });
};

// Return the value for the provided persistent variable
//   v - identifier to check, eg: '$Tool'
SBPRuntime.prototype.evaluatePersistentVariable = function (v) {
    if (v === undefined) {
        return undefined;
    }
    if (v.type != "persistent_variable") {
        return undefined;
    }
    return config.opensbp.getVariable({ name: v.name, access: v.access || [] });
};

// Called for any valid shopbot mnemonic that doesn't have a handler registered
//   command - The command mnemonic that is unidentified
SBPRuntime.prototype._unhandledCommand = function (command) {
    log.warn("Unhandled Command: " + JSON.stringify(command));
};

// Create an execution frame for the current program context and push it onto this.file_stack
// The program context here means things like which coordinate system, speeds, the current PC, etc.
SBPRuntime.prototype._pushFileStack = function () {
    var frame = {};
    frame.coordinateSystem = this.coordinateSystem;
    frame.movespeed_xy = this.movespeed_xy;
    frame.movespeed_z = this.movespeed_z;
    frame.pc = this.pc;
    frame.movexy;
    frame.program = this.program;
    frame.stack = this.stack;
    frame.end_message = this.end_message;
    frame.label_index = this.label_index;
    this.file_stack.push(frame);
};

// Retrieve the execution frame on top of this.file_stack and restore the program context from it
// The program context here means things like which coordinate system, speeds, the current PC, etc.
SBPRuntime.prototype._popFileStack = function () {
    var frame = this.file_stack.pop();
    this.movespeed_xy = frame.movespeed_xy;
    this.movespeed_z = frame.movespeed_z;
    this.pc = frame.pc;
    this.coordinateSystem = frame.coordinateSystem;
    this.emit_gcode(this.coordinateSystem);
    this.program = frame.program;
    this.stack = frame.stack;
    this.label_index = frame.label_index;
    this.end_message = frame.end_message;
};

// Emit a g-code into the stream of running codes
//   s - Can be any g-code but should not contain the N-word
SBPRuntime.prototype.emit_gcode = function (s) {
    // An N-Word is added to this code to indicate the line number in the original OpenSBP file
    // that generated these codes.  We only track line numbers for the top level program.
    if (this.file_stack.length > 0) {
        var n = this.file_stack[0].pc;
    } else {
        // eslint-disable-next-line no-redeclare
        var n = this.pc;
    }
    this.gcodesPending = true;
    var temp_n = n + 20; ////## save low numbers for prepend/postpend; being done in util for gcode?
    var gcode = "N" + temp_n + " " + s;
    gcode = gcode + "\n";
    this.stream.write(gcode);
};

// Helper function used by M_ commands that generates a movement code (G1,G0)
// on the specified position after having applied transformations to that position
// TODO - Gordon, provide some documentation here?
SBPRuntime.prototype.emit_move = function (code, pt) {
    var gcode = code;

    ["X", "Y", "Z", "A", "B", "C", "I", "J", "K", "F"].forEach(
        function (key) {
            var c = pt[key];
            if (c !== undefined) {
                if (isNaN(c)) {
                    var err = new Error("Invalid " + key + " argument: " + c);
                    log.error(err);
                    throw err;
                }
                if (key === "X") {
                    this.cmd_posx = c;
                } else if (key === "Y") {
                    this.cmd_posy = c;
                } else if (key === "Z") {
                    this.cmd_posz = c;
                } else if (key === "A") {
                    this.cmd_posa = c;
                } else if (key === "B") {
                    this.cmd_posb = c;
                } else if (key === "C") {
                    this.cmd_posc = c;
                }
            }
        }.bind(this)
    );

    ////## Should probably depend on transforms being active; evaluate ???
    var tPt = this.transformation(pt);
    //console.log('call point transform, ')
    //console.log(tPt);

    var opFunction = function (Pt) {
        //Find a better name
        // for(key in tPt) {
        ["X", "Y", "Z", "A", "B", "C", "I", "J", "K", "F"].forEach(
            function (key) {
                var v = Pt[key];
                if (v !== undefined) {
                    if (isNaN(v)) {
                        var err = new Error("Invalid " + key + " argument: " + v);
                        log.error(err);
                        throw err;
                    }
                    gcode += key + parseFloat(v).toFixed(5);
                }
            }.bind(this)
        );
        this.emit_gcode(gcode);
    }.bind(this);

    if (this.transforms.level.apply === true) {
        if (this.leveler.triangulationFailed() === true) {
            log.error("Point cloud not triangulated, impossible to do levelling.");
            return;
        }
        var X = tPt.X === undefined ? this.cmd_posx : tPt.X;
        var Y = tPt.Y === undefined ? this.cmd_posy : tPt.Y;
        if (X === undefined) {
            X = 0;
        }
        if (Y === undefined) {
            Y = 0;
        }
        var theoriticalZ = tPt.Z === undefined ? this.cmd_posz : tPt.Z;
        if (theoriticalZ === undefined) {
            theoriticalZ = 0;
        }

        var relativeHeight = this.leveler.findHeight(X, Y);
        if (relativeHeight === false) {
            log.info("[Leveler] Point outside of point cloud boundaries.");
            relativeHeight = 0;
        }
        tPt.Z = theoriticalZ + relativeHeight;
        opFunction(tPt);
    } else {
        opFunction(tPt);
    }
};

// Load transform settings from the OpenSBP configuration
SBPRuntime.prototype._setupTransforms = function () {
    log.debug("_setupTransforms");
    this.transforms = JSON.parse(JSON.stringify(config.opensbp.get("transforms")));
};

// Transform the specified points within a motion command for a line or arc
// - by type of transform
// - to the tform function we are passing the to-be-transformed object and other parameters needed for calc
// - the possible presence of gcode arcs (with relative values and absent start point) makes this messy

let prevPt = {
    // for rotating an arc we need to have the starting point, the previous EndPt
    xIni: 0, // ... these should be initialized to current location
    yIni: 0,
    xRot: 0,
    yRot: 0,
};
SBPRuntime.prototype.transformation = function (TranPt) {
    if (this.transforms.rotate.apply !== false) {
        if ("X" in TranPt || "Y" in TranPt) {
            if (!("X" in TranPt)) {
                TranPt.X = this.cmd_posx;
            }
            if (!("Y" in TranPt)) {
                TranPt.Y = this.cmd_posy;
            }
            log.debug("xy rot transformation TranPt: " + JSON.stringify(TranPt));
            var angle = this.transforms.rotate.angle;
            // var x = TranPt.X;
            // var y = TranPt.Y;
            var PtRotX = this.transforms.rotate.x;
            var PtRotY = this.transforms.rotate.y;
            TranPt = tform.rotate(TranPt, angle, PtRotX, PtRotY, prevPt);
            // save these for next pass in case it is an arc
            prevPt.xIni = this.cmd_posx;
            prevPt.yIni = this.cmd_posy;
            prevPt.xRot = TranPt.X;
            prevPt.yRot = TranPt.Y;
        }
    }
    if (this.transforms.shearx.apply != false) {
        if ("X" in TranPt && "Y" in TranPt) {
            log.debug("ShearX: " + JSON.stringify(this.transforms.shearx));
            angle = this.transforms.shearx.angle;
            TranPt = tform.shearX(TranPt, angle);
        }
    }
    if (this.transforms.sheary.apply != false) {
        if ("X" in TranPt && "Y" in TranPt) {
            log.debug("ShearY: " + JSON.stringify(this.transforms.sheary));
            angle = this.transforms.sheary.angle;
            TranPt = tform.shearY(TranPt, angle);
        }
    }
    if (this.transforms.scale.apply != false) {
        log.debug("Scale: " + JSON.stringify(this.transforms.scale));
        var ScaleX = this.transforms.scale.scalex;
        var ScaleY = this.transforms.scale.scaley;
        var ScaleZ = this.transforms.scale.scalez;
        var PtX = this.transforms.scale.x;
        var PtY = this.transforms.scale.y;
        var PtZ = this.transforms.scale.z;
        var PtI = this.transforms.scale.x;
        var PtJ = this.transforms.scale.y;

        TranPt = tform.scale(TranPt, ScaleX, ScaleY, ScaleZ, PtX, PtY, PtZ, PtI, PtJ);
    }
    if (this.transforms.move.apply != false) {
        log.debug("Move: " + JSON.stringify(this.transforms.move));
        TranPt = tform.translate(TranPt, this.transforms.move.x, this.transforms.move.y, this.transforms.move.z);
    }

    return TranPt;
};

// Pause the currently running program
SBPRuntime.prototype.pause = function () {
    // TODO: Pending feedholds appear to be broken and may no longer be desired functionality.
    // TODO: Should this be handled by g2.js behavior?
    if (
        this.machine.driver.status.stat == this.machine.driver.STAT_END ||
        this.machine.driver.status.stat == this.machine.driver.STAT_STOP
    ) {
        this.pendingFeedhold = true;
    } else {
        //Send feedhold to driver
        this.machine.driver.feedHold();
        //Alert machine that we are in feedhold
        this.machine.status.inFeedHold = true;
        //Internal opensbp flag indicating we are in feedhold
        this.feedhold = true;
    }
};

// Quit the currently running program
// If the machine is currently moving it will be stopped immediately and the program abandoned
SBPRuntime.prototype.quit = function () {
    // Start the process of ending the runtime and send Quit message to g2.js driver.
    this._end(); // this seems important for clean exit after quits
    this.driver.quit();
};

// Resume a program from the paused state
//   TODO - make some indication that this action was successful (resume is not always allowed, and sometimes it fails)
SBPRuntime.prototype.resume = function (input = false) {
    if (this.resumeAllowed) {
        if (this.paused) {
            if (input) {
                this._assign(input.var, input.val)
                    .then(() => {
                        this.paused = false;
                        this._executeNext();
                        this.driver.resume();
                    })
                    .catch((err) => {
                        log.error("Error during resume assignment: " + err);
                        return this._abort(err);
                    });
            } else {
                this.paused = false;
                this._executeNext();
                this.driver.resume();
            }
        } else {
            this.driver.resume();
            this.machine.status.inFeedHold = false;
            this.feedhold = false;
        }
    }
};

// Enter the manual state
// This function is called by the SK command in order to bring up the keypad
//    message - The message for the top of the keypad display
//   callback - Called once the manual state is exited
SBPRuntime.prototype.manualEnter = function (message, callback) {
    this.inManualMode = true;
    this._update();

    if (this.machine) {
        this.machine.setState(this, "manual", message ? { message: message } : undefined);
        this.machine.authorize();
    }

    this.helper = new ManualDriver(this.driver, this.stream);
    this.helper.enter().then(
        function () {
            this.inManualMode = false;
            this.machine.setState(this, "running");
            this._update();
            if (this.absoluteMode) {
                this.emit_gcode("G90");
            }
            this.emit_gcode("G4 P0.1");
            callback();
        }.bind(this)
    );
};

exports.SBPRuntime = SBPRuntime;
