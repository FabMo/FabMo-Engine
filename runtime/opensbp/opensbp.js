var parser = require('./parser');
var fs = require('fs');
var log = require('../../log').logger('sbp');
var g2 = require('../../g2');
var sb3_commands = require('./sb3_commands');
var config = require('../../config');

var SYSVAR_RE = /\%\(([0-9]+)\)/i ;
var USERVAR_RE = /\&([a-zA-Z_]+[A-Za-z0-9_]*)/i ;

function SBPRuntime() {
	this.program = [];
	this.pc = 0;
	this.start_of_the_chunk = 0;
	this.user_vars = {};
	this.label_index = {};
	this.stack = [];
	this.current_chunk = [];
	this.running = false;
	this.cmd_posx = 0;
	this.cmd_posy = 0;
	this.cmd_posz = 0;
	this.cmd_posa = 0;
	this.cmd_posb = 0;
	this.cmd_posc = 0; 
}

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

SBPRuntime.prototype._onG2Status = function(status) {
	// Update our copy of the system status
	for (var key in this.machine.status) {
		if(key in status) {
			if(key==='line'){
				this.machine.status.line=this.start_of_the_chunk + status.line; 
			}
			else{
				this.machine.status[key] = status[key];
			}
		}
	}
};

// Run the provided string as a program
SBPRuntime.prototype.runString = function(s) {
	try {
		var lines =  s.split('\n');
		this.machine.status.nb_lines = lines.length - 1;
		this.program = parser.parse(s);
		lines = this.program.length;
		this.machine.status.nb_lines = lines.length - 1;
		this._analyzeLabels();  // Build a table of labels
		this._analyzeGOTOs();   // Check all the GOTO/GOSUBs against the label table    
		this._run();
	} catch(err) {
		log.error(err);
	}
};

// Update the internal state of the runtime with data from the tool
SBPRuntime.prototype._update = function() {
	status = this.machine.status || {};
	this.posx = status.posx || 0.0;
	this.posy = status.posy || 0.0;
	this.posz = status.posz || 0.0;
	this.posa = status.posa || 0.0;
	this.posb = status.posb || 0.0;
	this.posc = status.posc || 0.0;
};

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
	this.machine.setState(this, "running");
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
				this._execute(line, this._continue.bind(this));
				break;
			} else {
				log.debug('Current chunk is nonempty: breaking to run stuff on G2.');
				break;
			}
		} else {
			this._execute(line);
		}
	}
};

SBPRuntime.prototype._end = function() {
	this.machine.status.filename = null;
	this.machine.status.current_file = null;
	this.machine.status.nb_lines=null;
	this.machine.status.line=null;
	this.init();
};
// Pack up the current chunk and send it to G2
// Returns true if there was data to send to G2
// Returns false if nothing was sent
SBPRuntime.prototype._dispatch = function(callback) {
	var runtime = this;

	if(this.current_chunk.length > 0) {
		log.info("dispatching a chunk: " + this.current_chunk);

		var run_function = function(driver) {
			log.debug("Expected a running state change and got one.");
			driver.expectStateChange({
				"stop" : function(driver) { 
					callback();
				},
				null : function(driver) {
					log.warn("Expected a stop but didn't get one.");
				}
			});
		};

		this.driver.expectStateChange({
			"running" : run_function,
			"homing" : run_function,
			"probe" : run_function,
			null : function(t) {
				log.warn("Expected a start but didn't get one. (" + t + ")"); 
			}
		});

		this.driver.runSegment(this.current_chunk.join('\n'));
		this.current_chunk = [];
		return true;
	} else {
		return false;
	}
};

SBPRuntime.prototype._executeCommand = function(command, callback) {
	if((command.cmd in this) && (typeof this[command.cmd] == 'function')) {

		args = this._evaluateArguments(command.cmd, command.args);
		f = this[command.cmd].bind(this);

		log.debug("Calling handler for " + command.cmd + " With arguments: [" + args + "]");

		if(f.length > 1) {
			// This is a stack breaker, run with a callback
			f(args, function() {this.pc+=1; callback();}.bind(this));
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

SBPRuntime.prototype._execute = function(command, callback) {

	log.info("Executing line: " + JSON.stringify(command));

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

		case "return":
			if(this.stack) {
				this.pc = this.stack.pop();
			} else {
				throw "Runtime Error: Return with no GOSUB at " + this.pc;
			}
			return false;
			break;

		case "end":
			this.pc = this.program.length;
			return false;
			break;

		case "goto":
			if(command.label in this.label_index) {
				this.pc = this.label_index[command.label];
				log.debug("Hit a GOTO: Going to line " + this.pc + "(Label: " + command.label + ")");
				return false;
			} else {
				throw "Runtime Error: Unknown Label '" + command.label + "' at line " + this.pc;
			}
			break;

		case "gosub":
			if(command.label in this.label_index) {
				this.pc = this.label_index[command.label];
				this.stack.push([this.pc + 1]);
				return false;
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

		case "label":
		case "comment":
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

		default:
			log.error("Unknown command: " + JSON.stringify(command));
			this.pc += 1;
			return false;
			break;
	}
	throw "Shouldn't ever get here.";
};


SBPRuntime.prototype._eval_value = function(expr) {
		log.debug("  Evaluating value: " + expr);
		sys_var = this.evaluateSystemVariable(expr);
		if(sys_var === undefined) {
			user_var = this.evaluateUserVariable(expr);
			if(user_var === undefined) {
				log.debug("  Evaluated " + expr + " as " + expr);
				return parseFloat(expr);
			} else if(user_var === null) {
				log.error("  Undefined variable " + expr)
				// ERROR UNDEFINED VARIABLE
			} else {
				log.debug("  Evaluated " + expr + " as " + user_var);
				return parseFloat(user_var);
			}
		} else if(sys_var === null) {
			log.error("  Undefined system variable " + expr)
			// ERROR UNKNOWN SYSTEM VARIABLE
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
	this.break_chunk = false;
	this.current_chunk = [];
	this.started = false;
	this.sysvar_evaluated = false;
	this.chunk_broken_for_eval = false;
	this.machine.setState(this, 'idle');
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

// Add GCode to the current chunk, which is dispatched on a break or end of program
SBPRuntime.prototype.emit_gcode = function(s) {
	this.current_chunk.push(s);
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

exports.SBPRuntime = SBPRuntime;


