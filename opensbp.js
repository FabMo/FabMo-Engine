var parser = require('./sbp_parser');
var fs = require('fs');
var log = require('./log').logger('sbp');
var g2 = require('./g2');
var sbp_settings = require('./sbp_settings');
var sb3_commands = require('./data/sb3_commands');

var SYSVAR_RE = /\%\(([0-9]+)\)/i
var USERVAR_RE = /\&([a-zA-Z_]+[A-Za-z0-9_]*)/i

function SBPRuntime() {
	this.program = []
	this.pc = 0
	this.user_vars = {}
	this.label_index = {}
	this.stack = []
	this.current_chunk = []
	this.running = false;
}

SBPRuntime.prototype.connect = function(machine) {
	this.machine = machine
	this.driver = machine.driver
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
			this.machine.status[key] = status[key];
		}
	}
}

// Run the provided string as a program
SBPRuntime.prototype.runString = function(s) {
	this.init();
	try {
		this.program = parser.parse(s + '\n');
		this._analyzeLabels();  // Build a table of labels
		this._analyzeGOTOs();   // Check all the GOTO/GOSUBs against the label table    
		this._run();
	} catch(err) {
		log.error(err);
	}
}

// Update the internal state of the runtime with data from the tool
SBPRuntime.prototype._update = function() {
	status = this.machine.status || {}
	this.posx = 0.0
	this.posy = 0.0
	this.posz = 0.0
	this.posa = 0.0
	this.posb = status.posb || 0.0
	this.posc = status.posc || 0.0
}

// Evaluate a list of arguments provided (for commands)
SBPRuntime.prototype._evaluateArguments = function(args) {
	retval = [];
	for(i=0; i<args.length; i++) {
		retval.push(this._eval(args[i]));
	}
	return retval;
}

// Start the stored program running
SBPRuntime.prototype._run = function() {
	this.started = true;
	this.machine.setState(this, "running");
	this._continue();
}

// Continue running the current program (until the end of the next chunk)
// _continue() will dispatch the next chunk if appropriate, once the current chunk is finished
SBPRuntime.prototype._continue = function() {

	this._update();

	log.info('Running until break...')

	// Continue is only for resuming an already running program.  It's not a substitute for _run()
	if(!this.started) {
		cosnole.log('Ooops already started...');
		return;
	}

	while(true) {
		if(this.pc >= this.program.length) {
			log.info("Program over. (pc = " + this.pc + ")")
			if(this.current_chunk.length > 0) {
				log.info("dispatching a chunk: " + this.current_chunk)
				this._dispatch();
				return;
			}
			this.machine.status.filename = null;
			this.init();
			return;
		}

		
		line = this.program[this.pc];
		log.info("executing line: " + JSON.stringify(line));
		this._execute(line);

		if(this.break_chunk) {
			this._dispatch();
			return;
		} 
	}	
}

// Pack up the current chunk and send it to G2
// Setup callbacks so that when the chunk is done, the program can be resumed
SBPRuntime.prototype._dispatch = function() {
	var runtime = this;
	this.break_chunk = false;
	if(this.current_chunk.length > 0) {
		this.driver.expectStateChange({
			"running" : function(driver) {
				log.info("Expected a running state change and got one.");
				driver.expectStateChange({
					"stop" : function(driver) { 
						runtime._continue();
					},
					null : function(driver) {
						log.info("Expected a stop but didn't get one.");
					}
				});
			},
			null : function(t) {
				log.info("Expected a start but didn't get one."); 
			}
		});
		this.driver.runSegment(this.current_chunk.join('\n'));
		this.current_chunk = [];
	} else {
		runtime._continue();
	}
}

// Execute a single statement
// Accepts a parsed statement, and returns nothing
SBPRuntime.prototype._execute = function(command) {
	this.break_chunk = false;

	if(!command) {
		this.pc += 1;
		return
	}
	switch(command.type) {
		case "cmd":
			if((command.cmd in this) && (typeof this[command.cmd] == 'function')) {
				this._scrubArguments(command.cmd, command.args)
				this[command.cmd](this._evaluateArguments(command.args));
			} else {
				this._unhandledCommand(command)
			}
			this.pc += 1;
			break;

		case "return":
			this.break_chunk = true
			if(this.stack) {
				this.pc = this.stack.pop();
			} else {
				throw "Runtime Error: Return with no GOSUB at " + this.pc;
			}
			break;

		case "end":
			this.break_chunk = true;
			this.pc = this.program.length;
			break;

		case "goto":
			this.break_chunk = true;
			if(command.label in this.label_index) {
				this.pc = this.label_index[command.label];
			} else {
				throw "Runtime Error: Unknown Label '" + command.label + "' at line " + this.pc;
			}
			break;

		case "gosub":
			this.break_chunk = true;
			if(command.label in this.label_index) {
				this.pc = this.label_index[command.label];
				this.stack.push([this.pc + 1])
			} else {
				throw "Runtime Error: Unknown Label '" + command.label + "' at line " + this.pc;
			}
			break;

		case "assign":
			this.user_vars[command.var] = this._eval(command.expr);
			this.pc += 1;
			break;

		case "cond":
			// Here we would wait for conditional
			this.break_chunk = true;
			if(this._eval(command.cmp)) {
				this._execute(command.stmt);
			} else {
				this.pc += 1;
			}
			break;

		case "label":
		case "comment":
		case undefined:
			this.pc += 1;
			break;

		case "pause":
			this.pc += 1;
			this.break_chunk = true;
			break;

		default:
			log.error("Unknown command: " + JSON.stringify(command))
			this.pc += 1;
			break;
	}
	return;
}

SBPRuntime.prototype._eval_value = function(expr) {
		sys_var = this.evaluateSystemVariable(expr);
		if(sys_var === undefined) {
			user_var = this.evaluateUserVariable(expr);
			if(user_var === undefined) {
				log.debug("Evaluated " + expr + " as " + expr)
				return parseFloat(expr);
			} else if(user_var === null) {
				// ERROR UNDEFINED VARIABLE
			} else {
				log.debug("Evaluated " + expr + " as " + user_var)
				return parseFloat(user_var);
			}
		} else if(sys_var === null) {
			// ERROR UNKNOWN SYSTEM VARIABLE
		} else {
			log.debug("Evaluated " + expr + " as " + sys_var)
			return parseFloat(sys_var);
		}	
}

// Evaluate an expression.  Return the result.
// TODO: Make this robust to undefined user variables
SBPRuntime.prototype._eval = function(expr) {
	log.debug("evaluating " + JSON.stringify(expr))
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
	this.stack = []
	this.label_index = {}
	this.break_chunk = false;
	this.current_chunk = [];
	this.started = false;
	this.machine.setState(this, "idle");

}

// Compile an index of all the labels in the program
// this.label_index will map labels to line numbers
// An error is thrown on duplicate labels
SBPRuntime.prototype._analyzeLabels = function() {
	this.label_index = {}
	for(i=0; i<this.program.length; i++) {
		line = this.program[i];
		if(line) {
			switch(line.type) {
				case "label":
					if (line.value in this.label_index) {
						throw "Duplicate label."
					}
					this.label_index[line.value] = i;
					break;
			}
		}
	}
}

// Using the command mnemonic, check the list of command argument, and return a 
// "scrubbed" argument list that is of the correct length, and has coerced values
// filled in for all arguments that were out of range or otherwise needed adjusting
SBPRuntime.prototype._scrubArguments = function(command, args) {
	scrubbed_args = []
	if(command in sb3_commands) {
		params = sb3_commands[command].params
		for(i=0; i<params.length; i++) {
			prm_param = params[i];
			user_param = args[i];
			if((args[i] != undefined) && (args[i] != "")) {
				scrubbed_args.push(args[i])
			} else {
				scrubbed_args.push(prm_param.default || undefined);
			}
		}
	} else {
		throw "Unknown command: " + command
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

		default:
			return null
		break;
	}
}

SBPRuntime.prototype.evaluateUserVariable = function(v) {
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
	this.posx += args[0];
}

SBPRuntime.prototype.MY = function(args) {
	this.emit_gcode("G1 Y" + args[0] + " F" + sbp_settings.movexy_speed);
	this.posy += args[0];
}

SBPRuntime.prototype.MZ = function(args) {
	this.emit_gcode("G1 Z" + args[0] + " F" + sbp_settings.movez_speed);
	this.posz += args[0];
}

SBPRuntime.prototype.MA = function(args) {
	this.emit_gcode("G1 A" + args[0] + " F" + sbp_settings.movea_speed);
	this.posa += args[0];
}

SBPRuntime.prototype.MB = function(args) {
	this.emit_gcode("G1 B" + args[0] + " F" + sbp_settings.moveb_speed);
	this.posb += args[0];
}

SBPRuntime.prototype.MC = function(args) {
	this.emit_gcode("G1 C" + args[0] + " F" + sbp_settings.movec_speed);
	this.posc += args[0];
}

SBPRuntime.prototype.M2 = function(args) {
	this.emit_gcode("G1 X" + args[0] + " Y" + args[1]);
	this.posx = args[0];
	this.posy = args[1];
}

SBPRuntime.prototype.M3 = function(args) {
	this.emit_gcode("G1 X" + args[0] + "Y" + args[1] + "Z" + args[2]);
	this.posx = args[0];
	this.posy = args[1];
	this.posz = args[2];
}

SBPRuntime.prototype.M4 = function(args) {
	this.emit_gcode("G1 X" + args[0] + "Y" + args[1] + "Z" + args[2] + "A" + args[3]);
	this.posx = args[0];
	this.posy = args[1];
	this.posz = args[2];
	this.posa = args[3];
}

SBPRuntime.prototype.M5 = function(args) {
	this.emit_gcode("G1 X" + args[0] + "Y" + args[1] + "Z" + args[2] + "A" + args[3] + "B" + args[4]);
	this.posx = args[0];
	this.posy = args[1];
	this.posz = args[2];
	this.posa = args[3];
	this.posb = args[4];
}

SBPRuntime.prototype.M6 = function(args) {
	this.emit_gcode("G1 X" + args[0] + "Y" + args[1] + "Z" + args[2] + "A" + args[3] + "B" + args[4] + "C" + args[5]);
	this.posx = args[0];
	this.posy = args[1];
	this.posz = args[2];
	this.posa = args[3];
	this.posb = args[4];
	this.posc = args[5];
}

SBPRuntime.prototype.MH = function(args) {
	//this.emit_gcode("G1 Z" + safe_Z);
	this.emit_gcode("G1 X0 Y0");
	this.posx = 0;
	this.posy = 0;
}

SBPRuntime.prototype.MS = function(args) {
	this.emit_gcode("F" + args[0]);
	sbp_settings.movex_speed = sbp_settings.movey_speed = args[0];
	sbp_settings.movez_speed = args[1];
}

SBPRuntime.prototype.MI = function(args) {
	//?????????????????????????????????????????????
}

SBPRuntime.prototype.MO = function(args) {
	//?????????????????????????????????????????????
}


/* JOG */

SBPRuntime.prototype.JX = function(args) {
	this.emit_gcode("G0 X" + args[0]);
	this.posx = args[0];
}

SBPRuntime.prototype.JY = function(args) {
	this.emit_gcode("G0 Y" + args[0]);
	this.posy = args[0];
}

SBPRuntime.prototype.JZ = function(args) {
	this.emit_gcode("G0 Z" + args[0]);
	this.posz = args[0];
}

SBPRuntime.prototype.JA = function(args) {
	this.emit_gcode("G0 A" + args[0]);
	this.posa = args[0];
}

SBPRuntime.prototype.JB = function(args) {
	this.emit_gcode("G0 B" + args[0]);
	this.posb = args[0];
}

SBPRuntime.prototype.JC = function(args) {
	this.emit_gcode("G0 C" + args[0]);
	this.posc = args[0];
}

SBPRuntime.prototype.J2 = function(args) {
	this.emit_gcode("G0 X" + args[0] + " Y" + args[1]);
	this.posx = args[0];
	this.posy = args[1];
}

SBPRuntime.prototype.J3 = function(args) {
	this.emit_gcode("G0 X" + args[0] + "Y" + args[1] + "Z" + args[2]);
	this.posx = args[0];
	this.posy = args[1];
	this.posz = args[2];
}

SBPRuntime.prototype.J4 = function(args) {
	this.emit_gcode("G0 X" + args[0] + "Y" + args[1] + "Z" + args[2] + "A" + args[3]);
	this.posx = args[0];
	this.posy = args[1];
	this.posz = args[2];
	this.posa = args[3];
}

SBPRuntime.prototype.J5 = function(args) {
	this.emit_gcode("G0 X" + args[0] + "Y" + args[1] + "Z" + args[2] + "A" + args[3] + "B" + args[4]);
	this.posx = args[0];
	this.posy = args[1];
	this.posz = args[2];
	this.posa = args[3];
	this.posb = args[4];
}

SBPRuntime.prototype.J6 = function(args) {
	this.emit_gcode("G0 X" + args[0] + "Y" + args[1] + "Z" + args[2] + "A" + args[3] + "B" + args[4] + "C" + args[5]);
	this.posx = args[0];
	this.posy = args[1];
	this.posz = args[2];
	this.posa = args[3];
	this.posb = args[4];
	this.posc = args[5];
}

SBPRuntime.prototype.JH = function(args) {
	//this.emit_gcode("G0 Z" + safe_Z);
	this.emit_gcode("G0 X0 Y0");
	this.posx = 0;
	this.posy = 0;
}

SBPRuntime.prototype.JS = function(args) {
	this.emit_gcode("F" + args[0]);
}

/* CUTS */

SBPRuntime.prototype.CG = function(args) {
    // - Should we handle I-O-T option??
    // - How to implement spiral plunge in G-code????

    startX = this.posx;
    startY = this.posy;
    startZ = this.posz;
    if(args[13] == 1){
    	plgZ = 0;
    }
    else{
    	plgZ = startZ;
    }
    currentZ = plgZ;
    endX = args[1];
    endY = args[2];
    centerX = args[3];
    centerY = args[4];
    //OIT = args[5];
    Dr = args[6];
    Plg = args[7];
    reps = args[8];
    optCG = args[11];
    noPullUp = args[12];
    
    for (i=0; i<reps;i++){
    	if (Plg != 0 ){		// If plunge depth is specified move to that depth * number of reps
    		currentZ += Plg;
    		this.emit_gcode("G1 Z" + currentZ + " F" + sbp_settings.movez_speed);
    	}
    	if (Dr == 1 ){		// Clockwise circle/arc
    		this.emit_gcode("G2 X" + endX + "Y" + endY + "I" + centerX + "K" + centerY);
    	}
    	else {      		// CounterClockwise circle/arc
    		this.emit_gcode("G3 X" + endX + "Y" + endY + "I" + centerX + "K" + centerY);	
    	}
    	if(endX != startX || endY != startY){	//If an arc, pullup and jog back to the start position
    		this.emit_gcode("G0 Z" + safe_Z )
    	   	this.emit_gcode("G0 X" + startX + "Y" + startY);		
    	}
    }

    if(noPullUp == 0){    	//If No pull-up is set to YES, pull up to the starting Z location
    	this.emit_gcode("G1 Z" + startZ);
    	this.posz = startZ;
    }
    else{				    //If not, stay at the ending Z height
  		this.posz = currentZ;
    }

    this.posx = endX;
	this.posy = endY;
}

SBPRuntime.prototype.CR = function(args) {
	//calc and output commands to cut a rectangle
}

/* ZERO */

SBPRuntime.prototype.ZX = function(args) {
	this.emit_gcode("G10 L2 P2 X" + this.posx);
	this.posx = 0;
}

SBPRuntime.prototype.ZY = function(args) {
	this.emit_gcode("G10 L2 P2 Y" + this.posy);
 	this.posy = 0;
}

SBPRuntime.prototype.ZZ = function(args) {
	this.emit_gcode("G10 L2 P2 Z" + this.posz);
 	this.posz = 0;
}

SBPRuntime.prototype.ZA = function(args) {
	this.emit_gcode("G10 L2 P2 A" + this.posa);
 	this.posa = 0;
}

SBPRuntime.prototype.ZB = function(args) {
	this.emit_gcode("G10 L2 P2 B" + this.posb);
 	this.posb = 0;
}

SBPRuntime.prototype.ZC = function(args) {
	this.emit_gcode("G10 L2 P2 Z" + this.posc);
 	this.posc = 0;
}

SBPRuntime.prototype.Z2 = function(args) {
	this.emit_gcode("G10 L2 P2 X" + this.posc + " Y" + this.posy);
 	this.posx = 0;
 	this.posy = 0;
}

SBPRuntime.prototype.Z3 = function(args) {
	this.emit_gcode("G10 L2 P2 X" + this.posx + " Y" + this.posy + " Z" + this.posz);
 	this.posx = 0;
 	this.posy = 0;
 	this.posz = 0;
}

SBPRuntime.prototype.Z4 = function(args) {
	this.emit_gcode("G10 L2 P2 X" + this.posx + " Y" + this.posy + " Z" + this.posz + " A" + this.posa);
 	this.posx = 0;
 	this.posy = 0;
 	this.posz = 0;
 	this.posa = 0;
}

SBPRuntime.prototype.Z5 = function(args) {
	this.emit_gcode("G10 L2 P2 X" + this.posx + " Y" + this.posy + " Z" + this.posz + " A" + this.posa + " B" + this.posb);
 	this.posx = 0;
 	this.posy = 0;
 	this.posz = 0;
 	this.posa = 0;
 	this.posb = 0;
}

SBPRuntime.prototype.Z6 = function(args) {
	this.emit_gcode("G10 L2 P2 X" + this.posx + " Y" + this.posy + " Z" + this.posz + " A" + this.posa + " B" + this.posb + " C" + this.posc);
 	this.posx = 0;
 	this.posy = 0;
 	this.posz = 0;
 	this.posa = 0;
 	this.posb = 0;
 	this.posc = 0;
}

SBPRuntime.prototype.ZT = function(args) {
    this.emit_gcode("G54")
}

/* SETTINGS */

// Set to table base coordinates
SBPRuntime.prototype.ST = function(args) {
	this.emit_gcode("G54");
}

/* VALUES */

SBPRuntime.prototype.VC = function(args) {
//	this.emit_gcode("G28.1");
}

SBPRuntime.prototype.VP = function(args) {
//	this.emit_gcode("G28.1");
}

SBPRuntime.prototype.VR = function(args) {
//	this.emit_gcode("G28.1");
}

SBPRuntime.prototype.VS = function(args) {
//	this.emit_gcode("G28.1");
}

/* TOOLS */

/* UTILITIES */

/* HELP */
/*
runtime = new SBPRuntime();
runtime.runFileSync('example.sbp');
console.log(runtime.user_vars);
*/
exports.SBPRuntime = SBPRuntime


