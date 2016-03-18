var parser = require('./parser');
var fs = require('fs');
var log = require('../../log').logger('sbp');
var g2 = require('../../g2');
var sb3_commands = require('./sb3_commands');
var config = require('../../config');
var events = require('events');
var tform = require('./transformation');
var macros = require('../../macros');
var interp = require('./interpolate');
var Leveler = require('./commands/leveler').Leveler;

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
	this.ok_to_disconnect = true;
	this.program = [];
	this.pc = 0;
	this.start_of_the_chunk = 0;
	this.user_vars = {};
	this.label_index = {};
	this.stack = [];
	this.file_stack = [];
	this.current_chunk = [];
	this.output = [];
	this.event_handlers = {};
	this.event_teardown = {};
	this.running = false;
	this.quit_pending = false;
	this.cmd_result = 0;
	this.cmd_posx = undefined;
	this.cmd_posy = undefined;
	this.cmd_posz = undefined;
	this.cmd_posa = undefined;
	this.cmd_posb = undefined;
	this.cmd_posc = undefined;
	this.movespeed_xy = 0;
	this.movespeed_z = 0;
	this.movespeed_a = 0;
	this.movespeed_b = 0;
	this.movespeed_c = 0;
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

	// Physical machine state
	this.machine = null;
	this.driver = null;

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
	this.status_handler = this._onG2Status.bind(this);
	this.driver.on('status', this.status_handler);
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
		this.driver.removeListener('status', this.status_handler);
		this.machine = null;	
		this.driver = null;
		log.info('Disconnected OpenSBP runtime.');
	} else {
		throw new Error("Cannot disconnect OpenSBP runtime.")
	}
};

SBPRuntime.prototype.executeCode = function(s, callback) {
	this.runString(s, callback);
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
		// get speed settings from opensbp.json to be used in files
		var SBP_2get = ['movexy_speed',
					    'movez_speed',
					    'movea_speed',
					    'moveb_speed',
				    	'movec_speed' ];
	    var getSBP_speed = config.opensbp.getMany(SBP_2get);
	    var G2_2get = ['xvm','yvm','zvm','avm','bvm','cvm',
	                   'xjm','yjm','zjm','ajm','bjm','cjm' ];
        var getG2_settings = config.driver.getMany(G2_2get);
		this.movespeed_xy = getSBP_speed.movexy_speed;
		this.movespeed_z = getSBP_speed.movez_speed;
		this.movespeed_a = getSBP_speed.movea_speed;
		this.movespeed_b = getSBP_speed.moveb_speed;
		this.movespeed_c = getSBP_speed.movec_speed;
		this.jogspeed_xy = getG2_settings.xvm;
		this.jogspeed_z = getG2_settings.zvm;
		this.jogspeed_a = getG2_settings.avm;
		this.jogspeed_b = getG2_settings.bvm;
		this.jogspeed_c = getG2_settings.cvm;
        this.maxjerk_xy = getG2_settings.xjm;
        this.maxjerk_z = getG2_settings.zjm;
        this.maxjerk_a = getG2_settings.ajm;
        this.maxjerk_b = getG2_settings.bjm;
        this.maxjerk_c = getG2_settings.cjm;
		log.debug("Transforms configured...")
		this._analyzeLabels();  // Build a table of labels
		log.debug("Labels analyzed...")
		this._analyzeGOTOs();   // Check all the GOTO/GOSUBs against the label table
		log.debug("GOTOs analyzed...")
		this.emit_gcode(config.driver.get('gdi') ? 'G91' : 'G90');
		log.debug("Rainbows organized...")
		this._run();
		log.debug("Returning from run...");
	} catch(e) {
		log.error(e);
		return this._end(e.message + " (Line " + e.line + ")");
	}
};

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
		this.runString(s, function(err, data) {
			this.machine = saved_machine;
			callback(err, data);
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
		this._end(msg);
		return true;
	}
	return false;
}

// Handler for G2 statue reports
SBPRuntime.prototype._onG2Status = function(status) {
	
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
	switch(cmd.type) {
		// Commands (MX, VA, C3, etc) break the stack only if they must ask the tool for data
		// TODO: Commands that have sysvar evaluation in them also break stack
		case "cmd":
			var name = cmd.cmd;
			if((name in this) && (typeof this[name] == 'function')) {
				f = this[name];
				//log.warn(name)
				//log.warn(f)
				//log.warn(JSON.stringify(this))
				//log.warn(f.length)
				if(f && f.length > 1) {
					return true;
				}
			}
			result = false;
			break;

		// For now, pause translates to "dwell" which is just a G-Code
		case "pause":
			if(cmd.expr) {
				result = false;
			} else {
				result =  true;				
			}
			break;

		case "cond":
			return true;
			//TODO , we should check the expression for a stack break, as well as the .stmt
			//return _breaksStack(cmd.stmt);
			break;

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
	if(expr.op === undefined) {
		return expr[0] == '%'; // For now, all system variable evaluations are stack-breaking
	} else {
		return this._exprBreaksStack(expr.left) || this._exprBreaksStack(expr.right);
	}
};

// Start the stored program running
SBPRuntime.prototype._run = function() {
	log.info("Starting OpenSBP program")
	this.started = true;
	if(this.machine) {
		this.machine.setState(this, "running");
	}
	this._continue();
};

// Continue running the current program (until the end of the next chunk)
// _continue() will dispatch the next chunk if appropriate, once the current chunk is finished
SBPRuntime.prototype._continue = function() {
	this._update();

	// Continue is only for resuming an already running program.  It's not a substitute for _run()
	if(!this.started) {
		log.warn('Got a _continue() but not started');
		return;
	}

	// Do forever:  Will break out in the event that the program ends
	while(true) {
		// If we've run off the end of the program, we're done!
		if(this.pc >= this.program.length) {
			log.info("End of program reached. (pc = " + this.pc + ")");
			// We may yet have g-codes that are pending.  Run those.
			if(this.current_chunk.length > 0) {
				log.info("Dispatching final g-codes")
				return this._dispatch(this._continue.bind(this));
			} else {
				log.info("No g-codes remain to dispatch.")
				return this._end(this.end_message);
			}
		}

		if(this.quit_pending) {
			return this._end();
		}

		// Pull the current line of the program from the list
		line = this.program[this.pc];
		if(this._breaksStack(line)) {
			// If it's a stack breaker go ahead and distpatch the current g-code list to the tool
			log.debug("Stack break: " + JSON.stringify(line));
			dispatched = this._dispatch(this._continue.bind(this));

			// If we dispatched anything
			if(!dispatched) {
				log.debug('Nothing to execute in the queue: continuing.');
				if(!this.machine) {
					log.warn('Attempting to execute a stack-breaking command without G2, which may cause issues.')
					try {
						this._execute(line, this._continue.bind(this));
					} catch(e) {
						log.error('There was a problem: ' + e);
						setImmediate(this._continue.bind(this));
					}
				} else {
					try {
						log.debug("executing + " + JSON.stringify(line))
						this._execute(line, this._continue.bind(this));
					} catch(e) {
						return this._end(e.message);
					}
				}
				break;
			} else {

				if(this.machine) {
					log.debug('Dispatched g-codes to tool.')
					break;
				} else {
					setImmediate(this._continue.bind(this));
				}
			}
			return;
		} else {
				log.debug("Non-Stack break: " + JSON.stringify(line));

			try {
				this._execute(line);
			} catch(e) {
				return this._end(e);
			}
		}
	}
};

SBPRuntime.prototype._end = function(error) {
	error = error ? error.message || error : null;
	if(this.machine) {
		var end_function_no_nesting = function() {
				log.debug("Calling the non-nested (toplevel) end");
				// We are truly done
				callback = this.end_callback;
				this.init();
				//this.user_vars = {};
				if(error) {
					this.machine.setState(this, 'stopped', {'error' : error });
					this.emit('end', this);
					if(callback) {
						callback();
					}
				} else {

					if(this.machine.status.job) {
						this.machine.status.job.finish(function(err, job) {
							this.machine.status.job=null;
							this.driver.setUnits(config.machine.get('units'), function() {
								this.machine.setState(this, 'idle');
							}.bind(this));
						}.bind(this));
					} else {
						this.driver.setUnits(config.machine.get('units'), function() {
							this.machine.setState(this, 'idle');
						}.bind(this));
					}
					this.ok_to_disconnect = true;
					this.emit('end', this);
					if(callback) {
						callback();
					}
			
				}
		}.bind(this);

		var end_function_nested = function() {
			log.debug("Calling the nested end.");
			callback = this.end_callback;
			if(callback) {
				callback();
			}
		}.bind(this);

		if((this.file_stack.length > 0) && !this.quit_pending && !error) {
			log.debug("Doing the nested end.")
			end_function = end_function_nested;
		}
		else {
			log.debug("Doing the outermost end.")
			end_function = end_function_no_nesting;
		}

		switch(this.driver.status.stat) {
			case this.driver.STAT_END:
			case this.driver.STAT_STOP:
				end_function();
			break;

			default:
				this.driver.expectStateChange( {
					'end':end_function,
					'stop':end_function
				});
				if(end_function === end_function_no_nesting) {
					this.driver.runSegment('M30\n');
				} else {
					this.driver.requestStatusReport();
				}
			break;
		}

	} else {
		var callback = this.end_callback;
		var gcode = this.output;
		this.init();
		this.emit('end', this.output);
		if(callback) {
			if(error) {
				callback(error, null);
			} else {
				callback(null, gcode.join('\n'));
			}
		}
	}
};

// Pack up the current chunk (if it is nonempty) and send it to G2
// Returns true if there was data to send to G2, false otherwise.
SBPRuntime.prototype._dispatch = function(callback) {
	var runtime = this;

	// If there's g-codes to be dispatched to the tool
	if(this.current_chunk.length > 0) {

		// And we have are connected to a real tool
		if(this.machine) {
			// Dispatch the g-codes and look for the tool to start running them
			//log.info("dispatching a chunk: " + this.current_chunk);

			var hold_function = function(driver) {
				log.info("Expected hold and got one.")
				// On hold, handle event that caused the hold
				var event_handled = this._processEvents(callback);

				// If no event claims the hold, we actually enter the paused state
				// (And expect a resume or a stop)
				if(!event_handled) {
					this.machine.setState(this, "paused");
					driver.expectStateChange({
						"running" : function(driver) {
								this.machine.setState(this, "running");
							run_function(driver);
						}.bind(this),
						"end" : function(driver) {
							this._end();
						}.bind(this),
						"stop" : function(driver) {
							callback();
						},
						null : function(driver) {
							// TODO: This is probably a failure
							log.warn("Expected a stop or hold (from the paused state) but didn't get one.");
						}
					});
				}
			}.bind(this);

			var run_function = function(driver) {
				log.debug("Expected a running state change and got one.");
				
				// Once running, anticipate the stop so we can execute the next leg of the file
				driver.expectStateChange({
					"stop" : function(driver) {
						// On stop, keep going
						callback();
					},
					"alarm" : function(driver) { 
						// On alarm terminate the program (for now)
						if(this._limit()) {return;}
						this._end();
					}.bind(this),
					"end" : function(driver) { 
						// On end terminate the program (for now)
						this._end();
					}.bind(this),
					
					"holding" : hold_function,

					"running" : null,
					null : function(driver) {
						// TODO: This is probably a failure
						log.warn("Expected a stop or hold (from the run state) but didn't get one.");
					}
				});
			}.bind(this);

			var stopped_function = function(driver) {

				this.driver.expectStateChange({
					"running" : run_function,
					"stop" : function(driver) { callback(); },
					"end" : function(driver) { callback(); },
					"holding" : hold_function,
					null : function(t) {
						log.warn("Expected a start but didn't get one. (" + t + ")"); 
					},
					"timeout" : function(driver) {
						log.warn("State change timeout??")
						this._continue();
					}.bind(this)
				});

			}.bind(this);

			stopped_function(this.driver);
			var segment = this.current_chunk.join('\n') + '\n';
			this.driver.runSegment(segment);
			this.current_chunk = [];
			return true;
		} else { // Not connected to a real tool
			Array.prototype.push.apply(this.output, this.current_chunk);
			this.current_chunk = []
			setImmediate(callback)
			return true;
		}
	} else {
		log.debug("Empty dispatch")
		return false;
	}
};

// To be called when a hold is encountered spontaneously (to handle ON INPUT events)
SBPRuntime.prototype._processEvents = function(callback) {

	var event_handled = false;
	// Iterate over all inputs for which handlers are registered
	for(var sw in this.event_handlers) {
		var input_name = 'in' + sw
		var input_state = this.driver.status[input_name]
		log.debug("Checking event handlers for " + input_name)
		// Iterate over all the states of this input for which handlers are registered
		for(var state in this.event_handlers[sw]) {
			log.debug("Checking state " + state + " against " + input_state)
			if(input_state === 1) {

				event_handled = true;
	
				// Save the current PC, which is encoded as the current G-Code line as reported by G2
				this.pc = parseInt(this.driver.status.line)

				// Extract the command that is to be executed as a result of the event
				var cmd = this.event_handlers[sw][state]
				var teardown = this.event_teardown[sw] || {}
				if(cmd) {
					this.driver.queueFlush(function(err) {
						log.debug("Tearing down the input configuration that caused the event.")
						this.driver.setMany(teardown, function(err, result) {
							
							if(this._breaksStack(cmd)) {
								this._execute(cmd, function() {
									callback();
								}.bind(this));
							} else {
								this._execute(cmd);
								callback();
							}
						}.bind(this));
					}.bind(this));
				} else {
					log.error("Handler registered, but with no command??  (Bad Error)");
					callback();
				}
			} else {
				
			}
		}
	}
	if(event_handled) {
		delete this.event_handlers[sw];	
	}
		return event_handled;
	}

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
				log.error("There was a problem executing a stack-breaking command: " + e)
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
				//this._end(e);
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

SBPRuntime.prototype.runCustomCut = function(number, callback) {
	var macro = macros.get(number);
	if(macro) {
		log.debug("Running macro: " + JSON.stringify(macro))
		this._pushFileStack();
		this.runFile(macro.filename, function() {
			this._popFileStack();
			callback();
		}.bind(this));
	} else {
		this._end("Can't run custom cut (macro) C" + number + ": Macro not found.");
		callback();
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

	// log.debug("Executing: " + JSON.stringify(command));
	// All correctly parsed commands have a type
	switch(command.type) {

		// A ShopBot Comand (M2, ZZ, C3, etc...)
		case "cmd":
			return this._executeCommand(command, callback);
			break;

		// A C# command (custom cut)
		case "custom":
			return this.runCustomCut(command.index, function() {
				this.pc += 1;
				callback();
			}.bind(this));
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
				throw "Runtime Error: Unknown Label '" + command.label + "' at line " + this.pc;
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
			//TODO FIX THIS THIS DOESN'T DO SYSTEM VARS PROPERLY
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
				return false;
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
			if(command.expr) {
				this.emit_gcode('G4 P' + this._eval(command.expr));
				return false;
			} else {
				this.paused = true;
				this.continue_callback = callback;
				var message = command.message;
				if(!message) {
					var last_command = this.program[this.pc-2];
					if(last_command && last_command.type === 'comment') {
						message = last_command.comment.join('').trim();
					}
				}
				this.machine.setState(this, 'paused', {'message' : message || "Paused." });
				return true;
			}
			break;

		case "event":
			this.pc += 1;
			this._setupEvent(command, callback);
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

SBPRuntime.prototype._setupEvent = function(command, callback) {
	var sw = command.sw;
	var mo = 'di'+ sw + 'mo';
	var ac = 'di' + sw + 'ac';
	var fn = 'di' + sw + 'fn';
	args = [mo,ac,fn]
	this.driver.get(args, function(err, vals) {
		var setup = {}
		var teardown = {}
		teardown[mo] = vals[0];
		teardown[ac] = vals[1];
		teardown[fn] = vals[2];
		setup[mo] = command.state ? vals[0] : (vals[0] ? 0 : 1); 
		setup[ac] = 2 
		setup[fn] =  0
		this.driver.setMany(setup, function(err, data) {
			if(command.sw in this.event_handlers) {
				this.event_handlers[command.sw][command.state] = command.stmt;
			} else {
				handler = {}
				handler[1] = command.stmt
				this.event_handlers[command.sw] = handler;
				this.event_teardown[command.sw] = teardown;
			}
			callback();
		}.bind(this));
	}.bind(this));
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
	this.start_of_the_chunk = 0;
	this.stack = [];
	this.label_index = {};
	this.current_chunk = [];
	this.started = false;
	this.sysvar_evaluated = false;
	this.end_callback = null;
	this.output = [];				// Used in simulation mode only
	this.event_handlers = {};		// For ON INPUT etc..
	this.end_callback = null;
	this.quit_pending = false;
	this.end_message = null;
	this.paused = false;

	if(this.transforms != null && this.transforms.level.apply === true) {
		leveler = new Leveler(this.transforms.level.ptDataFile);
	}
};

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
	frame.pc = this.pc
	frame.program = this.program
	frame.stack = this.stack;
	//frame.user_vars = this.user_vars
	frame.current_chunk = this.current_chunk
	frame.end_callback = this.end_callback
	frame.label_index = this.label_index
	this.file_stack.push(frame)
}

SBPRuntime.prototype._popFileStack = function() {
	frame = this.file_stack.pop()
	this.pc = frame.pc
	this.program = frame.program
	this.stack = frame.stack
	//this.user_vars = frame.user_vars
	this.label_index = frame.label_index;
	this.current_chunk = frame.current_chunk
	this.end_callback = frame.end_callback
}

// Add GCode to the current chunk, which is dispatched on a break or end of program
SBPRuntime.prototype.emit_gcode = function(s) {
	log.debug("emit_gcode = " + s);
	if(this.file_stack.length > 0) {
		var n = this.file_stack[0].pc;
	} else {
		var n = this.pc;
	}
	this.current_chunk.push('N' + n + ' ' + s);
};

SBPRuntime.prototype.emit_move = function(code, pt) {
	var gcode = code;
	var i;
    log.debug("Emit_move: " + code + " " + JSON.stringify(pt));

	['X','Y','Z','A','B','C','I','J','K','F'].forEach(function(key){
		var c = pt[key];
		if(c !== undefined) {
			if(isNaN(c)) { throw( "Invalid " + key + " argument: " + c ); } 
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
				if(isNaN(v)) { throw( "Invalid " + key + " argument: " + v ); } 
				gcode += (key + v.toFixed(5));
			}
		}.bind(this));
		// }
        log.debug("emit_move: N" + n + JSON.stringify(gcode));
        this.current_chunk.push('N' + n + ' ' + gcode);
	}.bind(this);

	if(this.transforms.level.apply === true  && code !== "G0") {
		var previousHeight = leveler.foundHeight;
		var X = (tPt.X === undefined) ? this.cmd_posx : tPt.X;
		var Y = (tPt.Y === undefined) ? this.cmd_posy : tPt.Y;
		var Z = 0;
		// cmd_posz stores the last Z position. But when using the leveler,
		// the stored Z is the real Z of the bit, not the wanted Z relative
		// to the board. Therefore, we delete the previousely found height
		// when using cmd_posz but not when using pt.Z
		if(tPt.Z === undefined) {
		    Z = this.cmd_posz - previousHeight;
		} else {
		    Z =  tPt.Z;
		}
		var height = leveler.findHeight(X, Y, Z);
		if(height === false) {
			log.error("Impossible to find the point height with the leveler.");
			return;
		}
		tPt.Z = Z + height;
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
            TranPt = tform.rotate(TranPt,angle,PtRotX,PtRotY, this.cmd_StartX,this.cmd_StartY);
        }
	}
	if (this.transforms.shearx.apply !== false){
		log.debug("ShearX: " + JSON.stringify(this.transforms.shearx));
		TranPt = tform.shearX(TranPt);
	}
	if (this.transforms.sheary.apply !== false){
		log.debug("ShearY: " + JSON.stringify(this.transforms.sheary));
		TranPt = tform.shearY(TranPt);
	}
	if (this.transforms.scale.apply !== false){
		log.debug("Scale: " + JSON.stringify(this.transforms.scale));
		var ScaleX = this.transforms.scale.scalex;
		var ScaleY = this.transforms.scale.scaley;
		var PtX = this.transforms.scale.x;
		var PtY = this.transforms.scale.y;

		TranPt = tform.scale(TranPt,ScaleX,ScaleY,PtX,PtY);
	}
	if (this.transforms.move.apply !== false){
		log.debug("Move: " + JSON.stringify(this.transforms.move));
		TranPt = tform.translate(TranPt, 
								 this.transforms.move.x, 
								 this.transforms.move.y, 
								 this.transforms.move.z );
	}

	return TranPt;

};

SBPRuntime.prototype.pause = function() {
	this.machine.driver.feedHold();
}

SBPRuntime.prototype.quit = function() {
	if(this.machine.status.state == 'stopped' || this.paused) {
		if(this.machine.status.job) {
			this.machine.status.job.fail(function(err, job) {
				this.machine.status.job=null;
				this.driver.setUnits(config.machine.get('units'), function() {
					this.machine.setState(this, 'idle');
				}.bind(this));
			}.bind(this));
		} else {
			this.driver.setUnits(config.machine.get('units'), function() {
				this.machine.setState(this, 'idle');
			}.bind(this));
		}
	} else {
		this.quit_pending = true;
		this.machine.driver.quit();		
	}
}

SBPRuntime.prototype.resume = function() {
	if(this.paused) {
		this.machine.setState(this, 'running');
		this.paused = false;
		this.continue_callback();
	} else {
		this.driver.resume();		
	}
}

exports.SBPRuntime = SBPRuntime;


