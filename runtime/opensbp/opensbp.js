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

var parser = require('./parser');
var fs = require('fs');
var log = require('../../log').logger('sbp');
var g2 = require('../../g2');
var sb3_commands = require('./sb3_commands');
var events = require('events');
var tform = require('./transformation');
var macros = require('../../macros');
var interp = require('./interpolate');
var Leveler = require('./commands/leveler').Leveler;
var u = require('../../util');
var config = require('../../config');
var stream = require('stream');
var ManualDriver = require('../manual').ManualDriver;

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
    // this.user_vars = {};
    this.label_index = {};
    this.stack = [];
    this.file_stack = [];

    this.output = [];
    this.running = false;
    this.quit_pending = false;
    this.cmd_result = 0;
    this.cmd_posx = undefined;
    this.cmd_posy = undefined;
    this.cmd_posz = undefined;
    this.cmd_posa = undefined;
    this.cmd_posb = undefined;
    this.cmd_posc = undefined;

    this.jogspeed_xy = 0;
    this.jogspeed_z = 0;
    this.jogspeed_a = 0;
    this.jogspeed_b = 0;
    this.jogspeed_c = 0;
    this.maxjerk_xy = 100;
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
    this.resumeAllowed = true;
    this.lastNoZPullup = 0;
    this.continue_callback = null;
    this.vs_change = 0;
    this.units = null;
    this.absoluteMode = true;

    // Physical machine state
    this.machine = null;
    this.driver = null;

    this.inManualMode = false;
    this.inFeedHold = false;

}
util.inherits(SBPRuntime, events.EventEmitter);

SBPRuntime.prototype.toString = function() {
    return "[SBPRuntime]";
}

// This must be called at least once before instantiating an SBPRuntime object
// TODO Make this a "class method" rather than an instance method
SBPRuntime.prototype.loadCommands = function(callback) {
    commands=require('./commands').load();
    proto = Object.getPrototypeOf(this);
    for(var attr in commands) {
        proto[attr] = commands[attr];
    }
    callback(null, this)
}

// Connect this runtime to the machine model
//    machine - The machine model to connect
SBPRuntime.prototype.connect = function(machine) {
    this.machine = machine;
    this.driver = machine.driver;
    this.machine.status.line=null;
    this.machine.status.nb_lines=null;
    this._update();
    this.cmd_posx = this.posx;
    this.cmd_posy = this.posy;
    this.cmd_posz = this.posz;
    this.cmd_posa = this.posa;
    this.cmd_posb = this.posb;
    this.cmd_posc = this.posc;
    //this.status_handler = this._onG2Status.bind(this);
    //this.driver.on('status', this.status_handler);
    this.connected = true;
    this.ok_to_disconnect = false;
    log.info('Connected OpenSBP runtime.');
};

// Disconnect this runtime from the machine model.
// Throws an exception if the runtime can't be disconnected.
// (Runtime can't be disconnected when it is busy running a file)
SBPRuntime.prototype.disconnect = function() {
    if(!this.machine) {
        return;
    }

    if(this.ok_to_disconnect) {
        this.machine = null;
        this.driver = null;
        this.connected = false;
        log.info('Disconnected OpenSBP runtime.');
    } else {
        throw new Error("Cannot disconnect OpenSBP runtime.")
    }
};

// Execute the provided code
// If the code is a string, interpret it as OpenSBP code
// If it is an object, interpret it as a manual drive command
//          s - The command to execute (string or object)
//   callback - Called once the command is issued (or with error if error) - NOT when the command is done executing   
SBPRuntime.prototype.executeCode = function(s, callback) {
    if(typeof s === "string" || s instanceof String) {
        // Plain old string interprets as OpenSBP code segment
        this.runString(s, callback);        
    } else {
        ////## Is this up-to-date and does it work with new variations on manual 2020 on ?
        // If we're in manual mode, interpret an object as a command for that mode
        // The OpenSBP runtime can enter manual mode with the 'SK' command so we have this code here to mimick that mode
        if(this.inManualMode) {
            // The code here is essentially taken from the manual runtime, and uses the same underlying helper class,
            // ManualDriver (/runtime/manual/driver.js) to actually manage the machine state
            switch(s.cmd) {
                case 'enter':
                    this.enter();
                    break;
                default:
                    // 
                    if(!this.helper) {
                        log.warn("Can't accept command '" + s.cmd + "' - not entered.");
                        this.machine.setState(this, 'idle');
                        return;
                    }
                    switch(s.cmd) {
                        case 'exit':
                            log.debug('---- MANUAL DRIVE EXIT ----')
                            this.helper.exit();
                            break;
        
                        case 'start':
                            this.helper.startMotion(s.axis, s.speed, s.second_axis, s.second_speed);
                            break;
        
                        case 'stop':
                            this.helper.stopMotion();
                            break;
        
                        case 'quit':
                            this.helper.quitMove();
                            break;
        
                        case 'maint':
                            this.helper.maintainMotion();
                            break;
                            
                        case 'goto':
                            this.helper.goto(s.move)
                            break;
        
                        case 'set':
                            this.helper.set(s.move)
                            break;
        
                        case 'fixed':
                            if(!this.helper) {
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
}

// Check whether the code needs auth
// There are lots of SBP commands that do not require authorization to run, 
// but we've kept it simple here and only green-lit Zeroing (Z) commands
SBPRuntime.prototype.needsAuth = function(s) {
    var lines =  s.split('\n');
    lines = lines.filter(Boolean);
    for (var i = 0, x = lines.length; i < x; i++) {
        if ( lines[i].toUpperCase().charAt( 0 ) !=='Z') {
            return true;
        }
    };
    return false;
}

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
SBPRuntime.prototype.runString = function(s) {
    try {
        // Break the string into lines
        var lines =  s.split('\n');
        
        // The machine status `nb_lines` indicates the total number of lines in the currently running file
        // If this is a "top level" file (that is, the file being directly run and not a macro being called) set that value
        // TODO I've never liked nb_lines as a name
        if(this.machine) {
            if(this.file_stack.length === 0) {
                this.machine.status.nb_lines = lines.length - 1;
            }
        }

        // Parse the program.  Bail with a useful error message if parsing fails.
        // "Useful" is relative.  The PegJS errors are pretty arcane... TODO - we could probably do better.
        // We catch parse errors separately from other errors because the parser reports line numbers differently than 
        // they will be accessed once the program has been parsed (and we want to report the line number always when we have an error)
        try {
            this.program = parser.parse(s);
        } catch(e) {
            return this._end(e.message + " (Line " + e.line + ")");
        } finally {
            log.tock('Parse file')
        }

        ////##
        // TODO Bad bad bad - re-using lines above (the list of lines in the file) as the number of lines here.
        //      It looks like we can just remove this.  It doesn't seem to be used.
        lines = this.program.length;
        // Configure affine transformations on the file
        this._setupTransforms();
        log.debug("Transforms configured...")

        // Initialize the runtime state
        this.init();

        // Copy the general config and driver settings into runtime memory
        this._loadConfig();
        this._loadDriverSettings();

        // Build a map of labels to line numbers
        // This step unfortunately requires the whole file
        this._analyzeLabels();  
        log.debug("Labels analyzed...")

        // Check all the GOTO/GOSUBs against the label table
        this._analyzeGOTOs();   
        log.debug("GOTOs analyzed...")
        
        // Start running the actual code, now that everything is prepped
        log.debug("## Call _run from string ...")
        return this._run();

    } catch(e) {
        // A failure at any stage (except parsing) will land us here 
        log.error(e);
        return this._end(e.message);
    }
};

// Run the provided stream of text in OpenSBP
// See documentation above for runString - this works the same way.
//   callback - Called when run is complete or with error if there was an error.
SBPRuntime.prototype.runStream = function(text_stream) {
    try {
        try {
            // Initialize the program
            this.program = []

            // Even though we're "streaming" in this function, we still have to parse
            // the entire body of data before we can continue processing the file.
            // That's why the business end of this function occurs in the 'end' handler
            var st = parser.parseStream(text_stream)

            // The stream produced by parser.parseStream produces fully parsed program lines,
            // which can just be added to the program as they come in.
            st.on('data', function(data) {
                this.program.push(data);
            }.bind(this));

            // Stream is fully processed
            st.on('end', function() {

                log.tock('Parse file')

                // The machine status `nb_lines` indicates the total number of lines in the currently running file
                // If this is a "top level" file (that is, the file being directly run and not a macro being called) set that value
                // TODO I've never liked nb_lines as a name
                var lines = this.program.length;
                if(this.machine) {
                    if(this.file_stack.length === 0) {
                        this.machine.status.nb_lines = lines - 1;
                    }
                }
                
                // Configure affine transformations on the file
                this._setupTransforms();
                log.debug("Transforms configured...")
                
                // Initialize the runtime state
                this.init();

                // Copy the general config and driver settings into runtime memory
                this._loadConfig();
                this._loadDriverSettings();
                

                log.tick();
                // Build a map of labels to line numbers
                // This step unfortunately requires the whole file
                this._analyzeLabels(); 
                log.tock('Labels analyzed...')

                // Check all the GOTO/GOSUBs against the label table
                this._analyzeGOTOs();   
                log.debug("GOTOs analyzed...")
                log.tock('Analyzed GOTOs')

                // Start running the actual code, now that everything is prepped
                log.debug("## Call _run from Stream ...")
                return this._run();

            }.bind(this));
            return undefined;

        } catch(e) {
            log.error(e)
            return this._end(e.message + " (Line " + e.line + ")");
        }
        return st;
    } catch(e) {
        log.error(e);
        return this._end(e.message + " (Line " + e.line + ")");
    }
}

// Internal function to copy config settings to local fields of this runtime
// We consult/update local fields rather than manipulating the configuration directly
// This prevents changes made to critical settings in files from being permanent (unless we want them to be)
SBPRuntime.prototype._loadConfig = function() {
    var settings = config.opensbp.getMany([
        'units',
        'movexy_speed',
        'movez_speed',
        'movea_speed',
        'moveb_speed',
        'movec_speed'
    ]);
    this.units = settings.units
    this.movespeed_xy = settings.movexy_speed;
    this.movespeed_z = settings.movez_speed;
    this.movespeed_a = settings.movea_speed;
    this.movespeed_b = settings.moveb_speed;
    this.movespeed_c = settings.movec_speed;
}

// Internal function to copy driver settings to local fields of this runtime
// We consult/update local fields rather than manipulating the configuration directly
// This prevents changes made to critical settings in files from being permanent (unless we want them to be)
SBPRuntime.prototype._loadDriverSettings = function() {
    var settings = config.driver.getMany([
        'xvm','yvm','zvm','avm','bvm','cvm',
        'xjm','yjm','zjm','ajm','bjm','cjm' ]);
    this.jogspeed_xy = settings.xvm/60;
    this.jogspeed_z = settings.zvm/60;
    this.jogspeed_a = settings.avm/60;
    this.jogspeed_b = settings.bvm/60;
    this.jogspeed_c = settings.cvm/60;
    this.maxjerk_xy = settings.xjm;
    this.maxjerk_z = settings.zjm;
    this.maxjerk_a = settings.ajm;
    this.maxjerk_b = settings.bjm;
    this.maxjerk_c = settings.cjm;
}

// Save runtime configuration settings to the opensbp settings file
//   callback - Called when config has been written
SBPRuntime.prototype._saveConfig = function(callback) {
    var sbp_values = {};
    sbp_values.movexy_speed = this.movespeed_xy;
    sbp_values.movez_speed = this.movespeed_z;
    sbp_values.movea_speed = this.movespeed_a;
    sbp_values.moveb_speed = this.movespeed_b;
    sbp_values.movec_speed = this.movespeed_c;
    sbp_values.jogxy_speed = this.jogspeed_xy;
    sbp_values.jogz_speed = this.jogspeed_z;
    sbp_values.joga_speed = this.jogspeed_a;
    sbp_values.jogb_speed = this.jogspeed_b;
    sbp_values.jogc_speed = this.jogspeed_c;
    sbp_values.units = this.units;
    config.opensbp.setMany(sbp_values, function(err, result) {
        callback();
    });
}

// Save runtime driver settings to the opensbp settings file
//   callback - Called when config has been written
SBPRuntime.prototype._saveDriverSettings = function(callback) {
    var g2_values = {};

    // Permanently set jog speeds
    g2_values.xvm = (60 * this.jogspeed_xy);
    g2_values.yvm = (60 * this.jogspeed_xy);
    g2_values.zvm = (60 * this.jogspeed_z);
    g2_values.avm = (60 * this.jogspeed_a);
    g2_values.bvm = (60 * this.jogspeed_b);
    g2_values.cvm = (60 * this.jogspeed_c);

    // Permanently set ramp max (jerk)
    g2_values.xjm = this.maxjerk_xy;
    g2_values.yjm = this.maxjerk_xy;
    g2_values.zjm = this.maxjerk_z;
    g2_values.ajm = this.maxjerk_a;
    g2_values.bjm = this.maxjerk_b;
    g2_values.cjm = this.maxjerk_c;
    config.driver.setMany(g2_values, function(err, values) {
                callback();
    }.bind(this));
}

// Run a file on disk.
//   filename - Full path to file on disk
//   callback - Called when file is done running or with error if error
SBPRuntime.prototype.runFile = function(filename) {
    var st = fs.createReadStream(filename)
    this.runStream(st);
}

// Simulate the provided file, returning the result as g-code string
// TODO - this function could return a stream, and you could stream this back to the client to speed up simulation
//          s - OpenSBP string to run
//   callback - Called with the g-code output or with error if error 
SBPRuntime.prototype.simulateString = function(s, callback) {
    if(this.ok_to_disconnect) {
        var saved_machine = this.machine;
        this.disconnect();
        var st = this.runString(s);
        var chunks = []
        st.on('data', function(chunk) {
            chunks.push(chunk);
        });
        st.on('end', function() {
            callback(null, chunks.join(''));
        });
    } else {
        callback(new Error("Cannot simulate while OpenSBP runtime is busy."));
    }
}

// Doofy limit call
// TODO - work on this
SBPRuntime.prototype._limit = function() {
    var er = this.driver.getLastException();
    if(er && er.st == 203) {
        var msg = er.msg.replace(/\[[^\[\]]*\]/,'');
        this.driver.clearLastException();
        this._abort(msg);
        return true;
    }
    return false;
}

// Handler for G2 status reports
//   status - The status report as sent by G2 to the host
SBPRuntime.prototype._onG2Status = function(status) {

    // This was happening at some point, so this was mostly for debug - keep an eye out.
    if(!this.connected) {
        log.warn("OpenSBP runtime got a status report while disconnected.");
        return;
    }

    // If we die then we are dead.
    // The first rule of tautology club is the first rule of tautology club.
    switch(status.stat) {
        case this.driver.STAT_INTERLOCK:
        case this.driver.STAT_SHUTDOWN:
        case this.driver.STAT_PANIC:
            return this.machine.die('A G2 exception has occurred. You must reboot your tool.');
            break;
    }

    // Update the machine of the driver status
    for (var key in this.machine.status) {
        if(key in status) {
            this.machine.status[key] = status[key];
        }
    }

    // TODO - this seems not to be used.
    //        It was probably an attempt to smooth over the fact that probing operations are *always* in metric, regardless of machine units
    //        That would actually be easy to clean up, and is probably worth pursuing - customers have been confused by the behavior.
    //        (The better solution is to fix it in the firmware, though)
    if(this.driver.status.stat == this.driver.STAT_PROBE) {
        var keys = ['posx','posy','posz','posa','posb','posc'];
    }

    this.machine.emit('status',this.machine.status);
};

// Update the internal state of the runtime with data from the tool
SBPRuntime.prototype._update = function() {
    if(this.machine) {
        status = this.machine.status || {};
    } else {
        status = {};
    }
    this.posx = status.posx || 0.0;
    this.posy = status.posy || 0.0;
    this.posz = status.posz || 0.0;
    this.posa = status.posa || 0.0;
    this.posb = status.posb || 0.0;
    this.posc = status.posc || 0.0;
};

// Evaluate a list of arguments provided (for commands)
// Returns a scrubbed list of evaluated arguments to be passed to command handlers
//   command - The two-character mnemonic for the command, as a string (eg MX,J3,etc)
//      args - A list of the arguments that were provided with the command by the user (as strings)
SBPRuntime.prototype._evaluateArguments = function(command, args) {
    // Scrub the argument list:  extend to the correct length, mark undefined values as undefined
    // Previously, the "prm" file (sb3_commands.json) was used to substitute default values for commands, but now, that is mostly done by
    // the command handlers themselves.  Still, this is a good place to throw an exception if an argument doesn't pass a sanity check.
    scrubbed_args = [];
    if(command in sb3_commands) {
        params = sb3_commands[command].params || [];

////## Improved spurious errors; decide if and further action should be taken on this?
        // This is a possibly helpful warning, but is spuriously issued in some cases where commands take no arguments (depending on whitespace, etc.)
        // TODO - fix that
        if(args.length > params.length) {
            if (params.length === 0 && args.length === 1 && args[0] === "") {
                log.debug (' -- a no-parameter command');
            } else {
                log.warn('More parameters passed into ' + command + ' (' + args.length + ')' + '(' + params + ')' + ' than are supported by the command. (' + params.length + ')');
            }
        }

        for(i=0; i<params.length; i++) {
            prm_param = params[i]; // prm_param is the parameter description object from the "prm" file (sb3_commands.json) (unused, currently)
            user_param = args[i];  // user_param is the actual parameter from args

            if((args[i] !== undefined) && (args[i] !== "")) {
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
    retval = [];
    for(i=0; i<scrubbed_args.length; i++) {
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
SBPRuntime.prototype._breaksStack = function(cmd) {
    var result;

    // Any command that has an expression in one of its arguments that breaks the stack, breaks the stack.
    if(cmd.args) {
        for(var i=0; i<cmd.args.length; i++) {
            if(this._exprBreaksStack(cmd.args[i])) {
                log.warn("STACK BREAK for an expression: " + JSON.stringify(cmd.args[i]))
                return true;
            }
        }
    }

    switch(cmd.type) {
        case "cmd":
            // Commands have a means of automatically specifying whether or not they break the stack.  If their command handler
            // accepts a second argument (presumed to be a callback) in addition to their argument list, they are stack breaking.
            var name = cmd.cmd;
            if((name in this) && (typeof this[name] == 'function')) {
                f = this[name];
                if(f && f.length > 1) {
                    return true;
                }
            }
            result = false;
            break;

        case "pause":
            // TODO - pauses that just create a delay really shouldn't be stack breakers.  Pauses that bring up the message box should.
            //        (you don't want to bring up the message box until the machine has executed everything up to that point)
            return true;
            break;

        case "cond":
            //TODO , we should check the expression for a stack break, as well as the .stmt
            return true;
            break;
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
SBPRuntime.prototype._exprBreaksStack = function(expr) {
    if(!expr) { return false; }
    if(expr.op === undefined) {
        return expr[0] == '%'; // For now, all system variable evaluations are stack-breaking
    } else {
        return this._exprBreaksStack(expr.left) || this._exprBreaksStack(expr.right);
    }
};

// Start the stored program running; manage changes
// Return the stream of g-codes that are being run, which will be fed by the asynchronous running process.
// This function is called ONCE at the beginning of a program, and is not called again until the program
// completes, except if a macro (subprogram) is encountered, in which case it is called for that program as well. 
SBPRuntime.prototype._run = function() {
////## moved up
    // Set state variables to kick things off
    this.started = true;
    this.waitingForStackBreak = false;
    this.gcodesPending = false;

    log.info("Starting OpenSBP program {SBPRuntime.proto._run}");
    if(this.machine) {
        log.debug("-___ call #1 setState of Machine to RUNNING -file?- {_run}");
        this.machine.setState(this, "running");
    }
    // // Set state variables to kick things off
    // this.started = true;
    // this.waitingForStackBreak = false;
    // this.gcodesPending = false;

    // Create a stat handler that does a few things:
    // 1. Call _executeNext when the motion system is out of moves to feed it more program
    // 2. Set the machine state to paused or running based on the state of the motion system
    // 3. Handle a feedhold edge case (feedhold issued while system was not executing motion)
    var onStat = function(stat) {
        log.debug("onSTAT ..." + stat)
        if(this.inManualMode) {
            return;
        }
        switch(stat) {
            case this.driver.STAT_STOP:
                this.gcodesPending = false;
                log.debug("  -call _executeNext {_run; got STOP}")
                this._executeNext();
            break;
            case this.driver.STAT_HOLDING:
                log.debug("   -call #3setState Machine PAUSE {_run}")
                this.machine.setState(this, 'paused');
            break;
            case this.driver.STAT_PROBE:
            case this.driver.STAT_RUNNING:
                if(!this.inManualMode) {
                    ////## skip if already set
                    if(this.machine.status.state != 'running') {
                        log.debug("   -call #2setState Machine RUNNING {_run}")
                        this.machine.setState(this, 'running');
                        if(this.pendingFeedhold) {
                            this.pendingFeedhold = false;
                            this.driver.feedHold();
                        }               
                    } else {
                        log.debug("  -NoChange > " + this.machine.status.state); 
                    }
                } 
            break;
            case this.driver.STAT_END:
                log.debug("  -got END> ");                
            break;
            default:
                log.debug("  -Unrecognized STAT> ");                
        }
    }

    if(this.isInSubProgram()) {
        // If this function was called and we're in a subprogram, just execute the next instruction 
        log.debug("Running Subprogram")
        this._executeNext();
    } else {
        // If this is a top level run, create a pass-through stream to receive the data
        // and start executing with it.  As the program is processed the stream will be fed
        log.debug("-___ building/pumping Stream {_run}")
        this.stream = new stream.PassThrough();
        if(this.driver) {
            this.driver.runStream(this.stream)
            .on('stat', onStat.bind(this))
            .on('status', this._onG2Status.bind(this))
            .then(function() {
                this.file_stack = []
                this._end(this.pending_error);
            }.bind(this));
        }

        // Actually begin program execution
        log.debug("_executeNext called #FirstTime {_run}")
        this._executeNext();
    }

    // This function returns the pass-through stream (but it's also saved as this.stream)
    return this.stream;
};

// Return true if this is not the "top level" program (ie: we're in a macro call.)
SBPRuntime.prototype.isInSubProgram = function() {
    return this.file_stack.length > 0;
}

// Continue running the current program (until the end of the next chunk; ////## what is chunk? Stack??)
// _executeNext() will dispatch the next chunk if appropriate, once the current chunk is finished
SBPRuntime.prototype._executeNext = function() {
    log.debug('_executeNext called ...');
    // Copy values from the machine to our local state variables
    this._update();

    // _executeNext is only for resuming an already running program.  It's not a substitute for _run()
    if(!this.started) {
        log.warn('Got a _executeNext() but not started');
        return;
    }

    // TODO: pending_error is actually set by _abort, so this is possibly called twice
    if(this.pending_error) {
        return this._abort(this.pending_error);
    }

    // If _executeNext is called but we're paused, stay paused. (We'll call _executeNext again on resume)
    if(this.paused) {
        log.info('Program is paused.');
        return;
    }

    if(this.pc >= this.program.length) {
        log.info("End of program reached. (pc = " + this.pc + ")");
        // Here we've reached the end of the program, but there's possibly not enough
        // g-codes queued up for the driver to want to send them out, so go ahead and prime it
        // to send out those last few.
        this.prime();

        // this.gcodesPending gets set when we emit_gcode, and cleared when the tool reaches the STAT_STOP
        // state (because it's run everything that it's recieved) - If pending is true, that means there's
        // more work to do before finishing out the program.  We prime()d above, so those instructions will
        // get executed (and the stat handler will call _executeNext again once the machine stops moving)
        if(this.gcodesPending && this.driver) {
            log.debug('GCodes are still pending...')
            return;
        }

        // Handle the end of program differently if we're a subprogram
        if(this.isInSubProgram()) {
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
            this.emit_gcode('M30');

            // If no driver, we just go straight to the _end() (as in simulation)
            if(!this.driver) {
                this._end();
            } else {
                // prime so that M30 actually gets sent
                this.prime();
            }
            return;
        }
    }

    // Below here we're NOT at the end of the program, 
    // so it's time to actually execute the next instruction
    
    // Pull the current line of the program from the list
    var line = this.program[this.pc];
    var breaksTheStack = this._breaksStack(line);

    if(breaksTheStack) {
        log.debug("Stack break: " + JSON.stringify(line));
        this.prime();

        // Broadly, if the next instruction is a stack breaking command, we're only
        // allowed to execute it if everything up till now has finished executing
        // (there are no instructions pending in the motion system)
        // We request a status report, just to catch the case where there are non-motion
        // g-codes executing, and we might not have got a report that indicates that the machine
        // has stopped executing stuff.  Of course we only do that if there's a driver (we're not simulating) 
        if(this.gcodesPending && this.driver) {
            log.debug("Deferring because g-codes pending.");
////##            this.driver.requestStatusReport();         ////## creating start problem ???
            return; // We can return knowing that we'll be called again when the system enters STAT_STOP
        } else {
            // G2 is stopped, execute stack breaking command now
            try {
                log.debug("executing: " + JSON.stringify(line))
                this._execute(line, this._executeNext.bind(this));
                return;
            } catch(e) {
                return this._abort(e);
            }
        }
        return;
    } else {
        // If this is a non-stack-breaking command, go ahead and execute it.
        // Mostly, these commands will call emit_gcode, which will push instructions into the stream
        // that drives the motion controller.
        //log.debug("Non-Stack break: " + JSON.stringify(line));
        try {
            //log.debug("executing: " + JSON.stringify(line))
            this._execute(line);
            // Keep on executing!  No reason not to.
            setImmediate(this._executeNext.bind(this));
        } catch(e) {
            // A stack breaker that caused an error will trigger an abort of the program
            log.error(e)
            if(this.driver.status.stat != this.driver.STAT_STOP) {
                // There's been an error, but there's still stuff executing
                // pend a program ending, which will execute when the motion controller stops
                return this._abort(e);
            } else {
                // We're stopped and there's been an error, just end the program.
                return this._end(e);
            }
        }
    }
};

// Prime the driver associated with this runtime, if it exists.
SBPRuntime.prototype.prime = function() {
    if(this.driver) {
        this.driver.prime();
    }
}

// Set a pending error and end the stream feeding the motion system
// The pending error is picked up by _executeNext and the program is ended as a result.
//   error - The error message
SBPRuntime.prototype._abort = function(error) {
    this.pending_error = error;
    this.stream.end();
}

////## EXPLORE the changes to this function, Ted may have messed up
// End the program
// This restores the state of both the runtime and the driver, and sets the machine state appropriately
//   error - (optional) If the program is ending due to an error, this is it.  Can be string or error object.
SBPRuntime.prototype._end = function(error) {
    // debug info ////##
    log.debug("opensbp runtime _end() called");

    // Normalize the error and ending state
    error = error ? error.message || error : null;
    if(!error) {
        error = this.end_message || null;
    }

    log.debug("Calling the non-nested (toplevel) end");
    // Log the error for posterity
    if(error) {log.error(error)}

    // Cleanup deals the "final blow" - cleans up streams, sets the machine state and calls the end callback
    var cleanup = function(error) {
        log.debug("_end Cleanup called");
        if(this.machine && error) {
            this.machine.setState(this, 'stopped', {'error' : error });
        }
        ////## Don't know about this IF, not in Josh's
        if(!this.machine){
             this.stream.end();
        }
	    // Clear the internal state of the runtime (restore it to its initial state)
    	//TODO: Refactor to new reset function that both init and _end can call? Break out what needs to be initialized vs. reset.
        this.ok_to_disconnect = true; ////## removed in disconnect
        this.init(); ////## added here in refactor
        this.emit('end', this); ////## reorder from Josh's, why?
    }.bind(this);
    //TODO: Is all this needed here? Do we need to reset state? Can this be done without nested callbacks?

    if(this.machine) {
        this.resumeAllowed=false
        this.machine.restoreDriverState(function(err, result) {
            this.resumeAllowed = true;
            if(this.machine.status.job) {
                this.machine.status.job.finish(function(err, job) {
                    this.machine.status.job=null;
                    this.machine.setState(this, 'idle');
                    cleanup(error);
                }.bind(this));
            } else {
// <<<<<<< HEAD
//                 this.driver.setUnits(config.machine.get('units'), function() {
//                     this.machine.setState(this, 'idle');
//                     cleanup(error);
//                 }.bind(this));
//             }
//         }.bind(this));
//     } else {
//         cleanup(error);
// =======
				log.debug("CALL from OSBP to reset unit in _end ")
                this.driver.setUnits(config.machine.get('units'), function() {
                    this.machine.setState(this, 'idle');
                    cleanup(error);                    
                }.bind(this));
            }
            cleanup(error);
        }.bind(this));
    } else {
            cleanup(error);
    }
};

////## Josh's refactor TODO:Remove
    // // TODO - this big complicated if-else can probably be collapsed to something simpler with some
    // //      rearranging and changing of the cleanup() function above (or maybe it can be eliminated??)
    // if(error) {
    //     if(this.machine) {
    //         this.resumeAllowed = false;
    //         this.machine.restoreDriverState(function(err, result) {
    //             this.resumeAllowed = true;
    //             cleanup(error);
    //         }.bind(this));
    //     } else {
    //         cleanup(error);
    //     }
    //     // TODO - Shouldn't this deal with the currently running job (if it exists)
    //     //        as is done below?? this.machine.status.job.fail maybe?
    // } else {
    //     if(this.machine) {
    //         this.resumeAllowed=false
    //         this.machine.restoreDriverState(function(err, result) {
    //             this.resumeAllowed = true;
    //             if(this.machine.status.job) {
    //                 this.machine.status.job.finish(function(err, job) {
    //                     this.machine.status.job=null;
    //                     this.machine.setState(this, 'idle');
    //                 }.bind(this));
    //             } else {
    //                 this.driver.setUnits(config.machine.get('units'), function() {
    //                     this.machine.setState(this, 'idle');
    //                 }.bind(this));
    //             }
    //             cleanup();
    //         }.bind(this));
    //     } else {
    //         cleanup();
    //     }
    // }
//};

// Execute the specified command
//    command - The command object to execute
//   callback - Called when execution is complete or with error if error
SBPRuntime.prototype._executeCommand = function(command, callback) {

    if((command.cmd in this) && (typeof this[command.cmd] == 'function')) {
        // Command is valid and has a registered handler

        // Evaluate the command arguments and extract the handler
        args = this._evaluateArguments(command.cmd, command.args);
        f = this[command.cmd].bind(this);

        //log.debug("Calling handler for " + command.cmd + " With arguments: [" + args + "]");

        if(f.length > 1) {
            // Stack breakers have the callback passed in, to be called when done.
            try {
                f(args, function commandComplete() {
                    // advance the pc and do the callback to mvoe on to next instruction
                    // TODO - We should allow commands to use an errback?  This would allow 
                    //        for asynchronous errors in addition to the throw
                    this.pc+=1; 
                    callback();
                }.bind(this));
            } catch(e) {
                // TODO - Should we throw the error here?!  This feels like an issue.
                log.error("There was a problem executing a stack-breaking command: ");
                log.error(e);
                this.pc+=1;
                callback();
            }
            return true;
        } else {
            // This is NOT a stack breaker, run immediately, increment PC, call the callback.
            console.log("Non stack breaker: ", command);
            try {
                f(args);
            } catch(e) {
                log.error("Error in a non-stack-breaking command");
                log.error(e);
                throw e;
            }
            this.pc +=1;
            // We use the callback, stack breaker or not
            if(callback != undefined) {
                setImmediate(callback) 
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
SBPRuntime.prototype.runCustomCut = function(number, callback) {
    if(this.machine) {
        var macro = macros.get(number);
        if(macro) {
            log.debug("Running macro: " + JSON.stringify(macro))
            this._pushFileStack();
            this.runFile(macro.filename);
        } else {
            throw new Error("Can't run custom cut (macro) C" + number + ": Macro not found.")
        }
    } else {
        this.pc +=1;
        callback();
    }
    return true;
}

// Execute the provided command
// Returns true if execution breaks the stack (and calls the callback upon command completion)
// Returns false if execution does not break the stack (and callback is never called)
//   command - A single parsed line of OpenSBP code

SBPRuntime.prototype._execute = function(command, callback) {

    // Just skip over blank lines, undefined, etc.
    if(!command) {
        this.pc += 1;
        return;
    }

    // All correctly parsed commands have a type
    switch(command.type) {

        // A ShopBot Comand (M2, ZZ, etc...)
        case "cmd":
            var broke = this._executeCommand(command, callback);
            if(!broke) {
                if (callback != undefined) {
                    setImmediate(callback);
                }
            }
            return broke;
            break;

        // A C# command (custom cut)
        case "custom":
            this.runCustomCut(command.index, callback);
            return true;
            break;

        // A line of raw g-code
        case "gcode":
            log.debug('Running raw gcode in opensbp context.');
            log.debug(command.gcode);   
            this.emit_gcode(command.gcode);
            this.pc += 1;
            return false;
            break;

        case "return":
            if(this.stack.length) {
                this.pc = this.stack.pop();
                setImmediate(callback);
                return true;
            } else {
                throw new Error("Runtime Error: Return with no GOSUB at " + (this.pc+1));
            }
            break;

        case "end":
            this.pc = this.program.length;
            setImmediate(callback);
            return true;
            break;

        case "fail":
            this.pc = this.program.length;
            if(command.message) {
                this.end_message = command.message;
                throw new Error(command.message)
            }
            setImmediate(callback);
            return true;
            break;

        case "goto":
            if(command.label in this.label_index) {
                var pc = this.label_index[command.label];
                log.debug("Hit a GOTO: Going to line " + pc + "(Label: " + command.label + ")");
                this.pc = pc;
                setImmediate(callback);
                return true;
            } else {
                throw new Error("Runtime Error: Unknown Label '" + command.label + "' at line " + (this.pc+1));
            }
            break;

        case "gosub":
            if(command.label in this.label_index) {
                this.stack.push(this.pc + 1);
                log.debug("Pushing the current PC onto the stack (" +(this.pc+1) + ")")
                this.pc = this.label_index[command.label];
                setImmediate(callback);
                return true;
            } else {
                throw new Error("Runtime Error: Unknown Label '" + command.label + "' at line " + (this.pc+1));
            }
            break;

        case "assign":
            this.pc += 1;
            var value = this._eval(command.expr);
            this._assign(command.var, value, function() {
                callback();
            })
            return true;
            break;

        case "weak_assign":
            this.pc += 1;
            if(!this._varExists(command.var)) {
                var value = this._eval(command.expr);
                this._assign(command.var, value, function() {
                    callback();
                });
            } else {
                setImmediate(callback);
            }
            return true;
            break;

        case "cond":
            if(this._eval(command.cmp)) {
                return this._execute(command.stmt, callback);  // Warning RECURSION!
            } else {
                this.pc += 1;
                setImmediate(callback)
                return true;
            }
            break;

        case "comment":
            var comment = command.comment.join('').trim();
            if(comment != '') {
                //this.emit_gcode('( ' + comment + ' )') // TODO allow for comments
            }
            this.pc += 1;
            return false;
            break;

        case "label":
        case undefined:
            this.pc += 1;
            return false;
            break;

        case "pause":
            // PAUSE is kooky
            this.pc += 1;
            var arg = this._eval(command.expr);
            var var_name = command.var;
            if(util.isANumber(arg)) {
                // If argument is a number set pause with timer and default message.
                // In simulation, just don't do anything
                if(!this.machine) {
                    setImmediate(callback);
                    return true;
                }
                this.paused = true;
                this.machine.setState(this, 'paused', {'message': "Pause " + arg + " Seconds.", 'timer': arg});
                return true;
            } else {
                // In simulation, just don't do anything
                if(!this.machine) {
                    setImmediate(callback);
                    return true;
                }
                // If a message is provided, pause with a dialog
                var message = arg;
                if(!message) {
                    // If a message is not provided, use the comment from the previous line
                    var last_command = this.program[this.pc-2];
                    if(last_command && last_command.type === 'comment') {
                        message = last_command.comment.join('').trim();
                    }
                }
                var params = {'message' : message || "Paused." };
                if(var_name) {
                    params['input'] = var_name;
                }
                this.paused = true;
                //Set driver in paused state
                this.machine.driver.pause_hold = true;
                this.machine.setState(this, 'paused', params);
                return true;
            }
            break;

        case "event":
            // Throw a useful exception for the no-longer-supported ON INPUT command
            this.pc += 1;
            throw new Error("ON INPUT is no longer a supported command.  Make sure the program you are using is up to date.");
            break;

        default:
            // Just skip over commands we don't recognize
            // TODO - Maybe this isn't the best behavior?
            try {
                log.error("Unknown command: " + JSON.stringify(command));
            } catch(e) {
                log.error("Unknown command: " + command);
            }
            this.pc += 1;
            return false;
            break;
    }
    throw new Error("An error occurred in the command processor.  Please report this issue.");
};

// Return true if the provided variable exists in the current program context
// &Tool is a weird case.  (literally) - it will be accepted as defined no matter what it's case
// &Tool == &TOOL == &TOoL
//   identifier - The identifier to check
SBPRuntime.prototype._varExists = function(identifier) {

    if(identifier.type == "user_variable") {
        // User variable

        // Handle weird &Tool Exception case
        // (which exists because of old shopbot case insensitivity)
        if(identifier.expr.toUpperCase() === '&TOOL') {
            identifier.expr = '&TOOL'
        }

        return config.opensbp.hasTempVariable(identifier.expr)
    }

    if(identifier.type == "persistent_variable") {
        // Persistent variable
        return config.opensbp.hasVariable(identifier.expr)
    }
    return false;
}

// Assign a variable to a value
//   identifier - The variable to assign
//        value - The new value
//     callback - Called once the assignment has been made
SBPRuntime.prototype._assign = function(identifier, value, callback) {
    if(identifier.type == "user_variable") {
        // User Variable

        // Handle TOOL exception case
        if(identifier.expr.toUpperCase() === '&TOOL') {
            identifier.expr = '&TOOL'
        }

        // Assign with persistence using the configuration module
        config.opensbp.setTempVariable(identifier.expr, value, callback)
        return
    }
    log.debug(identifier.expr + ' is not a user variable');

    if(identifier.type == "persistent_variable") {
        // Persistent variable

        // Assign with persistence using the configuration module
        config.opensbp.setVariable(identifier.expr, value, callback)
        return
    }
    log.debug(identifier.expr + ' is not a persistent variable');

    throw new Error("Cannot assign to " + identifier);
}

// Return the actual value of an expression.
// This function is for evaluating the leaves of the expression trees, which are either
// variables or constant numeric/string values.
//   expr - String that represents the leaf of an expression tree
SBPRuntime.prototype._eval_value = function(expr) {
    if(expr.hasOwnProperty('type')) {
		switch(expr.type) {
			case 'user_variable':
				return this.evaluateUserVariable(expr);
			case 'system_variable':
				return this.evaluateSystemVariable(expr);
			case 'persistent_variable':
				return this.evaluatePersistentVariable(expr);
		}
    }
    var n = Number(String(expr));
    return isNaN(n) ? expr : n;
};

// Evaluate an expression.  Return the result.
// TODO - Make this robust to undefined user variables
//   expr - The expression to evaluate.  This is a *parsed* expression object
SBPRuntime.prototype._eval = function(expr) {
    // log.debug("Evaluating expression: " + JSON.stringify(expr));
    if(expr === undefined) {return undefined;}

    if(expr.op === undefined) {
        // Expression is unary - no operation.  Just evaluate the value.
        return this._eval_value(expr);
    } else {
        // Do the operation specified in the expression object (recursively evaluating subexpressions)
        switch(expr.op) {
            case '+':
                return this._eval(expr.left) + this._eval(expr.right);
                break;
            case '-':
                return this._eval(expr.left) - this._eval(expr.right);
                break;
            case '*':
                return this._eval(expr.left) * this._eval(expr.right);
                break;
            case '/':
                return this._eval(expr.left) / this._eval(expr.right);
                break;
            case '>':
                return this._eval(expr.left) > this._eval(expr.right);
                break;
            case '<':
                return this._eval(expr.left) < this._eval(expr.right);
                break;
            case '>=':
                return this._eval(expr.left) >= this._eval(expr.right);
                break;
            case '<=':
                return this._eval(expr.left) <= this._eval(expr.right);
            break;
            case '==':
            case '=':
                return this._eval(expr.left) == this._eval(expr.right);
                break;
            case '<>':
            case '!=':
                return this._eval(expr.left) != this._eval(expr.right);
                break;

            default:
                throw "Unhandled operation: " + expr.op;
        }
    }
};

// Initialize the runtime (set its internal state variables to their startup states)
SBPRuntime.prototype.init = function() {
    this.pc = 0;
    this.coordinateSystem = "G55"
    this.start_of_the_chunk = 0;
    this.stack = [];
    this.label_index = {};
    this.current_chunk = [];
    this.started = false;
    this.sysvar_evaluated = false;
    this.output = [];               // Used in simulation mode only ??meaning??
    this.quit_pending = false;
    this.end_message = null;
    this.paused = false;
    this.units = config.machine.get('units');
    this.pending_error = null;
    this.pendingFeedhold = false;

    if(this.transforms != null && this.transforms.level.apply === true) {
        leveler = new Leveler(this.transforms.level.ptDataFile);
    }
};

// Set the preferred units to the units provided.
// This function is called externally when the user changes the canonical system units.
//      units - The new unit system
//   callback - Called when the unit change has been made
SBPRuntime.prototype.setPreferredUnits = function(units, callback) {
    log.info("SBP runtime is setting the preferred units to " + units)
    this._loadConfig();
    this._setUnits(units);
    this._saveConfig(callback);
}

// Set the current units to the provided value
// (Converts internal state to the specified unit system)
SBPRuntime.prototype._setUnits = function(units) {
    units = u.unitType(units);
    if(units === this.units) { return; }
    var convert = units === 'in' ? u.mm2in : u.in2mm;
    this.movespeed_xy = convert(this.movespeed_xy);
    this.movespeed_z = convert(this.movespeed_z);
    this.movespeed_a = convert(this.movespeed_a);
    this.movespeed_b = convert(this.movespeed_b);
    this.movespeed_c = convert(this.movespeed_c);
    this.jogspeed_xy = convert(this.jogspeed_xy);
    this.jogspeed_z = convert(this.jogspeed_z);
    this.jogspeed_a = convert(this.jogspeed_a);
    this.jogspeed_b = convert(this.jogspeed_b);
    this.jogspeed_c = convert(this.jogspeed_c);
    this.maxjerk_xy = convert(this.jogspeed_xy);
    this.maxjerk_z = convert(this.jogspeed_z);
    this.maxjerk_a = convert(this.jogspeed_a);
    this.maxjerk_b = convert(this.jogspeed_b);
    this.maxjerk_c = convert(this.jogspeed_c);
    this.cmd_posx = convert(this.cmd_posx);
    this.cmd_posy = convert(this.cmd_posy);
    this.cmd_posz = convert(this.cmd_posz);
    this.units = units
}


// Compile an index of all the labels in the program
// this.label_index will map labels to line numbers
// An error is thrown on duplicate labels
SBPRuntime.prototype._analyzeLabels = function() {
    this.label_index = {};
    for(i=0; i<this.program.length; i++) {
        line = this.program[i];
        if(line && line.type) {
            switch(line.type) {
                case "label":
                    if (line.value in this.label_index) {
                        throw new Error("Duplicate label.");
                    }
                    this.label_index[line.value] = i;
                    break;
            }
        }
    }
};



// Check all the GOTOS/GOSUBS in the program and make sure their labels exist
// Throw an error for undefined labels.
SBPRuntime.prototype._analyzeGOTOs = function() {
    for(i=0; i<this.program.length; i++) {
            var line = this.program[i];
            if(line) {
                switch(line.type) {
                    case "cond":
                        line = line.stmt;
                        // No break: fall through to next state(s)
                    case "goto":
                    case "gosub":
                        if (line.label in this.label_index) {
                            // pass
                        } else {
                            // Add one to the line number so they start at 1
                            ////## right now, in a macro, you need to add 3; FIX and show all lines
                            throw new Error("Undefined label " + line.label + " on line " + (i+1));
                        }
                        break;
                    default:
                        // pass
                        break;
                }
            }
        }
};

////## Needs to be fixed for C-AXIS
// Return the value of the provided system variable.
//   v - System variable as a string, eg: "%(1)"
SBPRuntime.prototype.evaluateSystemVariable = function(v) {
    if(v === undefined) { return undefined;}

    if(v.type != "system_variable") {return;}
    var n = this._eval(v.expr);
    switch(n) {
        case 1: // X Location
            return this.machine.status.posx;
        break;

        case 2: // Y Location
            return this.machine.status.posy;
        break;

        case 3: // Z Location
            return this.machine.status.posz;
        break;

        case 4: // A Location
            return this.machine.status.posa;
        break;

        case 5: // B Location
            return this.machine.status.posb;
        break;

        case 6: // X Table Base
            return config.driver.get('g55x');
        break;

        case 7: // Y Table Base
            return config.driver.get('g55y');
        break;

        case 8: // Z Table Base
            return config.driver.get('g55z');
        break;

        case 9: // A Table Base
            return config.driver.get('g55a');
        break;

        case 10: // B Table Base
            return config.driver.get('g55b');
        break;

        case 11: //Min Table limit X
            var envelope = config.machine.get('envelope');
            return envelope.xmin;
        break

        case 12: //Max Table limit X
            var envelope = config.machine.get('envelope');
            return envelope.xmax;
        break

        case 13: //Min Table limit Y
            var envelope = config.machine.get('envelope');
            return envelope.ymin;
        break

        case 14: //Max Table limit Y
            var envelope = config.machine.get('envelope');
            return envelope.ymax;
        break

        case 28:
            return config.opensbp.get('safeZpullUp');
        break

        case 25:
            units = config.machine.get('units');
            if(units === 'in') {
                return 0;
            } else if(units === 'mm') {
                return 1;
            } else {
                return -1;
            }
            break;
        
        case 28:
            return
        break

        case 51:
        case 52:
        case 53:
        case 54:
        case 55:
        case 56:
        case 57:
        case 58:
            return this.machine.status['in' + (n-50)];
            break;

        case 71: // XY Move Speed
            return config.opensbp.get('movexy_speed');
        break;

        case 72: // XY Move Speed
            return config.opensbp.get('movexy_speed');
        break;

        case 73:
            return config.opensbp.get('movez_speed');
        break;

        case 74:
            return config.opensbp.get('movea_speed');
        break;

        case 75:
            return config.opensbp.get('moveb_speed');
        break;

        case 76:
            return config.opensbp.get('movec_speed');
        break;

        case 81:
            return config.driver.get('xjm');
        break;

        case 82:
            return config.driver.get('yjm');
        break;

        case 83:
            return config.driver.get('zjm');
        break;

        case 84:
            return config.driver.get('ajm');
        break;

        case 85:
            return config.driver.get('bjm');
        break;

        case 86:
            return config.driver.get('cjm');
        break;

        case 144:
            return this.machine.status.posc;
        break;

        default:
            throw new Error("Unknown System Variable: " + JSON.stringify(v));
        break;
    }
};

// Return true if the provided expression is a variable
//   v - Value to check, eg: "&Tool" or "%(1)"
SBPRuntime.prototype._isVariable = function(v) {
    return  this._isUserVariable(v) ||
            this._isPersistentVariable(v) ||
            this._isSystemVariable(v);
}

// Return true if the provided expression is a system variable
//   v - Value to check
SBPRuntime.prototype._isSystemVariable = function(v) {
    if (v.type == "system_variable") {
        return true;
    }
    return false;
}

// Return true if the provided expression is a user variable
//   v - Value to check
SBPRuntime.prototype._isUserVariable = function(v) {
    if(v.type == "user_variable") {
        return true;
    }
    return false;
}

// Return true if the provided expression is a persistent variable
//   v - Value to check
SBPRuntime.prototype._isPersistentVariable = function(v) {
    if(v.type == "persistent_variable") {
        return true;
    }
    return false;
}

// Return a string that indicates the type of the provided variable.  Either user,system, or persistent
//   v - Value to check
SBPRuntime.prototype._variableType = function(v) {
    if(this._isUserVariable(v)) {return 'user';}
    if(this._isSystemVariable(v)) {return 'system';}
    if(this._isPersistentVariable(v)) {return 'persistent';}
}

//rmackie
// Return the value for the provided user variable
//   v - identifier to check, eg: '&Tool'
SBPRuntime.prototype.evaluateUserVariable = function(v) {
    if(v === undefined) { return undefined;}
    if(v.type != "user_variable") { return undefined;}
    if(v.expr.toUpperCase() === '&TOOL') {
        v.expr = '&TOOL';
    }
    return config.opensbp.getTempVariable(v.expr);
};

// Return the value for the provided persistent variable
//   v - identifier to check, eg: '$Tool'
SBPRuntime.prototype.evaluatePersistentVariable = function(v) {
    if(v === undefined) { return undefined;}
    if(v.type != "persistent_variable") { return undefined;}
    return config.opensbp.getVariable(v.expr);
};

// Called for any valid shopbot mnemonic that doesn't have a handler registered
//   command - The command mnemonic that is unidentified
SBPRuntime.prototype._unhandledCommand = function(command) {
    log.warn('Unhandled Command: ' + JSON.stringify(command));
};

// Create an execution frame for the current program context and push it onto this.file_stack
// The program context here means things like which coordinate system, speeds, the current PC, etc.
SBPRuntime.prototype._pushFileStack = function() {
    frame =  {}
    frame.coordinateSystem = this.coordinateSystem
    frame.movespeed_xy = this.movespeed_xy
    frame.movespeed_z = this.movespeed_z
    frame.pc = this.pc
    frame.movexy
    frame.program = this.program
    frame.stack = this.stack;
    //frame.user_vars = this.user_vars
    //frame.current_chunk = this.current_chunk
    frame.end_message = this.end_message
    frame.label_index = this.label_index
    this.file_stack.push(frame)
}

// Retrieve the execution frame on top of this.file_stack and restore the program context from it
// The program context here means things like which coordinate system, speeds, the current PC, etc.
SBPRuntime.prototype._popFileStack = function() {
    frame = this.file_stack.pop()
    this.movespeed_xy = frame.movespeed_xy
    this.movespeed_z = frame.movespeed_z
    this.pc = frame.pc
    this.coordinateSystem = frame.coordinateSystem
    this.emit_gcode(this.coordinateSystem)  
    this.program = frame.program
    this.stack = frame.stack
    //this.user_vars = frame.user_vars
    this.label_index = frame.label_index;
    //this.current_chunk = frame.current_chunk
    this.end_message = frame.end_message
}

// Emit a g-code into the stream of running codes
//   s - Can be any g-code but should not contain the N-word
SBPRuntime.prototype.emit_gcode = function(s) {

    // An N-Word is added to this code to indicate the line number in the original OpenSBP file
    // that generated these codes.  We only track line numbers for the top level program.  
    if(this.file_stack.length > 0) {
        var n = this.file_stack[0].pc;
    } else {
        var n = this.pc;
    }
    this.gcodesPending = true;
    var temp_n = n + 20; ////## save low numbers for prepend/postpend; being done in util for gcode?
    var gcode = 'N' + temp_n + ' ' + s; 
    log.debug('Writing to stream in emit_gcode: ' + gcode);
    log.debug("emit_gcode: " + gcode);
    gcode = gcode + '\n ';
    this.stream.write(gcode);
};

// Helper function used by M_ commands that generates a movement code (G1,G0) 
// on the specified position after having applied transformations to that position
// TODO - Gordon, provide some documentation here?
SBPRuntime.prototype.emit_move = function(code, pt) {
    var gcode = code;
    var i;

    ['X','Y','Z','A','B','C','I','J','K','F'].forEach(function(key){
        var c = pt[key];
        if(c !== undefined) {

            if(isNaN(c)) {
                var err = new Error("Invalid " + key + " argument: " + c );
                log.error(err);
                throw err;
            }
            if(key === "X") { this.cmd_posx = c; }
            else if(key === "Y") { this.cmd_posy = c; }
            else if(key === "Z") { this.cmd_posz = c; }
            else if(key === "A") { this.cmd_posa = c; }
            else if(key === "B") { this.cmd_posb = c; }
            else if(key === "C") { this.cmd_posc = c; }
        }
    }.bind(this));

    // Where to save the start point of an arc that isn't transformed??????????
    var tPt = this.transformation(pt);

    // log.debug("Emit_move: Transformed point: " + JSON.stringify(tPt));

    //  log.debug("interpolate = " + this.transforms.interpolate.apply );
    //  if(( this.transforms.level.apply === true || this.transforms.interpolate.apply === true ) && code !== "G0" ){
    //      if( code === "G1"){
    //          log.debug( "emit_move: lineInterpolate = " + code + "  pt = " + JSON.stringify(pt));
    //          interp.lineInterpolate(this, pt);
    //      }
    //      else if(code === "G2" || code === "G3"){
    //          log.debug( "emit_move: circleInterpolate = " + code + "  pt = " + JSON.stringify(pt));
    //          interp.circleInterpolate(this, code, pt);
    //      }
    //  }
    //  else{

    if(this.file_stack.length > 0) {
        var n = this.file_stack[0].pc;
    } else {
        var n = this.pc;
    }

    var opFunction = function(Pt) {  //Find a better name
        // for(key in tPt) {
        ['X','Y','Z','A','B','C','I','J','K','F'].forEach(function(key){
            var v = Pt[key];
            if(v !== undefined) {
                if(isNaN(v)) {
                    var err = new Error("Invalid " + key + " argument: " + v);
                    log.error(err);
                    throw(err);
                }
                gcode += (key + v.toFixed(5));
            }
        }.bind(this));
        this.emit_gcode(gcode);
    }.bind(this);

    if(this.transforms.level.apply === true) {
        if(leveler.triangulationFailed() === true) {
            log.error("Point cloud not triangulated, impossible to do levelling.");
            return;
        }
        var previousHeight = leveler.foundHeight;
        var X = (tPt.X === undefined) ? this.cmd_posx : tPt.X;
        var Y = (tPt.Y === undefined) ? this.cmd_posy : tPt.Y;
        if(X === undefined) {
            X = 0;
        }
        if(Y === undefined) {
            Y = 0;
        }
        var theoriticalZ = (tPt.Z === undefined) ? this.cmd_posz : tPt.Z;
        if(theoriticalZ === undefined) {
            theoriticalZ = 0;
        }

        var relativeHeight = leveler.findHeight(X, Y);
        if(relativeHeight === false) {
            log.info("[Leveler] Point outside of point cloud boundaries.");
            relativeHeight = 0;
        }
        tPt.Z = theoriticalZ + relativeHeight;
        opFunction(tPt);
    }
    else {
        opFunction(tPt);
    }

};

// Load transform settings from the OpenSBP configuration
SBPRuntime.prototype._setupTransforms = function() {
    log.debug("_setupTransforms");
    this.transforms = JSON.parse(JSON.stringify(config.opensbp.get('transforms')));
};

// Transform the specified point
// TODO - Gordon, docs?
SBPRuntime.prototype.transformation = function(TranPt){
    if (this.transforms.rotate.apply !== false){
        log.debug("transformation = " + JSON.stringify(TranPt));
        // log.debug("rotation apply = " + this.transforms.rotate.apply);
//      log.debug("Rotate: " + JSON.stringify(this.transforms.rotate));
        log.debug("  cmd_posx = " + this.cmd_posx + "  cmd_posy = " + this.cmd_posy);
        if ( "X" in TranPt || "Y" in TranPt ){
            if ( !("X" in TranPt) ) { TranPt.X = this.cmd_posx; }
            if ( !("Y" in TranPt) ) { TranPt.Y = this.cmd_posy; }
            log.debug("transformation TranPt: " + JSON.stringify(TranPt));
            var angle = this.transforms.rotate.angle;
            var x = TranPt.X;
            var y = TranPt.Y;
            var PtRotX = this.transforms.rotate.x;
            var PtRotY = this.transforms.rotate.y;
            log.debug("transformation: cmd_posx = " + this.cmd_posx + "  cmd_posy = " + this.cmd_posy);
            TranPt = tform.rotate(TranPt,angle,PtRotX,PtRotY,this.cmd_StartX,this.cmd_StartY);
        }
    }
    ////No angle being passed to shear functions so they return null
    if (this.transforms.shearx.apply != false){
        log.debug("ShearX: " + JSON.stringify(this.transforms.shearx));
        TranPt = tform.shearX(TranPt);
    }
    if (this.transforms.sheary.apply != false){
        log.debug("ShearY: " + JSON.stringify(this.transforms.sheary));
        TranPt = tform.shearY(TranPt);
    }
    if (this.transforms.scale.apply != false){
        log.debug("Scale: " + JSON.stringify(this.transforms.scale));
        var ScaleX = this.transforms.scale.scalex;
        var ScaleY = this.transforms.scale.scaley;
        var PtX = this.transforms.scale.x;
        var PtY = this.transforms.scale.y;

        TranPt = tform.scale(TranPt,ScaleX,ScaleY,PtX,PtY);
    }
    if (this.transforms.move.apply != false){
        log.debug("Move: " + JSON.stringify(this.transforms.move));
        TranPt = tform.translate(TranPt,
                                 this.transforms.move.x,
                                 this.transforms.move.y,
                                 this.transforms.move.z );
    }

    return TranPt;

};

// Pause the currently running program
SBPRuntime.prototype.pause = function() {
    if(this.machine.driver.status.stat == this.machine.driver.STAT_END ||
       this.machine.driver.status.stat == this.machine.driver.STAT_STOP) {
        this.pendingFeedhold = true;
    } else {
        this.machine.driver.feedHold();
        this.inFeedHold = true;
    }
}

// Quit the currently running program
// If the machine is currently moving it will be stopped immediately and the program abandoned
SBPRuntime.prototype.quit = function() {
    log.debug('OpenSBP runtime new Quit');

    //TODO: Not sure order matters but I think we want to teardown the runtime and close the stream first.
    //      Should driver quit be a callback?
    // Teardown runtime.
    log.debug("runtime quit(): begin teardown");
    this._end();
    log.debug("runtime quit(): teardown complete")

    // Send Quit to g2.js driver.
    log.debug("issuing driver quit");
    this.driver.quit();
    log.debug("driver quit issued");
}

////## Old version after Josh refactor 
// // Quit the currently running program
// // If the machine is currently moving it will be stopped immediately and the program abandoned
// SBPRuntime.prototype.quit = function() {
//     if(this.ok_to_disconnect) {
//         return this._end();
//     }

//     if(this.machine.status.state == 'stopped' || this.machine.status.state == 'paused') {
//         this.machine.driver.quit();
//     } else {
//         this.quit_pending = true;
//         this.driver.quit();
//     }
// }

// Resume a program from the paused state
//   TODO - make some indication that this action was successfil (resume is not always allowed, and sometimes it fails)
SBPRuntime.prototype.resume = function(input=false) {
        if(this.resumeAllowed) {
            if(this.paused) {
                if (input) {
                    var callback = (function(err, data) {
                        if (err) {
                            console.log(err)
                        } else {
                            this.paused = false;
                            log.debug("___ call _executeNext {._resume1}")
                            this._executeNext();
                        }
                    }).bind(this);
                    this._assign(input.var, input.val, callback);
                } else {
                    this.paused = false;
                    log.debug("___ call _executeNext {._resume2}")
                    this._executeNext();
                }
            } else {
                this.driver.resume();
                this.inFeedHold = false;
            }
        }
}

// Enter the manual state
// This function is called by the SK command in order to bring up the keypad
//    message - The message for the top of the keypad display
//   callback - Called once the manual state is exited
SBPRuntime.prototype.manualEnter = function(message, callback) {
    this.inManualMode = true;
    this._update();
    
    if(this.machine) {
        this.machine.setState(this, 'manual', message ? {'message' : message } : undefined);
        this.machine.authorize();
    }

    this.helper = new ManualDriver(this.driver, this.stream);
    this.helper.enter().then(function() {
        this.inManualMode = false;
        this.machine.setState(this, "running");
        this._update();
        if(this.absoluteMode) {
            this.emit_gcode('G90');
        }
        this.emit_gcode('G4 P0.1');
        callback();
    }.bind(this));
}

exports.SBPRuntime = SBPRuntime;
