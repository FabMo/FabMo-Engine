var parser = require('./sbp_parser');
var fs = require('fs');
var log = require('./log');
var g2 = require('./g2');
var sbp_settings = require('./sbp_settings');
var sb3_commands = require('./sb3_commands');

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
	this.cmd_posx = 0;
	this.cmd_posy = 0;
	this.cmd_posz = 0;
	this.cmd_posa = 0;
	this.cmd_posb = 0;
	this.cmd_posc = 0; 
}

SBPRuntime.prototype.connect = function(machine) {
	this.machine = machine
	this.driver = machine.driver
	this._update();
	this.status_handler = this._onG2Status.bind(this);
	this.driver.on('status', this.status_handler);
	log.info('Connected shopbot runtime');
}

SBPRuntime.prototype.disconnect = function() {
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
  //
}

// Evaluate a list of arguments provided (for commands)
SBPRuntime.prototype._evaluate_args = function(args) {
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
				this[command.cmd](this._evaluate_args(command.args));
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

// Evaluate an expression.  Return the result.
// TODO: Make this robust to undefined user variables
SBPRuntime.prototype._eval = function(expr) {
	log.debug("evaluating " + JSON.stringify(expr))
	if(expr.op === undefined) {
		expr = String(expr);
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

		case 144:
		    return this.machine.status.posc;
		break;

		default:
			return null
		break;
	}
}

SBPRuntime.prototype.evaluateUserVariable = function(v) {
	log.info(v)
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
	this.emit_gcode("G1X" + args[0] + " F" + sbp_settings.movexy_speed);
	this.cmd_posx += args[0];
}

SBPRuntime.prototype.MY = function(args) {
	this.emit_gcode("G1Y" + args[0] + " F" + sbp_settings.movexy_speed);
	this.cmd_posy += args[0];
}

SBPRuntime.prototype.MZ = function(args) {
	this.emit_gcode("G1Z" + args[0] + " F" + sbp_settings.movez_speed);
	this.cmd_posz += args[0];
}

SBPRuntime.prototype.MA = function(args) {
	this.emit_gcode("G1A" + args[0] + " F" + sbp_settings.movea_speed);
	this.cmd_posa += args[0];
}

SBPRuntime.prototype.MB = function(args) {
	this.emit_gcode("G1B" + args[0] + " F" + sbp_settings.moveb_speed);
	this.cmd_posb += args[0];
}

SBPRuntime.prototype.MC = function(args) {
	this.emit_gcode("G1C" + args[0] + " F" + sbp_settings.movec_speed);
	this.cmd_posc += args[0];
}

SBPRuntime.prototype.M2 = function(args) {
	var outStr = "G1"
	if (args[0] != undefined) outStr = outStr + "X" + args[0];
	if (args[1] != undefined) outStr = outStr + "Y" + args[1];
	this.emit_gcode(outStr);
	this.cmd_posx = args[0];
	this.cmd_posy = args[1];
}

SBPRuntime.prototype.M3 = function(args) {
	var outStr = "G1"
	if (args[0] != undefined) outStr = outStr + "X" + args[0];
	if (args[1] != undefined) outStr = outStr + "Y" + args[1];
	if (args[2] != undefined) outStr = outStr + "Z" + args[2];
	this.emit_gcode(outStr);
	this.cmd_posx = args[0];
	this.cmd_posy = args[1];
	this.cmd_posz = args[2];
}

SBPRuntime.prototype.M4 = function(args) {
	var outStr = "G1"
	if (args[0] != undefined) outStr = outStr + "X" + args[0];
	if (args[1] != undefined) outStr = outStr + "Y" + args[1];
	if (args[2] != undefined) outStr = outStr + "Z" + args[2];
	if (args[3] != undefined) outStr = outStr + "A" + args[3];
	this.emit_gcode(outStr);
	this.cmd_posx = args[0];
	this.cmd_posy = args[1];
	this.cmd_posz = args[2];
	this.cmd_posa = args[3];
}

SBPRuntime.prototype.M5 = function(args) {
	var outStr = "G1"
	if (args[0] != undefined) outStr = outStr + "X" + args[0];
	if (args[1] != undefined) outStr = outStr + "Y" + args[1];
	if (args[2] != undefined) outStr = outStr + "Z" + args[2];
	if (args[3] != undefined) outStr = outStr + "A" + args[3];
	if (args[4] != undefined) outStr = outStr + "B" + args[4];
	this.emit_gcode(outStr);
	this.cmd_posx = args[0];
	this.cmd_posy = args[1];
	this.cmd_posz = args[2];
	this.cmd_posa = args[3];
	this.cmd_posb = args[4];
}

SBPRuntime.prototype.M6 = function(args) {
	var outStr = "G1"
	if (args[0] != undefined) outStr = outStr + "X" + args[0];
	if (args[1] != undefined) outStr = outStr + "Y" + args[1];
	if (args[2] != undefined) outStr = outStr + "Z" + args[2];
	if (args[3] != undefined) outStr = outStr + "A" + args[3];
	if (args[4] != undefined) outStr = outStr + "B" + args[4];
	if (args[5] != undefined) outStr = outStr + "C" + args[5];
	this.emit_gcode(outStr);
	this.cmd_posx = args[0];
	this.cmd_posy = args[1];
	this.cmd_posz = args[2];
	this.cmd_posa = args[3];
	this.cmd_posb = args[4];
	this.cmd_posc = args[5];
}

SBPRuntime.prototype.MH = function(args) {
	//this.emit_gcode("G1 Z" + safe_Z);
	this.emit_gcode("G1X0Y0");
	this.cmd_posx = 0;
	this.cmd_posy = 0;
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
	if (args[0] != undefined) outStr = outStr + "X" + args[0];
	if (args[1] != undefined) outStr = outStr + "Y" + args[1];
	this.emit_gcode(outStr);
	this.cmd_posx = args[0];
	this.cmd_posy = args[1];
}

SBPRuntime.prototype.J3 = function(args) {
	var outStr = "G0"
	if (args[0] != undefined) outStr = outStr + "X" + args[0];
	if (args[1] != undefined) outStr = outStr + "Y" + args[1];
	if (args[2] != undefined) outStr = outStr + "Z" + args[2];
	this.emit_gcode(outStr);
	this.cmd_posx = args[0];
	this.cmd_posy = args[1];
	this.cmd_posz = args[2];
}

SBPRuntime.prototype.J4 = function(args) {
	var outStr = "G0"
	if (args[0] != undefined) outStr = outStr + "X" + args[0];
	if (args[1] != undefined) outStr = outStr + "Y" + args[1];
	if (args[2] != undefined) outStr = outStr + "Z" + args[2];
	if (args[3] != undefined) outStr = outStr + "A" + args[3];
	this.emit_gcode(outStr);
	this.cmd_posx = args[0];
	this.cmd_posy = args[1];
	this.cmd_posz = args[2];
	this.cmd_posa = args[3];
}

SBPRuntime.prototype.J5 = function(args) {
	var outStr = "G0"
	if (args[0] != undefined) outStr = outStr + "X" + args[0];
	if (args[1] != undefined) outStr = outStr + "Y" + args[1];
	if (args[2] != undefined) outStr = outStr + "Z" + args[2];
	if (args[3] != undefined) outStr = outStr + "A" + args[3];
	if (args[4] != undefined) outStr = outStr + "B" + args[4];
	this.emit_gcode(outStr);
	this.cmd_posx = args[0];
	this.cmd_posy = args[1];
	this.cmd_posz = args[2];
	this.cmd_posa = args[3];
	this.cmd_posb = args[4];
}

SBPRuntime.prototype.J6 = function(args) {
	var outStr = "G0"
	if (args[0] != undefined) outStr = outStr + "X" + args[0];
	if (args[1] != undefined) outStr = outStr + "Y" + args[1];
	if (args[2] != undefined) outStr = outStr + "Z" + args[2];
	if (args[3] != undefined) outStr = outStr + "A" + args[3];
	if (args[4] != undefined) outStr = outStr + "B" + args[4];
	if (args[5] != undefined) outStr = outStr + "C" + args[5];
	this.emit_gcode(outStr);
	this.cmd_posx = args[0];
	this.cmd_posy = args[1];
	this.cmd_posz = args[2];
	this.cmd_posa = args[3];
	this.cmd_posb = args[4];
	this.cmd_posc = args[5];
}

SBPRuntime.prototype.JH = function(args) {
	//this.emit_gcode("G0 Z" + safe_Z);
	this.emit_gcode("G0X0Y0");
	this.cmd_posx = 0;
	this.cmd_posy = 0;
}

SBPRuntime.prototype.JS = function(args) {
	this.emit_gcode("F" + args[0]);
}

/* CUTS */

SBPRuntime.prototype.CG = function(args) {
    // - Should we handle I-O-T option??
    // - How to implement spiral plunge in G-code????

    startX = this.cmd_posx;
    startY = this.cmd_posy;
    startZ = this.cmd_posz;
    if (args[13] != undefined && args[13] == 1){
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
    var Dr = args[6] != undefined ? args[6] : 0; 
    var Plg = args[7] != undefined ? args[7] : 0;
    var reps = args[8] != undefined ? args[8] : 1;
    var optCG = args[11] != undefined ? args[11] : 0;
    var nuPullUp = args[12] != undefined ? args[12] : 0;

    for (i=0; i<reps;i++){
    	if (Plg != 0 && optG == 0 ){		// If plunge depth is specified move to that depth * number of reps
    		currentZ += Plg;
    		this.emit_gcode("G1Z" + currentZ + " F" + sbp_settings.movez_speed);
    	}
    	if (Dr == 1 || Dr == 0 ){ var outStr = "G2X" + endX + "Y" + endY; }  // Clockwise circle/arc
    	else (Dr == -1)  { var outStr = "G3X" + endX + "Y" + endY; }         // CounterClockwise circle/arc
		if (Plg != 0 && optCG == 3) { outStr = outStr + "Z" + ; }            // Add Z for spiral plunge
		outStr = outStr + "I" + centerX + "K" + centerY;					 // Add Center offset
		this.emit_gcode(outStr); 

    	if(endX != startX || endY != startY){	//If an arc, pullup and jog back to the start position
    		this.emit_gcode("G0Z" + safe_Z )
    	   	this.emit_gcode("G0X" + startX + "Y" + startY);		
    	}
    }

    if(noPullUp == 0){    	//If No pull-up is set to YES, pull up to the starting Z location
    	this.emit_gcode("G1Z" + startZ);
    	this.cmd_posz = startZ;
    }
    else{				    //If not, stay at the ending Z height
  		this.cmd_posz = currentZ;
    }

    this.cmd_posx = endX;
	this.cmd_posy = endY;
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


