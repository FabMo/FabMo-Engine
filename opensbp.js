var parser = require('./sbp_parser');
var fs = require('fs');
var log = require('./log').logger('sbp');
var g2 = require('./g2');
var sbp_settings = require('./sbp_settings');
var sb3_commands = require('./data/sb3_commands');

var SYSVAR_RE = /\%\(([0-9]+)\)/i ;
var USERVAR_RE = /\&([a-zA-Z_]+[A-Za-z0-9_]*)/i ;

var chunk_breakers = {'VA':true, 'VS':true, 'JS':true, 'VS':true, 'ZX':true, 'ZY':true, 'ZZ':true}

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
}

SBPRuntime.prototype.disconnect = function() {
	log.info('Disconnected ShopBot runtime.');
	this.driver.removeListener(this.status_handler);
}

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
}

// Run the provided string as a program
SBPRuntime.prototype.runString = function(s) {
	try {
		var lines =  s.split('\n');
		this.machine.status.nb_lines = lines.length - 1;
		this.program = parser.parse(s + '\n');
		var lines = this.program.length
		this.machine.status.nb_lines = lines.length - 1;
		this._analyzeLabels();  // Build a table of labels
		this._analyzeGOTOs();   // Check all the GOTO/GOSUBs against the label table    
		this._run();
	} catch(err) {
		log.error(err);
	}
}

// Update the internal state of the runtime with data from the tool
SBPRuntime.prototype._update = function() {
	status = this.machine.status || {};
	this.posx = status.posx || 0.0;
	this.posy = status.posy || 0.0;
	this.posz = status.posz || 0.0;
	this.posa = status.posa || 0.0;
	this.posb = status.posb || 0.0;
	this.posc = status.posc || 0.0;
}

// Evaluate a list of arguments provided (for commands)
SBPRuntime.prototype._evaluateArguments = function(command, args) {
	log.debug("Evaluating arguments: " + command + "," + JSON.stringify(args));

	// Scrub the argument list:  extend to the correct length, sub in defaults where necessary.
	scrubbed_args = [];
	if(command in sb3_commands) {
		params = sb3_commands[command].params || []
		for(i=0; i<params.length; i++) {
			prm_param = params[i];
			user_param = args[i];
			log.debug("!!!: " + args[i]);
			if((args[i] !== undefined) && (args[i] !== "")) {
				log.debug("Taking the users argument: " + args[i]);
				scrubbed_args.push(args[i])
			} else {
				log.debug("Taking the default argument: " + args[i]);
				scrubbed_args.push(prm_param.default || undefined);
			}
		}
	} else {
		scrubbed_args = []
	}
	log.debug("Scrubbed arguments: " + JSON.stringify(scrubbed_args));
	
	// Create the list of evaluated arguments to be returned
	retval = [];
	for(i=0; i<scrubbed_args.length; i++) {
		retval.push(this._eval(scrubbed_args[i]));
	}
	return retval;
}

// Start the stored program running
SBPRuntime.prototype._run = function() {
	log.info("Setting the running state");
	this.started = true;
	this.machine.setState(this, "running");
	this._continue();
}

// Continue running the current program (until the end of the next chunk)
// _continue() will dispatch the next chunk if appropriate, once the current chunk is finished
SBPRuntime.prototype._continue = function() {
	this._update();

	log.debug('Running until break...')

	// Continue is only for resuming an already running program.  It's not a substitute for _run()
	if(!this.started) {
		log.warn('Got a _continue() but not started');
		return;
	}

	// If we've run off the end of the program, we're done!
	if(this.pc >= this.program.length) {
		log.info("Program over. (pc = " + this.pc + ")")
		// We may yet have g-codes that are pending.  Run those.
		if(this.current_chunk.length > 0) {
			this._dispatch();
		} else {
			this.machine.status.filename = null;
			this.machine.status.current_file = null;
			this.machine.status.nb_lines=null;
			this.machine.status.line=null;
			this.init();
			return;
		}
	}

	// Pull the current line of the program from the list
	line = this.program[this.pc];

	// Execute it.  The _execute function will either call continue or dispatch to advance the program
	this._execute(line, this._continue.bind(this), this._dispatch.bind(this));

	if(this.break_chunk) {
		this._dispatch();
		this.start_of_the_chunk = this.pc;
	} 
}

// Pack up the current chunk and send it to G2
// Setup callbacks so that when the chunk is done, the program can be resumed
SBPRuntime.prototype._dispatch = function() {
	var runtime = this;
	this.break_chunk = false;
	if(this.current_chunk.length > 0) {
		log.info("dispatching a chunk: " + this.current_chunk)

		var run_function = function(driver) {
			log.debug("Expected a running state change and got one.");
			driver.expectStateChange({
				"stop" : function(driver) { 
					runtime._continue();
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

		// add gcode line number to the chunk
		for (i=0;i<this.current_chunk.length;i++){
			if (this.current_chunk[i][0]!==undefined ){
				this.current_chunk[i]= 'N'+ (i+1) + this.current_chunk[i];
			}
		}
		this.driver.runSegment(this.current_chunk.join('\n'));
		this.current_chunk = [];
	} else {
		runtime._continue();
	}
}

SBPRuntime.prototype._executeCommand = function(cmd, args, callback) {
	f = this[cmd].bind(this);
	log.debug("Command: " + cmd + " Function: " + f);
	if(f.length > 1) {
		f(args, function() {this.pc+=1; callback()}.bind(this));
	} else {
		log.debug("Calling handler for " + cmd + " With arguments: [" + args + "]");
		f(args);
		log.debug("Called.")
		this.pc +=1;
		callback();
	}
}

// Execute a single statement
// Accepts a parsed statement
// Callbacks take no arguments.
// continue_callback is called if execution can continue with the next line in the program
// deferred_callback is called if execution must be deferred (code sent to g2 or other asynchronous process)
SBPRuntime.prototype._execute = function(command, continue_callback, deferred_callback) {
	this.break_chunk = false;
	log.info("Executing line: " + JSON.stringify(command));
	if(!command) {
		this.pc += 1;
		return;
	}
	switch(command.type) {

		// A ShopBot Comand (M2, ZZ, C3, etc...)
		case "cmd":
			if((command.cmd in this) && (typeof this[command.cmd] == 'function')) {
				this.sysvar_evaluated = false;
				args = this._evaluateArguments(command.cmd, command.args);
				if(this.chunk_broken_for_eval) {
					log.debug("Resuming after a chunk was broken for sysvar evaluation.");
					this.chunk_broken_for_eval = false;
					return this._executeCommand(command.cmd, args, continue_callback);
				}
				else {
					if(this.sysvar_evaluated || (command.cmd in chunk_breakers)) {
						log.debug("Breaking a chunk at line " + this.pc + " to evaluate system variables.");
						this.chunk_broken_for_eval = true;
						return deferred_callback(); // Don't advance pc when execution is deferred
					}
					else {
						log.debug("Running command normally: " + command.cmd + ' ' + args);
						return this._executeCommand(command.cmd, args, continue_callback);
					}
				}
			} else {
				this.pc += 1;
				this._unhandledCommand(command)
			}
			break;

		case "return":
			this.break_chunk = true;
			if(this.stack) {
				this.pc = this.stack.pop();
			} else {
				throw "Runtime Error: Return with no GOSUB at " + this.pc;
			}
			return deferred_callback();
			break;

		case "end":
			this.pc = this.program.length;
			return deferred_callback();
			break;

		case "goto":
			if(command.label in this.label_index) {
				this.pc = this.label_index[command.label];
				log.debug("Hit a GOTO: Going to line " + this.pc + "(Label: " + command.label + ")")
				return deferred_callback();
			} else {
				throw "Runtime Error: Unknown Label '" + command.label + "' at line " + this.pc;
			}
			break;

		case "gosub":
			if(command.label in this.label_index) {
				this.pc = this.label_index[command.label];
				this.stack.push([this.pc + 1])
				return deferred_callback();
			} else {
				throw "Runtime Error: Unknown Label '" + command.label + "' at line " + this.pc;
			}
			break;

		case "assign":
			this.sysvar_evaluated = false
			value = this._eval(command.expr);

			if(this.chunk_broken_for_eval) {
				log.debug('Resuming after breaking a chunk to evaluate system variables.');
				log.debug('Assigning the user value ' + command.var + ' the value ' + value);
				this.chunk_broken_for_eval = false;
				this.user_vars[command.var] = value;
			}
			else {
				if(this.sysvar_evaluated) {
					log.debug("Breaking a chunk at line " + this.pc + " to evaluate system variables for an assignment.");
					this.chunk_broken_for_eval = true;
					return deferred_callback();
				}
				else {
					log.debug('Assigning the user value ' + command.var + ' the value ' + value);
					this.user_vars[command.var] = value;
				}
			}
			this.pc += 1;
			break;

		case "cond":
			// TODO - look at continue versus deferred, this may not work for edge cases.
			if(this._eval(command.cmp)) {
				return this._execute(command.stmt, continue_callback, deferred_callback);
			} else {
				this.pc += 1;
			}
			return deferred_callback();
			break;

		case "label":
		case "comment":
		case undefined:
			this.pc += 1;
			break;

		case "pause":
			this.pc += 1;
			return deferred_callback();
			break;

		default:
			log.error("Unknown command: " + JSON.stringify(command));
			this.pc += 1;
			break;
	}
	return continue_callback();
}


SBPRuntime.prototype._eval_value = function(expr) {
		log.debug("Evaluating value: " + expr)
		sys_var = this.evaluateSystemVariable(expr);
		if(sys_var === undefined) {
			user_var = this.evaluateUserVariable(expr);
			if(user_var === undefined) {
				log.debug("Evaluated " + expr + " as " + expr);
				return parseFloat(expr);
			} else if(user_var === null) {
				// ERROR UNDEFINED VARIABLE
			} else {
				log.debug("Evaluated " + expr + " as " + user_var);
				return parseFloat(user_var);
			}
		} else if(sys_var === null) {
			// ERROR UNKNOWN SYSTEM VARIABLE
		} else {

			log.debug("Evaluated " + expr + " as " + sys_var)
			this.sysvar_evaluated = true;
			return parseFloat(sys_var);
		}	
}

// Evaluate an expression.  Return the result.
// TODO: Make this robust to undefined user variables
SBPRuntime.prototype._eval = function(expr) {
	log.debug("Evaluating expression: " + JSON.stringify(expr))
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
				return this._eval(expr.left) == this._eval(expr.right);
				break;
			case '!=':
				return this._eval(expr.left) != this._eval(expr.right);
				break;

			default:
				throw "Unhandled operation: " + expr.op;
		}
	}
}

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
}



// Check all the GOTOS/GOSUBS in the program and make sure their labels exist
// Throw an error for undefined labels.
SBPRuntime.prototype._analyzeGOTOs = function() {
	for(i=0; i<this.program.length; i++) {
			line = this.program[i];
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
}

SBPRuntime.prototype.evaluateSystemVariable = function(v) {
	if(v === undefined) { return undefined;}
	result = v.match(SYSVAR_RE);
	if(result === null) {return undefined};
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
			return sbp_settings.movexy_speed;
		break;

		case 72: // XY Move Speed
			return sbp_settings.movexy_speed;
		break;

		case 73:
			return sbp_settings.movez_speed;
		break;

		case 74:
			return sbp_settings.movea_speed;
		break;

		case 75:
			return sbp_settings.moveb_speed;
		break;

		case 76:
			return sbp_settings.movec_speed;
		break;

		case 144:
		    return this.machine.status.posc;
		break;

		default:
			return null;
		break;
	}
}

SBPRuntime.prototype.evaluateUserVariable = function(v) {

	if(v === undefined) { return undefined;}
	result = v.match(USERVAR_RE);
	if(result == null) {return undefined};
	if(v in this.user_vars) {
		return this.user_vars[v];
	} else {
		return null;
	}
}

// Called for any valid shopbot mnemonic that doesn't have a handler registered
SBPRuntime.prototype._unhandledCommand = function(command) {
	log.error('Unhandled Command: ' + JSON.stringify(command));
}

// Add GCode to the current chunk, which is dispatched on a break or end of program
SBPRuntime.prototype.emit_gcode = function(s) {
	this.current_chunk.push(s);
}

/* FILE */

SBPRuntime.prototype.FP = function(args) {
	//?????????????????????????????????????????????
}

SBPRuntime.prototype.FE = function(args) {
	//?????????????????????????????????????????????
}

SBPRuntime.prototype.FN = function(args) {
	//?????????????????????????????????????????????
}

SBPRuntime.prototype.FG = function(args) {
	//?????????????????????????????????????????????
}

SBPRuntime.prototype.FC = function(args) {
	//?????????????????????????????????????????????
}

SBPRuntime.prototype.FS = function(args) {
	//?????????????????????????????????????????????
}

/* MOVE */

SBPRuntime.prototype.MX = function(args) {
	this.emit_gcode("G1 X" + args[0] + " F" + sbp_settings.movexy_speed);
	this.cmd_posx = args[0];
}

SBPRuntime.prototype.MY = function(args) {
	this.emit_gcode("G1Y" + args[0] + " F" + sbp_settings.movexy_speed);
	this.cmd_posy = args[0];
}

SBPRuntime.prototype.MZ = function(args) {
	this.emit_gcode("G1Z" + args[0] + " F" + sbp_settings.movez_speed);
	this.cmd_posz = args[0];
}

SBPRuntime.prototype.MA = function(args) {
	this.emit_gcode("G1A" + args[0] + " F" + sbp_settings.movea_speed);
	this.cmd_posa = args[0];
}

SBPRuntime.prototype.MB = function(args) {
	this.emit_gcode("G1B" + args[0] + " F" + sbp_settings.moveb_speed);
	this.cmd_posb = args[0];
}

SBPRuntime.prototype.MC = function(args) {
	this.emit_gcode("G1C" + args[0] + " F" + sbp_settings.movec_speed);
	this.cmd_posc = args[0];
}

SBPRuntime.prototype.M2 = function(args) {
	var outStr = "G1"
	if (args[0] != undefined) {
		outStr = outStr + "X" + args[0];
		this.cmd_posx = args[0];
	}
	if (args[1] != undefined) {
		outStr = outStr + "Y" + args[1];
		this.cmd_posy = args[1];
	}
	outStr = outStr + "F" + sbp_settings.movexy_speed; 
	this.emit_gcode(outStr);
}

SBPRuntime.prototype.M3 = function(args) {
	var outStr = "G1"
	if (args[0] != undefined) {
		outStr = outStr + "X" + args[0];
		this.cmd_posx = args[0];
	}
	if (args[1] != undefined) {
		outStr = outStr + "Y" + args[1];
		this.cmd_posy = args[1];
	}
	if (args[2] != undefined) {
		outStr = outStr + "Z" + args[2];
		this.cmd_posz = args[2];
	}
	outStr = outStr + "F" + sbp_settings.movexy_speed; 
	this.emit_gcode(outStr);
}

SBPRuntime.prototype.M4 = function(args) {
	var outStr = "G1"
	if (args[0] != undefined) {
		outStr = outStr + "X" + args[0];
		this.cmd_posx = args[0];
	}
	if (args[1] != undefined) {
		outStr = outStr + "Y" + args[1];
		this.cmd_posy = args[1];
	}
	if (args[2] != undefined) {
		outStr = outStr + "Z" + args[2];
		this.cmd_posz = args[2];
	}
	if (args[3] != undefined) {
		outStr = outStr + "A" + args[3];
		this.cmd_posa = args[3];
	}
	outStr = outStr + "F" + sbp_settings.movexy_speed; 
	this.emit_gcode(outStr);
}

SBPRuntime.prototype.M5 = function(args) {
	var outStr = "G1"
	if (args[0] != undefined) {
		outStr = outStr + "X" + args[0];
		this.cmd_posx = args[0];
	}
	if (args[1] != undefined) {
		outStr = outStr + "Y" + args[1];
		this.cmd_posy = args[1];
	}
	if (args[2] != undefined) {
		outStr = outStr + "Z" + args[2];
		this.cmd_posz = args[2];
	}
	if (args[3] != undefined) {
		outStr = outStr + "A" + args[3];
		this.cmd_posa = args[3];
	}
	if (args[4] != undefined) {
		outStr = outStr + "B" + args[4];
		this.cmd_posb = args[4];
	}
	outStr = outStr + "F" + sbp_settings.movexy_speed; 
	this.emit_gcode(outStr);
}

SBPRuntime.prototype.M6 = function(args) {
	var outStr = "G1"
	if (args[0] != undefined) {
		outStr = outStr + "X" + args[0];
		this.cmd_posx = args[0];
	}	
	if (args[1] != undefined) {
		outStr = outStr + "Y" + args[1];
		this.cmd_posy = args[1];
	}
	if (args[2] != undefined) {
		outStr = outStr + "Z" + args[2];
		this.cmd_posz = args[2];
	}
	if (args[3] != undefined) {
		outStr = outStr + "A" + args[3];
		this.cmd_posa = args[3];
	}
	if (args[4] != undefined) {
		outStr = outStr + "B" + args[4];
		this.cmd_posb = args[4];
	}
	if (args[5] != undefined) {
		outStr = outStr + "C" + args[5];
		this.cmd_posc = args[5];
	}
	outStr = outStr + "F" + sbp_settings.movexy_speed; 
	this.emit_gcode(outStr);
}

SBPRuntime.prototype.MH = function(args) {
	this.emit_gcode("G1X0Y0" + " F" + sbp_settings.movexy_speed);
	this.cmd_posx = 0;
	this.cmd_posy = 0;
}

SBPRuntime.prototype.MS = function(args) {
	if (args[0] != undefined) sbp_settings.movexy_speed = args[0];
	if (args[1] != undefined) sbp_settings.movez_speed = args[1];
	if (args[2] != undefined) sbp_settings.movea_speed = args[2];
	if (args[3] != undefined) sbp_settings.moveb_speed = args[3];
	if (args[4] != undefined) sbp_settings.movec_speed = args[4];
}

SBPRuntime.prototype.MI = function(args) {
	//?????????????????????????????????????????????
}

SBPRuntime.prototype.MO = function(args) {
	//?????????????????????????????????????????????
}


/* JOG */

SBPRuntime.prototype.JX = function(args) {
	this.emit_gcode("G0X" + args[0]);
	this.cmd_posx = args[0];
}

SBPRuntime.prototype.JY = function(args) {
	this.emit_gcode("G0Y" + args[0]);
	this.cmd_posy = args[0];
}

SBPRuntime.prototype.JZ = function(args) {
	this.emit_gcode("G0Z" + args[0]);
	this.cmd_posz = args[0];
}

SBPRuntime.prototype.JA = function(args) {
	this.emit_gcode("G0A" + args[0]);
	this.cmd_posa = args[0];
}

SBPRuntime.prototype.JB = function(args) {
	this.emit_gcode("G0B" + args[0]);
	this.cmd_posb = args[0];
}

SBPRuntime.prototype.JC = function(args) {
	this.emit_gcode("G0C" + args[0]);
	this.cmd_posc = args[0];
}

SBPRuntime.prototype.J2 = function(args) {
	var outStr = "G0"
	if (args[0] != undefined) {
		outStr = outStr + "X" + args[0];
		this.cmd_posx = args[0];
	}
	if (args[1] != undefined) {
		outStr = outStr + "Y" + args[1];
		this.cmd_posy = args[1];
	}
	this.emit_gcode(outStr);
}

SBPRuntime.prototype.J3 = function(args) {
	var outStr = "G0"
	if (args[0] != undefined) {
		outStr = outStr + "X" + args[0];
		this.cmd_posx = args[0];
	}
	if (args[1] != undefined) {
		outStr = outStr + "Y" + args[1];
		this.cmd_posy = args[1];
	}
	if (args[2] != undefined) {
		outStr = outStr + "Z" + args[2];
		this.cmd_posz = args[2];
	}
	this.emit_gcode(outStr);
}

SBPRuntime.prototype.J4 = function(args) {
	var outStr = "G0"
	if (args[0] != undefined) {
		outStr = outStr + "X" + args[0];
		this.cmd_posx = args[0];
	}
	if (args[1] != undefined) {
		outStr = outStr + "Y" + args[1];
		this.cmd_posy = args[1];
	}
	if (args[2] != undefined) {
		outStr = outStr + "Z" + args[2];
		this.cmd_posz = args[2];
	}
	if (args[3] != undefined) {
		outStr = outStr + "A" + args[3];
		this.cmd_posa = args[3];
	}
	this.emit_gcode(outStr);
}

SBPRuntime.prototype.J5 = function(args) {
	var outStr = "G0"
	if (args[0] != undefined) {
		outStr = outStr + "X" + args[0];
		this.cmd_posx = args[0];
	}
	if (args[1] != undefined) {
		outStr = outStr + "Y" + args[1];
		this.cmd_posy = args[1];
	}
	if (args[2] != undefined) {
		outStr = outStr + "Z" + args[2];
		this.cmd_posz = args[2];
	}
	if (args[3] != undefined) {
		outStr = outStr + "A" + args[3];
		this.cmd_posa = args[3];
	}
	if (args[4] != undefined) {
		outStr = outStr + "B" + args[4];
		this.cmd_posb = args[4];
	}
	this.emit_gcode(outStr);
}

SBPRuntime.prototype.J6 = function(args) {
	var outStr = "G0"
	if (args[0] != undefined) {
		outStr = outStr + "X" + args[0];
		this.cmd_posx = args[0];
	}
	if (args[1] != undefined) {
		outStr = outStr + "Y" + args[1];
		this.cmd_posy = args[1];
	}
	if (args[2] != undefined) {
		outStr = outStr + "Z" + args[2];
		this.cmd_posz = args[2];
	}
	if (args[3] != undefined) {
		outStr = outStr + "A" + args[3];
		this.cmd_posa = args[3];
	}
	if (args[4] != undefined) {
		outStr = outStr + "B" + args[4];
		this.cmd_posb = args[4];
	}
	if (args[5] != undefined) {
		outStr = outStr + "C" + args[5];
		this.cmd_posc = args[5];
	}
	this.emit_gcode(outStr);
}

SBPRuntime.prototype.JH = function(args) {
	this.cmd_posx = 0;
	this.cmd_posy = 0;
	this.emit_gcode("G0X0Y0");
}

SBPRuntime.prototype.JS = function(args) {
	if (args[0] != undefined) {
		sbp_settings.jogxy_speed = args[0];
		this.command({'xvm':sbp_settings.jogxy_speed});
		this.command({'yvm':sbp_settings.jogxy_speed});
	}
	if (args[1] != undefined) {
		sbp_settings.jogz_speed = args[1];
		this.command({'zvm':sbp_settings.jogz_speed});
	}
	if (args[2] != undefined) {
		sbp_settings.joga_speed = args[2];
		this.command({'avm':sbp_settings.joga_speed});
	}
	if (args[3] != undefined) {
		sbp_settings.jogb_speed = args[3];
		this.command({'bvm':sbp_settings.jogb_speed});
	}
	if (args[4] != undefined) {
		sbp_settings.jogc_speed = args[4];
		this.command({'cvm':sbp_settings.jogc_speed});
	}
}

/* CUTS */

SBPRuntime.prototype.CG = function(args) {
	sbp_settings.cutterDia = .25;
	sbp_settings.pocketOverlap  = 10;
	sbp_settings.safeZpullUp = .25;

    startX = this.cmd_posx;
    startY = this.cmd_posy;
    startZ = this.cmd_posz;
    endX = args[1] != undefined ? args[1] : undefined;
 //	if endX == undefined {}
    endY = args[2] != undefined ? args[2] : undefined;
 //	if endY == undefined {}
    centerX = args[3] != undefined ? args[3] : undefined;
 //	if centerX == undefined {}
    centerY = args[4] != undefined ? args[4] : undefined;
 //	if centerY == undefined {}
    var OIT = args[5] != undefined ? args[5] : "T";
    var Dir = args[6] != undefined ? args[6] : 1; 
    var Plg = args[7] != undefined ? args[7] : 0;
    var reps = args[8] != undefined ? args[8] : 1;
    var propX = args[9] != undefined ? args[9] : 1;
    var propY = args[10] != undefined ? [10] : 1;
    var optCG = args[11] != undefined ? args[11] : 0;
    var noPullUp = args[12] != undefined ? args[12] : 0;
    var plgFromZero = args[13] != undefined ? args[13] : 0;

    if (Plg != 0 && plgFromZero == 1){ var currentZ = 0; }
    else{ var currentZ = startZ; }
    var safeZCG = currentZ + sbp_settings.safeZpullUp;

    if ( optCG == 2 ) {    	
   		circRadius = Math.sqrt((centerX * centerX) + (centerY * centerY));
   		PocketAngle = Math.atan2(centerY, centerX);								// Find the angle of the step over between passes
   		stepOver = sbp_settings.cutterDia * ((100 - sbp_settings.pocketOverlap) / 100);	// Calculate the overlap
   		Pocket_StepX = stepOver * Math.cos(PocketAngle);						// Calculate the stepover in X based on the radius of the cutter * overlap
   		Pocket_StepY = stepOver * Math.sin(PocketAngle);						// Calculate the stepover in Y based on the radius of the cutter * overlap
    }

    if ( plgFromZero == 1 ) {										// If plunge depth is specified move to that depth * number of reps
    	this.emit_gcode( "G1Z" + currentZ + "F" + sbp_settings.movez_speed );
    }

    for (i=0; i<reps;i++){
    	if (Plg != 0 && optCG < 3 ) {										// If plunge depth is specified move to that depth * number of reps
    		currentZ += Plg;
    		this.emit_gcode( "G1Z" + currentZ + "F" + sbp_settings.movez_speed );
    	}
  
    	if (optCG == 2) { 															// Pocket circle from the outside inward to center
    		// Loop passes until overlapping the center
    		for (j=0; (Math.abs(Pocket_StepX * j) <= circRadius) && (Math.abs(Pocket_StepY * j) <= circRadius) ; j++){
    		   	if ( j > 0) {
    		   		this.emit_gcode( "G1X" + ((j * Pocket_StepX) + startX).toFixed(4) + 
    		   			               "Y" + ((j * Pocket_StepY) + startY).toFixed(4) + 
    		   			               "F" + sbp_settings.movexy_speed)
    		   	}
    		   	if (Dir == 1 ) { var outStr = "G2"; }	// Clockwise circle/arc
    			else { var outStr = "G3"; }	// CounterClockwise circle/arc
    			outStr = outStr + "X" + (startX + (j * Pocket_StepX)).toFixed(4) + 
    					 		  "Y" + (startY + (j * Pocket_StepY)).toFixed(4) +
    							  "I" + (centerX - (j*Pocket_StepX)).toFixed(4) +
    							  "J" + (centerY - (j*Pocket_StepY)).toFixed(4) +
    							  "F" + sbp_settings.movexy_speed;
    			this.emit_gcode( outStr );										
    		}
    		this.emit_gcode("G0Z" + safeZCG );										// Pull up Z
    	   	this.emit_gcode("G0X" + startX + "Y" + startY);							// Jog to the start point
    	} 
    	else {
    		if (Dir == 1 ) { var outStr = "G2X" + endX + "Y" + endY; }	// Clockwise circle/arc
    		else { var outStr = "G3X" + endX + "Y" + endY; }			// CounterClockwise circle/arc
			
			if (Plg != 0 && optCG == 3 ) { 
		    	outStr = outStr + "Z" + (currentZ + Plg); 
		    	currentZ += Plg;
			} // Add Z for spiral plunge

			outStr += "I" + centerX + "K" + centerY + "F" + sbp_settings.movexy_speed;	// Add Center offset
			this.emit_gcode(outStr); 
	    	
	    	if( i+1 < reps && ( endX != startX || endY != startY ) ){					//If an arc, pullup and jog back to the start position
    			this.emit_gcode( "G0Z" + safeZCG );
    		   	this.emit_gcode( "G0X" + startX + "Y" + startY );
			}
		}

    }

    if (optCG == 4 ) { // Add bottom circle if spiral with bottom clr is specified
        if( endX != startX || endY != startY ) {	//If an arc, pullup and jog back to the start position
    		this.emit_gcode( "G0Z" + safeZCG );
    	   	this.emit_gcode( "G0X" + startX + "Y" + startY);
    	   	this.emit_gcode( "G1Z" + currentZ + " F" + sbp_settings.movez_speed);		
    	}
    	if (Dir == 1 ){ var outStr = "G2"; } 		// Clockwise circle/arc
    	else { var outStr = "G3"; }					// CounterClockwise circle/arc
		outStr += "X" + endX + "Y" + endY + "I" + centerX + "K" + centerY + "F" + sbp_settings.movexy_speed;	// Add Center offset
		this.emit_gcode(outStr); 
    }

    if(noPullUp == 0 && currentZ != startZ){    	//If No pull-up is set to YES, pull up to the starting Z location
    	this.emit_gcode( "G0Z" + startZ);
    	this.cmd_posz = startZ;
    }
    else{				    						//If not, stay at the ending Z height
    	if ( optCG > 1 && optCG < 3) {
    		this.emit_gcode( "G1Z" + currentZ ); 
    	}
  		this.cmd_posz = currentZ;
    }

    this.cmd_posx = endX;
	this.cmd_posy = endY;
}

SBPRuntime.prototype.CR = function(args) {
	//calc and output commands to cut a rectangle
	var startX = this.cmd_posx;
    var startY = this.cmd_posy;
    var startZ = this.cmd_posz;
    var xDir = 1;
    var yDir = 1;
    var order = 1;

    var lenX = args[0] != undefined ? args[0] : undefined; 
    var lenY = args[1] != undefined ? args[1] : undefined;
    var OIT = args[2] != undefined ? args[2] : "T";
    var Dir = args[3] != undefined ? args[3] : 1; 
    var stCorn = args[4] != undefined ? args[4] : 4;			// Start Corner - default is 4, the bottom left corner
    var Plg = args[5] != undefined ? args[5] : 0;
    var reps = args[6] != undefined ? args[6] : 1;
    var optCG = args[7] != undefined ? args[7] : 0;				// Options - 1-Tab, 2-Pocket Outside-In, 3-Pocket Inside-Out
    if (optCR > 1) {
    	stepOver = sbp_settings.cutterDia * ((100 - sbp_settings.pocketOverlap) / 100);	// Calculate the overlap
    	Pocket_Step = stepOver * Math.cos(0.785398163);			// Calculate the stepover in X based on the radius of the cutter at 45 degrees
    }
    var plgFromZero = args[8] != undefined ? args[8] : 0;		// Start Plunge from Zero <0-NO, 1-YES>
    var RotationAngle = args[9] != undefined ? args[9] : 0;		// Angle to rotate rectangle around starting point
    var PlgAxis = args[10] != undefined ? args[10] : 'Z';
	var spiralPlg = args[11] != undefined ? args[11] : 0;
    
    if (RotationAngle != 0 ) { 
    	RotationAngle *= Math.PI / 180;							// Convert rotation angle in degrees to radians
    	cosRA = Math.cos(RotationAngle);						// Calculate the Cosine of the rotation angle
    	sinRA = Math.sin(RotationAngle);						// Calculate the Sine of the rotation angle
    	rotPtX = startX;										// Rotation point X
    	rotPtY = startY;										// Rotation point Y
    }
    
    if (Plg != 0 && plgFromZero == 1){ var currentZ = 0; }
    else{ var currentZ = startZ; }
    var safeZCG = currentZ + sbp_settings.safeZpullUp;

    if ( stCorn == 1 ) { 
    	yDir = -1;
    	if ( Dir == -1 ) { 
    		order = 2; 
    	}
    	if ( lenX < lenY ) {

    	}
    }
    else if ( stCorn == 2 ) {
    	xDir = -1;
    	yDir = -1;
    	if ( Dir == 1 ) { 
    		order = 2; 
    	}
    }
    else if ( stCorn == 3 ) { 
    	xDir = -1; 
    	if ( Dir == -1 ) {
    		order = 2;
    	}
    }
    else { 
    	if ( Dir == 1 ) {
    		order = 2;
    	}
    }

    if ( OIT == "O" ) { 
    	lenX = (lenX + sbp_settings.cutterDia) * xDir;
    	lenY = (lenY + sbp_settings.cutterDia) * yDir;
    }
    else if ( OIT == "I" ) {
    	lenX = (lenX - sbp_settings.cutterDia) * xDir;
    	lenY = (lenY - sbp_settings.cutterDia) * yDir;
    }

    for (i=0; i<reps;i++){
    	if ( Plg != 0 && spiralPlg != 1 ) {								// If plunge depth is specified move to that depth * number of reps
    		currentZ += Plg;
    		this.emit_gcode( "G1Z" + currentZ + "F" + sbp_settings.movez_speed );
    	}
    	if ( optCG == 2 ) { 															// Pocket Rectangle from the outside inward to center	
    		// Loop for number of passes
    			// Loop passes until overlapping the center
    			for (j=0; (Math.abs(Pocket_StepX * j) <= circRadius) && (Math.abs(Pocket_StepY * j) <= circRadius) ; j++){
    		    	


    		    	

    		}
    		if ( noPullUp == 1 ){    	//If No pull-up is set to YES, pull up to the starting Z location
    			this.emit_gcode("G1Z" + startZ);
				this.cmd_posz = startZ;
			}
    	} 
    	else {
    		cnt = 0;
    		if (order == 1 ) {		// Clockwise rectangle

    			do { 
    				if (RotationAngle == 0) { var outStr = "G1X" + (startX + lenX); }
    				else {
    					var outStr = "G1X" + (((startX + lenX) * cosRA) - (startY * sinRa) + (rotPtX * (1-cosRA)) + (rotPtY * sinRA)) +
    								   "Y" + (((startX + lenX) * sinRA) + (startY * cosRa) + (rotPtX * (1-cosRA)) - (rotPtY * sinRA)); 
    				}
    				if ( spiralPlg == 1 && cnt != 1 ) {
    					var PlgSp = currentZ + (Plg * 0.25); 
    					outStr += "Z" + PlgSp; }	
    				this.emit_gcode (outStr);

    		    	if ( RotationAngle == 0 ) { outStr = "G1Y" + (startY + lenY); }
    				else {
    					outStr = "G1X" + (((startX + lenX) * cosRA) - ((startY + lenY) * sinRa) + (rotPtX * (1-cosRA)) + (rotPtY * sinRA)) +
    								   "Y" + (((startX + lenX) * sinRA) + ((startY + lenY) * cosRa) + (rotPtX * (1-cosRA)) - (rotPtY * sinRA)); 
    				}
    				if ( spiralPlg == 1 && cnt != 1 ) { 
    					PlgSp = currentZ + (Plg * 0.5);	
    					outStr += "Z" + PlgSp; }
    				this.emit_gcode (outStr);
    				
    				if ( RotationAngle == 0 ) { outStr = "G1X" + startX; }
    				else {
    					outStr = "G1X" + ((startX * cosRA) - ((startY + lenY) * sinRa) + (rotPtX * (1-cosRA)) + (rotPtY * sinRA)) +
    								   "Y" + ((startX * sinRA) + ((startY + lenY) * cosRa) + (rotPtX * (1-cosRA)) - (rotPtY * sinRA)); 
    				}
    				if ( spiralPlg == 1 && cnt != 1 ) { 
    					PlgSp = currentZ + (Plg * 0.75);	
    					outStr += "Z" + PlgSp; 
    				}	
    				this.emit_gcode (outStr);
    				
    				if ( RotationAngle == 0 ) { outStr = "G1Y" + startY; }
    				else {
    					outStr = "G1X" + ((startX * cosRA) - (startY * sinRa) + (rotPtX * (1-cosRA)) + (rotPtY * sinRA)) +
    								   "Y" + ((startX * sinRA) + (startY * cosRa) + (rotPtX * (1-cosRA)) - (rotPtY * sinRA)); 
    				}
    				if ( spiralPlg == 1 && pass == 0 ) {
    					currentZ += Plg; 
    					outStr += "Z" + currentZ;
    					pass = 1; 
    				}
    				else { cnt = 1; }
    				this.emit_gcode (outStr);

    			} while ( cnt < 1 );
    		}	
    		else {
    			do {
    			    if ( RotationAngle == 0 ) { outStr = "G1X" + startX; }
    				else {
    					var outStr = "G1X" + ((startX * cosRA) - ((startY + lenY) * sinRa) + (rotPtX * (1-cosRA)) + (rotPtY * sinRA)) +
    								   "Y" + ((startX * sinRA) + ((startY + lenY) * cosRa) + (rotPtX * (1-cosRA)) - (rotPtY * sinRA)); 
    				}
    				if ( spiralPlg == 1 ) {
    						var PlgSp = currentZ + (Plg * 0.25); 
    						outStr += "Z" + PlgSp; }	
    					this.emit_gcode (outStr);
    				if ( RotationAngle == 0 ) { outStr = "G1Y" + (startY + lenY); }
    				else {
    					var outStr = "G1X" + (((startX + lenX) * cosRA) - ((startY + lenY) * sinRa) + (rotPtX * (1-cosRA)) + (rotPtY * sinRA)) +
    								   "Y" + (((startX + lenX) * sinRA) + ((startY + lenY) * cosRa) + (rotPtX * (1-cosRA)) - (rotPtY * sinRA)); 
    				}
    				if ( spiralPlg == 1 ) { 
    						PlgSp = currentZ + (Plg * 0.5);	
    						outStr += "Z" + PlgSp; }
    					this.emit_gcode (outStr);
    				if ( RotationAngle == 0 ) { var outStr = "G1X" + (startX + lenX); }
    				else {
    					var outStr = "G1X" + (((startX + lenX) * cosRA) - (startY * sinRa) + (rotPtX * (1-cosRA)) + (rotPtY * sinRA)) +
    								   "Y" + (((startX + lenX) * sinRA) + (startY * cosRa) + (rotPtX * (1-cosRA)) - (rotPtY * sinRA)); 
    				}
    				if ( spiralPlg == 1 ) { 
    						PlgSp = currentZ + (Plg * 0.75);	
    						outStr += "Z" + PlgSp; 
    				}	
    				this.emit_gcode (outStr);
    				if ( RotationAngle == 0 ) { outStr = "G1Y" + startY; }
    				else {
    					var outStr = "G1X" + ((startX * cosRA) - (startY * sinRa) + (rotPtX * (1-cosRA)) + (rotPtY * sinRA)) +
    								   "Y" + ((startX * sinRA) + (startY * cosRa) + (rotPtX * (1-cosRA)) - (rotPtY * sinRA)); 
    				}
    				if ( spiralPlg == 1 && pass == 0 ) {
    					currentZ += Plg; 
    					outStr += "Z" + currentZ;
    					pass == 1; 
    				}
    				else { cnt = 1; }
    				this.emit_gcode (outStr);
    			} while ( cnt < 1 );
    		}
		}

    	if( i+1 < reps && ( endX != startX || endY != startY ) ){					//If an arc, pullup and jog back to the start position
    		this.emit_gcode( "G0Z" + safe_Z );
    	   	this.emit_gcode( "G0X" + startX + "Y" + startY );
    	   	this.emit_gcode( "G1Z" + currentZ + " F" + sbp_settings.movez_speed );		

    		if (Dir == 1 ) { var outStr = "G2"; }	// Clockwise circle/arc
    	  	else if (Dir == -1) { var outStr = "G3"; }	// CounterClockwise circle/arc
			outStr = outStr + "X" + endX + "Y" + endY;	// Add End coordinates
			if (Plg != 0 && optCG == 3) { outStr = outStr + "Z" + (currentZ + Plg); }	// Add Z for spiral plunge 
			outStr = outStr + "I" + centerX + "K" + centerY + "F" + sbp_settings.movexy_speed;	// Add Center offset
			this.emit_gcode(outStr); 
		}
    }

    if(noPullUp == 0 && currentZ != startZ){    	//If No pull-up is set to YES, pull up to the starting Z location
    	this.emit_gcode( "G0Z" + startZ);
    	this.cmd_posz = startZ;
    }
    else{				    						//If not, stay at the ending Z height
  		this.cmd_posz = currentZ;
    }

    this.cmd_posx = endX;
	this.cmd_posy = endY;
}

/* ZERO */

SBPRuntime.prototype.ZX = function(args, callback) {
	this.machine.driver.get('mpox', function(err, value) {
		this.emit_gcode("G10 L2 P2 X" + value);
	 	this.cmd_posx = this.posx = 0;
		callback();
	}.bind(this));
}

SBPRuntime.prototype.ZY = function(args, callback) {
	this.machine.driver.get('mpoy', function(err, value) {
		this.emit_gcode("G10 L2 P2 Y" + value);
	 	this.cmd_posy = this.posy = 0;
		callback();
	}.bind(this));
}

SBPRuntime.prototype.ZZ = function(args, callback) {
	this.machine.driver.get('mpoz', function(err, value) {
		this.emit_gcode("G10 L2 P2 Z" + value);
	 	this.cmd_posz = this.posz = 0;
		callback();
	}.bind(this));
}

SBPRuntime.prototype.ZA = function(args, callback) {
	this.machine.driver.get('mpoa', function(err, value) {
		this.emit_gcode("G10 L2 P2 A" + value);
	 	this.cmd_posa = this.posa = 0;
		callback();
	}.bind(this));	
}

SBPRuntime.prototype.ZB = function(args, callback) {
	this.machine.driver.get('mpob', function(err, value) {
		this.emit_gcode("G10 L2 P2 B" + value);
	 	this.cmd_posb = this.posb = 0;
		callback();
	}.bind(this));	
}

SBPRuntime.prototype.ZC = function(args, callback) {
	this.machine.driver.get('mpoc', function(err, value) {
		this.emit_gcode("G10 L2 P2 C" + value);
	 	this.cmd_posc = this.posc = 0;
		callback();
	}.bind(this));	
}

SBPRuntime.prototype.Z2 = function(args, callback)  {
	this.machine.driver.get('mpox', function(err, value1) {
		this.machine.driver.get('mpoy', function(err, value2) {
		    this.emit_gcode("G10 L2 P2 X" + value1 + "Y" + value2);
			this.cmd_posx = this.posx = 0;
			this.cmd_posy = this.posy = 0;
			callback();
		}.bind(this));
	}.bind(this));
}

SBPRuntime.prototype.Z3 = function(args) {
	this.emit_gcode("G10 L2 P2 X" + this.posx + " Y" + this.posy + " Z" + this.posz);
	this.cmd_posx = this.posx = 0;
	this.cmd_posy = this.posy = 0;
	this.cmd_posz = this.posz = 0;
}

SBPRuntime.prototype.Z4 = function(args) {
	this.emit_gcode("G10 L2 P2 X" + this.posx + " Y" + this.posy + " Z" + this.posz + " A" + this.posa);
	this.cmd_posx = this.posx = 0;
	this.cmd_posy = this.posy = 0;
	this.cmd_posz = this.posz = 0;
 	this.cmd_posa = this.posa = 0;
}

SBPRuntime.prototype.Z5 = function(args) {
	this.emit_gcode("G10 L2 P2 X" + this.posx + " Y" + this.posy + " Z" + this.posz + " A" + this.posa + " B" + this.posb);
	this.cmd_posx = this.posx = 0;
	this.cmd_posy = this.posy = 0;
	this.cmd_posz = this.posz = 0;
 	this.cmd_posa = this.posa = 0;
 	this.cmd_posb = this.posb = 0;
}

SBPRuntime.prototype.Z6 = function(args) {
	this.emit_gcode("G10 L2 P2 X" + this.posx + " Y" + this.posy + " Z" + this.posz + " A" + this.posa + " B" + this.posb + " C" + this.posc);
 	this.cmd_posx = this.posx = 0;
	this.cmd_posy = this.posy = 0;
	this.cmd_posz = this.posz = 0;
 	this.cmd_posa = this.posa = 0;
 	this.cmd_posb = this.posb = 0;
 	this.cmd_posc = this.posc = 0;
}

SBPRuntime.prototype.ZT = function(args) {
    this.emit_gcode("G54");
}

/* SETTINGS */

// Set to Absolute coordinates
SBPRuntime.prototype.SA = function(args) {
	this.emit_gcode("G90");
}

//  Set to Relative coordinates
SBPRuntime.prototype.SR = function(args) {
	this.emit_gcode("G91");
}

// Set to MOVE mode
SBPRuntime.prototype.SM = function(args) {
	
}

// Set to PREVIEW mode
SBPRuntime.prototype.SP = function(args) {
	
}

// Set to table base coordinates
SBPRuntime.prototype.ST = function(args) {
	this.emit_gcode("G54");
}


/* VALUES */

SBPRuntime.prototype.VA = function(args, callback) {
// ?????????? Needs work to make function like VA in ShopBot	
	log.debug("VA Command: " + args);
	var zoffset = -args[2];
	if(zoffset !== undefined) {
		this.machine.driver.get('g55z', function(err, value) {
			log.warn("Got mpoz: " + value)
			log.warn("Current zpos: " + this.machine.status.posz);
			// TODO fix hardcoded feedrate
			this.emit_gcode("G1 F20");
			this.emit_gcode("G10 L2 P2 Z" + (value + this.machine.status.posz + zoffset));
			callback();
		}.bind(this));

	}
}

SBPRuntime.prototype.VC = function(args) {
	if (args[0] != undefined) sbp_settings.cutterDia = args[0];		// Cutter Diameter
	// args[1] = Obsolete
	// args[2] = Obsolete
	if (args[3] != undefined) sbp_settings.safeZpullUp = args[3];	// safe-Z-pull-up
	if (args[4] != undefined) sbp_settings.plungeDir = args[4];		// plunge direction
	if (args[5] != undefined) sbp_settings.pocketOverlap = args[5];	// % pocket overlap
	if (args[6] != undefined) sbp_settings.safeApullUp = args[6];	// safe-A-pull-up
//	if (args[7] != undefined) sbp_settings.triggeredOutput = args[7];	// triggered output switch
//	if (args[8] != undefined) sbp_settings.triggerONthreshold = args[8];	// trigger ON threshold
//	if (args[9] != undefined) sbp_settings.triggerOFFthreshold = args[9];	// trigger OFF threshold
//	if (args[10] != undefined) sbp_settings.vertAxisMonitor = args[10];	// vertical axis monitored
//	if (args[11] != undefined) sbp_settings.triggerOutputNum = args[11];	// triggered output switch #

}	

SBPRuntime.prototype.VD = function(args) {
	// Number of Axes
	// XYZ Unit type
	// A Unit type
	// B Unit type
	// Show control console
	// Display File Comments
	// Keypad fixed distance
	// Keypad remote
	// Keypad Switch AutoOff
	// Write Part File Log
	// Write System File Log
	// Message Screen Location X
	// Message Screen Location Y
	// Message Screen Size X
	// Message Screen Size Y
	// Keypad switches Auto-Off
	// Show file Progress
	// Main Display Type

}	

SBPRuntime.prototype.VL = function(args) {
	// X - Low Limit
	// X - High Limit
	// Y - Low Limit
	// Y - High Limit
	// Z - Low Limit
	// Z - High Limit
	// A - Low Limit
	// A - High Limit
	// B - Low Limit
	// B - High Limit
	// C - Low Limit
	// C - High Limit
	// 3D Threshold
	// Minimum Distance to Check
	// Slow Corner Speed
	// Keypad Ramp Rate
}	

SBPRuntime.prototype.VN = function(args) {
		// Limits 0-OFF, 1-ON
		// Input #4 Switch mode 0-Nrm Closed Stop, 1-Nrm Open Stop, 2-Not Used 
		// Enable Torch Height Controller, Laser or Analog Control
		//		0-Off, 1-Torch, 2-Laser, 3-An1 Control, 4-An2 Control, 5-An1 & An2 Control
	
	// Input Switch Modes = 0-Standard Switch, 1-Nrm Open Limit, 2-Nrm Closed Limit, 3-Nrm Open Stop, 4-Nrm Closed Stop
		// Input #1 Switch mode
		// Input #2 Switch mode
		// Input #3 Switch mode
		// Input #5 Switch mode
		// Input #6 Switch mode
		// Input #7 Switch mode	
		// Input #8 Switch mode
		// Input #9 Switch mode
		// Input #10 Switch mode
		// Input #11 Switch mode
		// Input #12 Switch mode
	// Output Switch Modes = 0-StdON/FileOFF, 1-StdON/NoOFF, 2-StdON/LIStpOFF, 3-AutoON/FileOFF, 4-AutoON/NoOFF, 5-AutoON/FIStpOFF
		// Output #1 Mode 
		// Output #2 Mode
		// Output #3 Mode
		// Output #5 Mode
		// Output #6 Mode
		// Output #7 Mode
		// Output #8 Mode
		// Output #9 Mode
		// Output #10 Mode
		// Output #11 Mode
		// Output #12 Mode

}	

SBPRuntime.prototype.VP = function(args) {
	// Grid
	// Table Size X
	// Table Size Y
	// Table Size Z
	// Simulate Cutting
	// Draw Tool
	// Start Actual Location
	// Show Jugs

}	

SBPRuntime.prototype.VR = function(args) {
	// XY Move Ramp Speed
	// Z Move Ramp Speed
	// A Move Ramp Speed
	// B Move Ramp Speed
	// C Move Ramp Speed
	// XY Jog Ramp Speed
	// Z Jog Ramp Speed
	// A Jog Ramp Speed
	// B Jog Ramp Speed
	// C Jog Ramp Speed
	// Move Ramp Rate
	// Jog Ramp Rate
	// 3D Threshold
	// Minimum Distance to Check
	// Slow Corner Speed
	// Keypad Ramp Rate
}	

SBPRuntime.prototype.VS = function(args) {
	if (args[0] != undefined) sbp_settings.movexy_speed = args[0];
	if (args[1] != undefined) sbp_settings.movez_speed = args[1];
	if (args[2] != undefined) sbp_settings.movea_speed = args[2];
	if (args[3] != undefined) sbp_settings.moveb_speed = args[3];
	if (args[4] != undefined) sbp_settings.movec_speed = args[4];
	if (args[5] != undefined) {
		sbp_settings.jogxy_speed = args[5];
		this.command({'xvm':sbp_settings.jogxy_speed});
		this.command({'yvm':sbp_settings.jogxy_speed});
	}
	if (args[6] != undefined) {
		sbp_settings.jogz_speed = args[6];
		this.command({'zvm':sbp_settings.jogz_speed});
	}
	if (args[7] != undefined) {
		sbp_settings.joga_speed = args[7];
		this.command({'avm':sbp_settings.joga_speed});
	}
	if (args[8] != undefined) {
		sbp_settings.jogb_speed = args[8];
		this.command({'bvm':sbp_settings.jogb_speed});
	}
	if (args[9] != undefined) {
		sbp_settings.jogc_speed = args[9];
		this.command({'cvm':sbp_settings.jogc_speed});
	}
}

SBPRuntime.prototype.VU = function(args) {
	if ( args[1] != undefined ) { sbp_settings.unitsX = args[1]; }
	if ( args[2] != undefined ) { sbp_settings.unitsY = args[2]; }
	if ( args[3] != undefined ) { sbp_settings.unitsZ = args[3]; }
	if ( args[4] != undefined ) { sbp_settings.unitsA = args[4]; }
	if ( args[9] != undefined ) { sbp_settings.unitsB = args[9]; }
	if ( args[6] != undefined ) { sbp_settings.unitsC = args[6]; }
//	if ( args[5] != undefined ) { circRes = args[5]; }
//	if ( args[8] != undefined ) { circSml = args[8]; }
	if ( args[10] != undefined ) { sbp_settings.resMX = args[10]; }
	if ( args[11] != undefined ) { sbp_settings.resMY = args[11]; }
	if ( args[12] != undefined ) { sbp_settings.resMZ = args[12]; }
	if ( args[13] != undefined ) { sbp_settings.resMA = args[13]; }
	if ( args[14] != undefined ) { sbp_settings.resMB = args[14]; }
	if ( args[15] != undefined ) { sbp_settings.resMC = args[15]; }
//	if ( args[16] != undefined ) { StepIntDiv = args[16]; }
}

SBPRuntime.prototype.EP = function(args) {
	log.info("Got a EP command");
	this.emit_gcode("G38.2 Z" + args[0]);
}

/* TOOLS */

/* UTILITIES */

/* HELP */
/*
runtime = new SBPRuntime();
runtime.runFileSync('example.sbp');
console.log(runtime.user_vars);
*/
exports.SBPRuntime = SBPRuntime;


