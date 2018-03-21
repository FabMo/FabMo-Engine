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

var SYSVAR_RE = /\%\(([0-9]+)\)/i ;
var USERVAR_RE = /\&([a-zA-Z_]+[A-Za-z0-9_]*)/i ;
var PERSISTENTVAR_RE = /\$([a-zA-Z_]+[A-Za-z0-9_]*)/i ;

/**
 * The SBPRuntime object is responsible for running OpenSBP code.
 *
 * For more info and command reference: http://www.opensbp.com/
 * Note that not ALL of the OpenSBP standard listed at the above URL is supported.
 *
 * FabMo supports a limited subset of the original standard, as not all commands make sense
 * to use in the FabMo universe.
 */
function SBPRuntime() {
	// Handle Inheritance
	events.EventEmitter.call(this);
	this.connected = false;
	this.ok_to_disconnect = true;
	this.stack = [];
	this.program = [];
	this.pc = 0;
	this.start_of_the_chunk = 0;
	this.user_vars = {};
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
	this.lastNoZPullup = 0;
	this.continue_callback = null;
	this.vs_change = 0;
	this.units = null;
	this.absoluteMode = true;

	// Physical machine state
	this.machine = null;
	this.driver = null;

	this.inManualMode = false;

}
util.inherits(SBPRuntime, events.EventEmitter);

SBPRuntime.prototype.toString = function() {
	return "[SBPRuntime]";
}

// This must be called at least once before instantiating an SBPRuntime object
// TODO: Make this a "class method" rather than an instance method
SBPRuntime.prototype.loadCommands = function(callback) {
	commands=require('./commands').load();
	proto = Object.getPrototypeOf(this);
	for(var attr in commands) {
		proto[attr] = commands[attr];
	}
	callback(null, this)
}

// Connect this runtime to the machine model.
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
		//this.driver.removeListener('status', this.status_handler);
		this.machine = null;
		this.driver = null;
		this.connected = false;
		log.info('Disconnected OpenSBP runtime.');
	} else {
		throw new Error("Cannot disconnect OpenSBP runtime.")
	}
};

SBPRuntime.prototype.executeCode = function(s, callback) {
	if(typeof s === "string" || s instanceof String) {
		this.runString(s, callback);		
	} else {
		if(this.inManualMode) {
			switch(s.cmd) {
			case 'enter':
				//	this.enter();
				break;
			default:
				if(!this.helper) {
					log.warn("Can't accept command '" + s.cmd + "' - not entered.");
					this.machine.setState(this, 'idle');
					return;
				}
				switch(s.cmd) {
					case 'exit':
						this.helper.exit();
						// RESUME KIDS
						break;

					case 'start':
						this.helper.startMotion(s.axis, s.speed);
						break;

					case 'stop':
						this.helper.stopMotion();
						break;

					case 'maint':
						this.helper.maintainMotion();
						break;

					case 'fixed':
						if(!this.helper) {
							this.enter();
						}
						this.helper.nudge(s.axis, s.speed, s.dist);
						break;

					default:
						log.error("Don't know what to do with '" + s.cmd + "' in manual command.");
						break;

				}
			}

		}
	}
}

//Check whether the code needs auth
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

// Run the provided string in OpenSBP format
SBPRuntime.prototype.runString = function(s, callback) {
	try {
		var lines =  s.split('\n');
		if(this.machine) {
			if(this.file_stack.length === 0) {
				this.machine.status.nb_lines = lines.length - 1;
			}
		}
		try {
			this.program = parser.parse(s);
		} catch(e) {
			return this._end(e.message + " (Line " + e.line + ")");
		}
 		lines = this.program.length;
		this._setupTransforms();
		this.init();
		this.end_callback = callback;
		this._loadConfig();
		this._loadDriverSettings();
		log.debug("Transforms configured...")
		this._analyzeLabels();  // Build a table of labels
		log.debug("Labels analyzed...")
		this._analyzeGOTOs();   // Check all the GOTO/GOSUBs against the label table
		log.debug("GOTOs analyzed...")
		log.debug("Rainbows organized...")
		var st = this._run();
		log.debug("Returning from run...");
		return st;
	} catch(e) {
		log.error(e);
		return this._end(e.message + " (Line " + e.line + ")");
	}
};

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
// Run the provided file on disk
SBPRuntime.prototype.runFile = function(filename, callback) {
	fs.readFile(filename, 'utf8', function(err, data) {
		if(err) {
			callback(err);
		} else {
			this.runString(data, callback);
		}
	}.bind(this));
};

// Simulate the provided file, returning the result as g-code
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

// Handler for G2 statue reports
SBPRuntime.prototype._onG2Status = function(status) {

	if(!this.connected) {
		log.warn("OpenSBP runtime got a status report while disconnected.");
		return;
	}

	switch(status.stat) {
		case this.driver.STAT_INTERLOCK:
		case this.driver.STAT_SHUTDOWN:
		case this.driver.STAT_PANIC:
			return this.machine.die('A G2 exception has occurred. You must reboot your tool.');
			break;
	}

	// Update our copy of the system status
    for (var key in this.machine.status) {
		if(key in status) {
			this.machine.status[key] = status[key];
		}
	}

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
SBPRuntime.prototype._evaluateArguments = function(command, args) {
	// log.debug("Evaluating arguments: " + command + "," + JSON.stringify(args));
	// Scrub the argument list:  extend to the correct length, sub in defaults where necessary.
	scrubbed_args = [];
	if(command in sb3_commands) {
		params = sb3_commands[command].params || [];
		if(args.length > params.length) {
			log.warn('More parameters passed into ' + command + ' (' + args.length + ') than are supported by the command. (' + params.length + ')');
		}
		for(i=0; i<params.length; i++) {
			prm_param = params[i];
			user_param = args[i];
			if((args[i] !== undefined) && (args[i] !== "")) {
				// log.debug('Taking the users argument: ' + args[i]);
				scrubbed_args.push(args[i]);
			} else {
				//log.debug("Taking the default argument: " + args[i] + " (PRN file)");
				//scrubbed_args.push(prm_param.default || undefined);
				// log.debug('No user specified argument.  Using undefined.');
				scrubbed_args.push(undefined);
			}
		}
	} else {
		scrubbed_args = [];
	}
	// log.debug("Scrubbed arguments: " + JSON.stringify(scrubbed_args));

	// Create the list of evaluated arguments to be returned
	retval = [];
	for(i=0; i<scrubbed_args.length; i++) {
		retval.push(this._eval(scrubbed_args[i]));
	}
	return retval;
};

// Returns true if the provided command breaks the stack
SBPRuntime.prototype._breaksStack = function(cmd) {
	var result;
	if(cmd.args) {
        for(var i=0; i<cmd.args.length; i++) {
            if(this._exprBreaksStack(cmd.args[i])) {
                log.warn("STACK BREAK for an expression: " + JSON.stringify(cmd.args[i]))
                return true;
            }
        }
    }

    switch(cmd.type) {
		// Commands (MX, VA, C3, etc) break the stack only if they must ask the tool for data
		// TODO: Commands that have sysvar evaluation in them also break stack
		case "cmd":
			var name = cmd.cmd;
			if((name in this) && (typeof this[name] == 'function')) {
				f = this[name];
				if(f && f.length > 1) {
					return true;
				}
			}
			result = false;
			break;

		// For now, pause translates to "dwell" which is just a G-Code
		case "pause":
			return true;
			break;

		case "cond":
			return true;
			//TODO , we should check the expression for a stack break, as well as the .stmt
			//return _breaksStack(cmd.stmt);
			break;
        	case "weak_assign":
		case "assign":
			result = true;
			break;
			//return this._exprBreaksStack(cmd.var) || this._exprBreaksStack(cmd.expr)

		case "custom":
			result = true;
			break;

		case "return":
		case "goto":
		case "gosub":
			result = true;
			break;

		case "open":
			result = true;
			break;

		case "event":
			result = true; // TODO: DEPRECATE
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

// Start the stored program running
SBPRuntime.prototype._run = function() {
	log.info("Starting OpenSBP program")
	if(this.machine) {
		this.machine.setState(this, "running");
	}

		// DO IT
		this.started = true;
		this.waitingForStackBreak = false;
		this.gcodesPending = false;

		//var this = this;
		var onStat = function(stat) {
			if(this.inManualMode) {
				return;
			}
			switch(stat) {
				case this.driver.STAT_STOP:
					this.gcodesPending = false;
                    this._executeNext();
				break;
				case this.driver.STAT_HOLDING:
					//this.paused = true;
					this.machine.setState(this, 'paused');
				break;
                case this.driver.STAT_PROBE:
				case this.driver.STAT_RUNNING:
					if(!this.inManualMode) {
						this.machine.setState(this, 'running');
					    if(this.pendingFeedhold) {
	                        this.pendingFeedhold = false;
	                        this.driver.feedHold();
	                    }
                	}
                break;

			}
		}

		if(this.file_stack.length) {
			log.debug("Running Subprogram")
			this._executeNext();
		} else {
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

			this._executeNext();
		}
	return this.stream;
};

SBPRuntime.prototype.isInSubProgram = function() {
	return this.file_stack.length > 0;
}

// Continue running the current program (until the end of the next chunk)
// _executeNext() will dispatch the next chunk if appropriate, once the current chunk is finished
SBPRuntime.prototype._executeNext = function() {
	this._update();
    log.debug('_executeNext called.');
	// Continue is only for resuming an already running program.  It's not a substitute for _run()
	if(!this.started) {
		log.warn('Got a _executeNext() but not started');
        return;
	}

	if(this.pending_error) {
		return this._abort(this.pending_error);
	}

	if(this.paused) {
		log.info('Program is paused.');
        return;
	}

	if(this.pc >= this.program.length) {
		log.info("End of program reached. (pc = " + this.pc + ")");
		this.prime();
		if(this.gcodesPending && this.driver) {
            log.debug('GCodes are still pending...')
            return;
        }

		if(this.isInSubProgram()) {
			log.debug("This is a nested end.  Popping the file stack.");
			this._popFileStack();
			this.pc += 1;
			setImmediate(this._executeNext.bind(this));
			return;
		} else {
			log.debug("This is not a nested end.  No stack.");
			this.emit_gcode('M30');
			if(!this.driver) {
				this._end();
			} else {
                this.prime();
                //setTimeout(function() {this.prime();}.bind(this), 3000)
            }
			return;
		}
	}

	// Pull the current line of the program from the list
	var line = this.program[this.pc];
	var breaksTheStack = this._breaksStack(line);

	if(breaksTheStack) {
		log.debug("Stack break: " + JSON.stringify(line));
		this.prime();

		if(this.gcodesPending && this.driver) {
			log.debug("Deferring because g-codes pending.");
			this.driver.requestStatusReport();
			return; // G2 is running, we'll get called when it's done
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
		log.debug("Non-Stack break: " + JSON.stringify(line));
		try {
			log.debug("executing: " + JSON.stringify(line))
			this._execute(line);
			setImmediate(this._executeNext.bind(this));
		} catch(e) {
			log.error(e)
			if(this.driver.status.stat != this.driver.STAT_STOP) {
				this._abort(e);
				setImmediate(this._executeNext.bind(this));
			} else {
				return this._end(e);
			}
		}
	}
};

SBPRuntime.prototype.prime = function() {
	if(this.driver) {
		this.driver.prime();
	}
}
SBPRuntime.prototype._abort = function(error) {
    this.pending_error = error;
    this.stream.end();
}
SBPRuntime.prototype._end = function(error) {

	error = error ? error.message || error : null;
	if(!error) {
		error = this.end_message || null;
	}
	log.debug("Calling the non-nested (toplevel) end");
    if(error) {log.error(error)}
	var cleanup = function(error) {
		if(this.machine && error) {
			this.machine.setState(this, 'stopped', {'error' : error });
		}
		if(!this.machine){
			this.stream.end();
		}
		this.ok_to_disconnect = true;
		this.emit('end', this);
		if(this.end_callback) {
			this.end_callback();
		}
	}.bind(this);

	this.init();

	if(error) {
        if(this.machine) {
			this.machine.restoreDriverState(function(err, result) {
				cleanup(error);
			}.bind(this));
        } else {
            cleanup(error);
        }
	} else {
		if(this.machine) {
			this.machine.restoreDriverState(function(err, result) {
				if(this.machine.status.job) {
					this.machine.status.job.finish(function(err, job) {
						this.machine.status.job=null;
						this.machine.setState(this, 'idle');
					}.bind(this));
				} else {
					this.driver.setUnits(config.machine.get('units'), function() {
						this.machine.setState(this, 'idle');
					}.bind(this));
				}
				cleanup();
			}.bind(this));
		} else {
			cleanup();
		}
	}
};

SBPRuntime.prototype._executeCommand = function(command, callback) {
	if((command.cmd in this) && (typeof this[command.cmd] == 'function')) {
		// Evaluate the command arguments
		args = this._evaluateArguments(command.cmd, command.args);
		// Get the handler for this command
		f = this[command.cmd].bind(this);

		log.debug("Calling handler for " + command.cmd + " With arguments: [" + args + "]");

		if(f.length > 1) {
			// This is a stack breaker, run with a callback
			try {
				f(args, function() {this.pc+=1; callback();}.bind(this));
			} catch(e) {
				log.error("There was a problem executing a stack-breaking command: ");
				log.error(e);
				this.pc+=1;
				callback();
			}
			return true;
		} else {
			// This is NOT a stack breaker, run immediately, increment PC, proceed.
			try {
				f(args);
			} catch(e) {
				log.error("Error in a non-stack-breaking command");
				log.error(e);
				throw e;
			}
			this.pc +=1;
			return false;
		}
	} else {
		// We don't know what this is.  Whatever it is, it doesn't break the stack.
		this._unhandledCommand(command);
		this.pc += 1;
		return false;
	}
};

SBPRuntime.prototype.runCustomCut = function(number) {
	var macro = macros.get(number);
	if(macro) {
		log.debug("Running macro: " + JSON.stringify(macro))
		this._pushFileStack();
		this.runFile(macro.filename);
	} else {
		throw new Error("Can't run custom cut (macro) C" + number + ": Macro not found.")
	}
	return true;
}

// Execute the provided command
// Command is a single parsed line of OpenSBP code
// Returns true if execution breaks the stack (and calls the callback upon command completion)
// Returns false if execution does not break the stack (and callback is never called)
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
			return this._executeCommand(command, callback);
			break;

		// A C# command (custom cut)
		case "custom":
			this.runCustomCut(command.index);
			return true;
			break;

		case "return":
			if(this.stack) {
				this.pc = this.stack.pop();
				setImmediate(callback);
				return true;
			} else {
				throw "Runtime Error: Return with no GOSUB at " + this.pc;
			}
			return true;
			break;

		case "end":
			this.pc = this.program.length;
			if(command.message) {
				this.end_message = command.message;
			}
			return false;
			break;

		case "goto":
			if(command.label in this.label_index) {
				var pc = this.label_index[command.label];
				log.debug("Hit a GOTO: Going to line " + pc + "(Label: " + command.label + ")");
				this.pc = pc;
				setImmediate(callback);
				return true;
			} else {

				throw new Error("Runtime Error: Unknown Label '" + command.label + "' at line " + this.pc);
			}
			break;

		case "gosub":
			if(command.label in this.label_index) {
				this.stack.push(this.pc + 1);
				log.debug("Pushing the current PC onto the stack (" +(this.pc + 1) + ")")
				this.pc = this.label_index[command.label];
				setImmediate(callback);
				return true;
			} else {
				throw new Error("Runtime Error: Unknown Label '" + command.label + "' at line " + this.pc);
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
			this.pc += 1;
			var arg = this._eval(command.expr);
			if(util.isANumber(arg)) {
				this.emit_gcode('G4 P' + this._eval(command.expr));
				setImmediate(callback);
				return true;
			} else {
                if(!this.machine) {
                    setImmediate(callback);
                    return true;
                }
				var message = arg;
				if(!message) {
					var last_command = this.program[this.pc-2];
					if(last_command && last_command.type === 'comment') {
						message = last_command.comment.join('').trim();
					}
				}
				this.paused = true;
				this.machine.setState(this, 'paused', {'message' : message || "Paused." });
				return true;
			}
			break;

		case "event":
			this.pc += 1;
			//this._setupEvent(command, callback);
			log.warn("Event handling (ON INPUTs) are disabled.")
			setImmediate(callback);
			return true;
			break;

		default:
			try {
				log.error("Unknown command: " + JSON.stringify(command));
			} catch(e) {
				log.error("Unknown command: " + command);
			}
			this.pc += 1;
			return false;
			break;
	}
	throw new Error("Shouldn't ever get here.");
};

SBPRuntime.prototype._varExists = function(identifier) {
	result = identifier.match(USERVAR_RE);
	if(result) {
		return (identifier in this.user_vars);
	}

	result = identifier.match(PERSISTENTVAR_RE);
	if(result) {
		return config.opensbp.hasVariable(identifier)
	}
	return false;
}

SBPRuntime.prototype._assign = function(identifier, value, callback) {
	result = identifier.match(USERVAR_RE);
	if(result) {
		this.user_vars[identifier] = value;
		setImmediate(callback);
		return
	}
	log.debug(identifier + ' is not a user variable');

	result = identifier.match(PERSISTENTVAR_RE);
	if(result) {
		config.opensbp.setVariable(identifier, value, callback)
		return
	}
	log.debug(identifier + ' is not a persistent variable');

	throw new Error("Cannot assign to " + identifier);

}

SBPRuntime.prototype._eval_value = function(expr) {
	switch(this._variableType(expr)) {
		case 'user':
			return this.evaluateUserVariable(expr);
		break;
		case 'system':
			return this.evaluateSystemVariable(expr);
		break;
		case 'persistent':
			return this.evaluatePersistentVariable(expr);
		break;
		default:
			var n = Number(expr);
			return isNaN(n) ? expr : n;
		break;
	}
};

// Evaluate an expression.  Return the result.
// TODO: Make this robust to undefined user variables
SBPRuntime.prototype._eval = function(expr) {
//	log.debug("Evaluating expression: " + JSON.stringify(expr));
	if(expr === undefined) {return undefined;}

	if(expr.op === undefined) {
		return this._eval_value(String(expr));
	} else {
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

SBPRuntime.prototype.init = function() {
	this.pc = 0;
	this.coordinateSystem = "G55"
	this.start_of_the_chunk = 0;
	this.stack = [];
	this.label_index = {};
	this.current_chunk = [];
	this.started = false;
	this.sysvar_evaluated = false;
	this.end_callback = null;
	this.output = [];				// Used in simulation mode only
	this.end_callback = null;
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
SBPRuntime.prototype.setPreferredUnits = function(units, callback) {
	log.info("SBP runtime is setting the preferred units to " + units)
	this._loadConfig();
	this._setUnits(units);
	this._saveConfig(callback);
}

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
		if(line) {
			switch(line.type) {
				case "label":
					if (line.value in this.label_index) {
						throw "Duplicate label.";
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

SBPRuntime.prototype.evaluateSystemVariable = function(v) {
	if(v === undefined) { return undefined;}
	result = v.match(SYSVAR_RE);
	if(result === null) {return undefined;}
	n = parseInt(result[1]);
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
			return config.driver.get('g54x');
		break;

		case 7: // Y Table Base
			return config.driver.get('g54y');
		break;

		case 8: // Z Table Base
			return config.driver.get('g54z');
		break;

		case 9: // A Table Base
			return config.driver.get('g54a');
		break;

		case 10: // B Table Base
			return config.driver.get('g54b');
		break;

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
			throw new Error("Unknown System Variable: " + v)
		break;
	}
};

SBPRuntime.prototype._isVariable = function(v) {
	return 	this._isUserVariable(v) ||
			this._isPersistentVariable(v) ||
			this._isSystemVariable(v);
}


SBPRuntime.prototype._isSystemVariable = function(v) {
	return v.match(SYSVAR_RE);
}

SBPRuntime.prototype._isUserVariable = function(v) {
	return v.match(USERVAR_RE);
}

SBPRuntime.prototype._isPersistentVariable = function(v) {
	return v.match(PERSISTENTVAR_RE);
}

SBPRuntime.prototype._variableType = function(v) {
	if(this._isUserVariable(v)) {return 'user';}
	if(this._isSystemVariable(v)) {return 'system';}
	if(this._isPersistentVariable(v)) {return 'persistent';}
}

SBPRuntime.prototype.evaluateUserVariable = function(v) {
	if(v === undefined) { return undefined;}
	result = v.match(USERVAR_RE);
	if(result === null) {return undefined;}
	if(v in this.user_vars) {
		return this.user_vars[v];
	} else {
		throw new Error('Variable ' + v + ' was used but not defined.');
	}
};

SBPRuntime.prototype.evaluatePersistentVariable = function(v) {
	if(v === undefined) { return undefined;}
	result = v.match(PERSISTENTVAR_RE);
	if(result === null) {return undefined;}
	return config.opensbp.getVariable(v);
};

// Called for any valid shopbot mnemonic that doesn't have a handler registered
SBPRuntime.prototype._unhandledCommand = function(command) {
	log.warn('Unhandled Command: ' + JSON.stringify(command));
};

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
	frame.end_callback = this.end_callback
	frame.end_message = this.end_message
	frame.label_index = this.label_index
	this.file_stack.push(frame)
}

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
	this.end_callback = frame.end_callback
	this.end_message = frame.end_message
}

SBPRuntime.prototype.emit_gcode = function(s) {
	log.debug("emit_gcode: " + s);
	if(this.file_stack.length > 0) {
		var n = this.file_stack[0].pc;
	} else {
		var n = this.pc;
	}
	//this.current_chunk.push('N' + n + ' ' + s);
	var gcode = 'N' + n + ' ' + s + '\n'

	this.gcodesPending = true;
    log.debug('Writing to stream: ' + gcode)
	this.stream.write(gcode);
};

SBPRuntime.prototype.emit_move = function(code, pt) {
	var gcode = code;
	var i;
  	log.debug("Emit_move: " + code + " " + JSON.stringify(pt));

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

//log.debug("   emit_move: this.cmd_posx = " + this.cmd_posx );

	// Where to save the start point of an arc that isn't transformed??????????
	var tPt = this.transformation(pt);

	// log.debug("Emit_move: Transformed point: " + JSON.stringify(tPt));

//	log.debug("interpolate = " + this.transforms.interpolate.apply );
//	if(( this.transforms.level.apply === true || this.transforms.interpolate.apply === true ) && code !== "G0" ){
//		if( code === "G1"){
//		    log.debug( "emit_move: lineInterpolate = " + code + "  pt = " + JSON.stringify(pt));
//			interp.lineInterpolate(this, pt);
//		}
//		else if(code === "G2" || code === "G3"){
//		    log.debug( "emit_move: circleInterpolate = " + code + "  pt = " + JSON.stringify(pt));
//			interp.circleInterpolate(this, code, pt);
//		}
//	}
//	else{

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
        log.debug("emit_move: N" + n + JSON.stringify(gcode));
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
		log.debug("emit_move:level");
	}
	else {
		opFunction(tPt);
	}

};

SBPRuntime.prototype._setupTransforms = function() {
	log.debug("_setupTransforms");
    this.transforms = JSON.parse(JSON.stringify(config.opensbp.get('transforms')));
};

SBPRuntime.prototype.transformation = function(TranPt){
	if (this.transforms.rotate.apply !== false){
        log.debug("transformation = " + JSON.stringify(TranPt));
 		// log.debug("rotation apply = " + this.transforms.rotate.apply);
//		log.debug("Rotate: " + JSON.stringify(this.transforms.rotate));
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

SBPRuntime.prototype.pause = function() {
    if(this.machine.driver.status.stat == this.machine.driver.STAT_END ||
       this.machine.driver.status.stat == this.machine.driver.STAT_STOP) {
        this.pendingFeedhold = true;
    } else {
	    this.machine.driver.feedHold();
    }
}

SBPRuntime.prototype.quit = function() {
	if(this.ok_to_disconnect) {
		return this._end();
	}

	if(this.machine.status.state == 'stopped' || this.machine.status.state == 'paused') {
		this.machine.driver.quit();
	} else {
		this.quit_pending = true;
		this.driver.quit();
	}
}

SBPRuntime.prototype.resume = function() {
		if(this.paused) {
			this.paused = false;
			this._executeNext();
		} else {
			this.driver.resume();
		}
}

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
