var parser = require('./parser');
var fs = require('fs');
var log = require('../../log').logger('sbp');
var g2 = require('../../g2');
var sb3_commands = require('./sb3_commands');
var config = require('../../config');
var events = require('events');
var tform = require('./transformation');
var macros = require('../../macros');

var SYSVAR_RE = /\%\(([0-9]+)\)/i ;
var USERVAR_RE = /\&([a-zA-Z_]+[A-Za-z0-9_]*)/i ;

function SBPRuntime() {
	// Handle Inheritance
	events.EventEmitter.call(this);
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
	this.running = false;
	this.quit_pending = false;
	this.cmd_posx = 0;
	this.cmd_posy = 0;
	this.cmd_posz = 0;
	this.cmd_posa = 0;
	this.cmd_posb = 0;
	this.cmd_posc = 0;
	this.raw_posx = 0; 
	this.raw_posy = 0; 
	this.raw_posz = 0; 
	this.raw_posa = 0; 
	this.raw_posb = 0; 
	this.raw_posc = 0; 
}
util.inherits(SBPRuntime, events.EventEmitter);

SBPRuntime.prototype.connect = function(machine) {
	this.machine = machine;
	this.driver = machine.driver;
	this.machine.status.line=null;
	this.machine.status.nb_lines=null;
	this._update();
	this.status_handler = this._onG2Status.bind(this);
	this.driver.on('status', this.status_handler);
	log.info('Connected ShopBot runtime.');
};

SBPRuntime.prototype.disconnect = function() {
	log.info('Disconnected ShopBot runtime.');
	this.driver.removeListener(this.status_handler);
};

// Run the provided string as a program
SBPRuntime.prototype.runString = function(s, callback) {
	try {
		var lines =  s.split('\n');
		if(this.machine) {
			this.machine.status.nb_lines = lines.length - 1;
		}
		this.program = parser.parse(s);
		lines = this.program.length;
		if(this.machine) {
			this.machine.status.nb_lines = lines.length - 1;
		}
		this.init();
		this.end_callback = callback;
		this._setupTransforms();
		this._analyzeLabels();  // Build a table of labels
		this._analyzeGOTOs();   // Check all the GOTO/GOSUBs against the label table
		this._run();
	} catch(err) {
		setImmediate(callback, err);
	}
};

SBPRuntime.prototype.runFile = function(filename, callback) {
	fs.readFile(filename, 'utf8', function(err, data) {
		if(err) {
			callback(err);
		} else {
			this.runString(data, callback);
		}
	}.bind(this));
};

SBPRuntime.prototype.pause = function() {
	this.machine.driver.feedHold();
}

SBPRuntime.prototype.quit = function() {
	this.quit_pending = true;
	this.machine.driver.quit();
}

SBPRuntime.prototype._onG2Status = function(status) {
	// Update our copy of the system status
	for (var key in this.machine.status) {
		if(key in status) {
			this.machine.status[key] = status[key];
		}
	}
};

// Update the internal state of the runtime with data from the tool
SBPRuntime.prototype._update = function() {
	if(this.machine) {
		status = this.machine.status || {};
	} else {
		status = {}
	}
	this.posx = status.posx || 0.0;
	this.posy = status.posy || 0.0;
	this.posz = status.posz || 0.0;
	this.posa = status.posa || 0.0;
	this.posb = status.posb || 0.0;
	this.posc = status.posc || 0.0;
};

SBPRuntime.prototype._setupTransforms = function() {
	this.transforms = JSON.parse(JSON.stringify(config.opensbp.get('transforms')));
}

// Evaluate a list of arguments provided (for commands)
SBPRuntime.prototype._evaluateArguments = function(command, args) {
	log.debug("Evaluating arguments: " + command + "," + JSON.stringify(args));
	// Scrub the argument list:  extend to the correct length, sub in defaults where necessary.
	scrubbed_args = [];
	if(command in sb3_commands) {
		params = sb3_commands[command].params || [];
		if(args.length > params.length) {
			log.warn('MORE parameters passed into ' + command + ' than are supported by the command.');
		}
		for(i=0; i<params.length; i++) {
			prm_param = params[i];
			user_param = args[i];
			if((args[i] !== undefined) && (args[i] !== "")) {
				log.debug('Taking the users argument: ' + args[i]);
				scrubbed_args.push(args[i]);
			} else {
				//log.debug("Taking the default argument: " + args[i] + " (PRN file)");
				//scrubbed_args.push(prm_param.default || undefined);
				log.debug('No user specified argument.  Using undefined.');
				scrubbed_args.push(undefined);
			}
		}
	} else {
		scrubbed_args = [];
	}
	log.debug("Scrubbed arguments: " + JSON.stringify(scrubbed_args));
	
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
			result =  false;
			break;

		case "cond":
			result = false;
			//return this._exprBreaksStack(cmd.cmp);
			break;

		case "assign":
			result = false;
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

SBPRuntime.prototype._exprBreaksStack = function(expr) {
	if(expr.op === undefined) {
		return expr[0] == '%'; // For now, all system variable evaluations are stack-breaking
	} else {
		return this._exprBreaksStack(expr.left) || this._exprBreaksStack(expr.right);
	}
};

// Start the stored program running
SBPRuntime.prototype._run = function() {
	log.info("Setting the running state");
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
			log.info("Program over. (pc = " + this.pc + ")");
			// We may yet have g-codes that are pending.  Run those.
			if(this.current_chunk.length > 0) {
				return this._dispatch(this._continue.bind(this));
			} else {
				return this._end();
			}
		}

		// Pull the current line of the program from the list
		line = this.program[this.pc];
		if(this._breaksStack(line)) {
			log.debug("STACK BREAK: " + JSON.stringify(line));
			dispatched = this._dispatch(this._continue.bind(this));
			if(!dispatched) {
				log.debug('Nothing to execute in the queue: continuing.');
				if(!this.machine) {
					log.warn('Attempting to execute a stack-breaking command without G2, which may cause issues.')
					try {
						this._execute(line, this._continue.bind(this));
					} catch(e) {
						log.error('There was a problem: ' + e);
						setImmediate(this._continue().bind(this));
					}
				} else {
					this._execute(line, this._continue.bind(this));
				}
				break;
			} else {
				log.debug('Current chunk is nonempty: breaking to run stuff on G2.');
				break;
			}
			return;
		} else {
			this._execute(line);
		}
	}
};

SBPRuntime.prototype._end = function() {
	if(this.machine) {
		var end_function_no_nesting = function() {
				// We are truly done
				callback = this.end_callback;
				this.machine.status.filename = null;
				this.machine.status.current_file = null;
				this.machine.status.nb_lines=null;
				this.machine.status.line=null;
				this.init();
				if(this.machine.status.job) {
					this.machine.status.job.finish(function(err, job) {
						this.machine.status.job=null;
						this.machine.setState(this, 'idle');
					}.bind(this));
				} else {
					this.machine.setState(this, 'idle');
				}
				this.emit('end', this);
				if(callback) {
					callback();
				}
		}.bind(this);

		var end_function_nested = function() {
			callback = this.end_callback;
			if(callback) {
				callback();
			}
		}.bind(this);

		var end_function = ((this.file_stack.length > 0) && !this.quit_pending) ? end_function_nested : end_function_no_nesting;

		if(end_function === end_function_nested) {
			log.debug("Doing the nested end.")
		} else {
			log.debug("Doing the outermost end.")
		}

		if(this.driver.status.stat !== this.driver.STAT_END) {
			this.driver.expectStateChange( {
				'end':end_function,
				'stop':null
			});
			this.driver.runSegment('M30\n');
		} else {
			end_function();
		}
	} else {
		this.init();
		this.emit('end', this.output);
	}
};

// Pack up the current chunk and send it to G2
// Returns true if there was data to send to G2
// Returns false if nothing was sent
SBPRuntime.prototype._dispatch = function(callback) {
	var runtime = this;

	// If there's g-codes to be dispatched to the tool
	if(this.current_chunk.length > 0) {

		// And we have are connected to a real tool
		if(this.machine) {

			// Dispatch the g-codes and look for the tool to start running them
			log.info("dispatching a chunk: " + this.current_chunk);

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
						this._end();
					}.bind(this),
					"holding" : function(driver) {
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
							});
						}
					}.bind(this),
					"running" : null,
					null : function(driver) {
						// TODO: This is probably a failure
						log.warn("Expected a stop or hold but didn't get one.");
					}
				});
			}.bind(this);

			this.driver.expectStateChange({
				"running" : run_function,
				"stop" : function(driver) { callback() },
				null : function(t) {
					log.warn("Expected a start but didn't get one. (" + t + ")"); 
				}
			});

			this.driver.runSegment(this.current_chunk.join('\n') + '\n');
			this.current_chunk = [];
			return true;
		} else {
			log.info("Dispatching a chunk (no driver)");
			Array.prototype.push.apply(this.output, this.current_chunk);
			this.current_chunk = []
			setTimeout(callback, 100)
			return true;
		}
	} else {
		return false;
	}
};

// To be called when a hold is encountered spontaneously (to handle ON INPUT events)
SBPRuntime.prototype._processEvents = function(callback) {

	var event_handled = false;
	// Iterate over all inputs for which handlers are registered
	for(var sw in this.event_handlers) {
		var input_name = 'in' + sw
		var input_state = this.machine.status[input_name]
		log.debug("Checking event handlers for " + input_name)
		// Iterate over all the states of this input for which handlers are registered
		for(var state in this.event_handlers[sw]) {
			log.debug("Checking state " + state)
			log.debug("Against " + input_state)
			if(input_state === 1) {

				event_handled = true;

				// Save the current PC, which is encoded as the current G-Code line as reported by G2
				this.pc = parseInt(this.driver.status.line)

				// Extract the command that is to be executed as a result of the event
				var cmd = this.event_handlers[sw][state]
				if(cmd) {
					this.driver.queueFlush(function(err) {
							if(this._breaksStack(cmd)) {
								this._execute(this.event_handlers[sw][state], function() {
									callback();
								}.bind(this));
							} else {
								this._execute(this.event_handlers[sw][state]);
								callback();
							}
					}.bind(this));
				} else {
					log.error("Handler registered, but with no command??  (Bad Error)");
					callback();
				}
			} else {
				
			}
		}
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
			f(args);
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

		// A ShopBot Comand (M2, ZZ, C3, etc...)
		case "cmd":
			return this._executeCommand(command, callback);
			break;

		// A C# command (custom cut)
		case "custom":
			macro = macros.get(command.index)
			if(macro) {
				log.debug("Running macro: " + JSON.stringify(macro))
				this._pushFileStack();
				this.runFile(macro, function() {
					this._popFileStack();
					callback();
				}.bind(this));
			} else {
				log.warn("Can't run macro #" + command.index + ": Macro not found.");
				callback();
			}
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
			return false;
			break;

		case "goto":
			if(command.label in this.label_index) {
				this.pc = this.label_index[command.label];
				log.debug("Hit a GOTO: Going to line " + this.pc + "(Label: " + command.label + ")");
				setImmediate(callback);
				return true;
			} else {
				throw "Runtime Error: Unknown Label '" + command.label + "' at line " + this.pc;
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
			//TODO FIX THIS THIS DOESN'T DO SYSTEM VARS PROPERLY
			value = this._eval(command.expr);
			this.user_vars[command.var] = value;
			this.pc += 1;
			return false;
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
			}
			// Todo handle indefinite pause or pause with message
			return false;
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
	throw "Shouldn't ever get here.";
};

SBPRuntime.prototype._setupEvent = function(command, callback) {
	var sw = command.sw;
	var mo = 'di'+ sw + 'mo';
	var ac = 'di' + sw + 'ac';
	var fn = 'di' + sw + 'fn';
	args = [mo,ac,fn]
	this.driver.get(args, function(err, vals) {
		var setup = {}
		setup[mo] = command.state;
		setup[ac] = 2 
		setup[fn] =  0
		this.driver.setMany(setup, function(err, data) {
			if(command.sw in this.event_handlers) {
				this.event_handlers[command.sw][command.state] = command.stmt;
			} else {
				handler = {}
				handler[1] = command.stmt
				this.event_handlers[command.sw] = handler;
			}
			callback();
		}.bind(this));
	}.bind(this));
}

SBPRuntime.prototype._eval_value = function(expr) {
		log.debug("  Evaluating value: " + expr);
		sys_var = this.evaluateSystemVariable(expr);
		if(sys_var === undefined) {
			user_var = this.evaluateUserVariable(expr);
			if(user_var === undefined) {
				log.debug("  Evaluated " + expr + " as " + expr);
				f = parseFloat(expr);
			    if(isNaN(f)) {
                    return expr;
                } else {
                    return f;
                }
            } else if(user_var === null) {
			} else {
				log.debug("  Evaluated " + expr + " as " + user_var);
				return parseFloat(user_var);
			}
		} else if(sys_var === null) {
			log.error("  Undefined system variable " + expr)
		} else {
			log.debug("  Evaluated " + expr + " as " + sys_var);
			this.sysvar_evaluated = true;
			return parseFloat(sys_var);
		}	
};

// Evaluate an expression.  Return the result.
// TODO: Make this robust to undefined user variables
SBPRuntime.prototype._eval = function(expr) {
	log.debug("Evaluating expression: " + JSON.stringify(expr));
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
						// No break: fall through to next state
					case "goto":
					case "gosub":
						if (line.label in this.label_index) {
							
						} else {
							// Add one to the line number so they start at 1
							throw "Undefined label " + line.label + " on line " + (i+1);
						}
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

		case 144:
			return this.machine.status.posc;
		break;

		default:
			return null;
		break;
	}
};

SBPRuntime.prototype.evaluateUserVariable = function(v) {
	if(v === undefined) { return undefined;}
	result = v.match(USERVAR_RE);
	if(result === null) {return undefined;}
	if(v in this.user_vars) {
		return this.user_vars[v];
	} else {
		return null;
	}
};

// Called for any valid shopbot mnemonic that doesn't have a handler registered
SBPRuntime.prototype._unhandledCommand = function(command) {
	log.warn('Unhandled Command: ' + JSON.stringify(command));
};

SBPRuntime.prototype._pushFileStack = function() {
	frame =  {}
	frame.pc = this.pc+1
	frame.program = this.program
	frame.user_vars = this.user_vars
	frame.current_chunk = this.current_chunk
	frame.end_callback = this.end_callback
	this.file_stack.push(frame)
}

SBPRuntime.prototype._popFileStack = function() {
	frame = this.file_stack.pop()
	this.pc = frame.pc
	this.program = frame.program
	this.user_vars = frame.user_vars
	this.current_chunk = frame.current_chunk
	this.end_callback = frame.end_callback
}

// Add GCode to the current chunk, which is dispatched on a break or end of program
SBPRuntime.prototype.emit_gcode = function(s) {
	this.current_chunk.push('N' + this.pc + ' ' + s);
};

SBPRuntime.prototype.emit_move = function(code, pt) {
	pt = this.transformation(pt);
	gcode = code
	for(key in pt) {
		var v = pt[key]
		if(isNaN(v)) { throw( "Invalid " + key + " argument: " + v ); } 
		if(v !== undefined) {
			gcode += (key + v.toFixed(5))
		}
	}
	this.current_chunk.push('N' + this.pc + gcode);
};

// This must be called at least once before instantiating an SBPRuntime object
SBPRuntime.prototype.loadCommands = function(callback) {
	commands=require('./commands').load();
	proto = Object.getPrototypeOf(this);
	for(var attr in commands) {
		proto[attr] = commands[attr];
	}
	callback(null, this)
}

SBPRuntime.prototype.transformation = function(TranPt){
	var gres = 5;

	if (this.transforms.rotate.apply !== false){
		log.debug("Rotate: " + JSON.stringify(this.transforms.rotate));
//		TranPt = tform.rotate(TranPt, 45, 0, 0);
	}
	if (this.transforms.shearx.apply !== false){
		log.debug("ShearX: " + JSON.stringify(this.transforms.shearx));
	}
	if (this.transforms.sheary.apply !== false){
		log.debug("ShearY: " + JSON.stringify(this.transforms.sheary));
	}
	if (this.transforms.scale.apply !== false){
		log.debug("Scale: " + JSON.stringify(this.transforms.scale));
	}
	if (this.transforms.move.apply !== false){
		log.debug("Move: " + JSON.stringify(this.transforms.move));
	}

	return TranPt;

};

exports.SBPRuntime = SBPRuntime;


