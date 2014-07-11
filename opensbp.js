var parser = require('./sbp_parser');
var fs = require('fs');
var log = require('./log');

function SBPRuntime() {
	this.program = []
	this.pc = 0
	this.user_vars = {}
	this.label_index = {}
	this.stack = []
	this.current_chunk = []
	this.running = false;
};

SBPRuntime.prototype.connect = function(machine) {
	this.machine = machine
	this.driver = machine.driver

	this.driver.on('status', this._onG2Status.bind(this));
}

SBPRuntime.prototype._onG2Status = function(status) {
	// Update our copy of the system status
	for (var key in this.machine.status) {
		if(key in status) {
			this.machine.status[key] = status[key];
		}
	}
}

SBPRuntime.prototype.runString = function(s) {
	this.init();
	try {
    	this.program = parser.parse(s + '\n');
	    console.log(this.program);
	    this._analyzeLabels();  // Build a table of labels
	    this._analyzeGOTOs();   // Check all the GOTO/GOSUBs against the label table    
    } catch(err) {
    	log.error(err);
    }
    this._run_until_break();
}

// Evaluate a list of arguments provided (for commands)
SBPRuntime.prototype._evaluate_args = function(args) {
	retval = [];
	for(i=0; i<args.length; i++) {
		retval.push(this._eval(args[i]));
	}
	return retval;
}


SBPRuntime.prototype._run_until_break = function() {
while(true) {
	log.info('Running until break...')
	if(this.pc >= this.program.length) {
		console.log("Program over (pc = " + this.pc + ")")
		this.init();
		return;
	}

	while(true) {
		line = this.program[this.pc];
		console.log("tick: " + JSON.stringify(line));
		break_stack = this._execute(line);
		if(break_stack) {
			break;
		}
	}
	
	console.log("DEALING WITH CHUNK");
	if(this.current_chunk) {
		this.driver.runSegment(this.current_chunk.join('\n'), function() {
			this.current_chunk = [];
			this._run_until_break();
		}.bind(this));
	}
}
}

// Execute a single statement
SBPRuntime.prototype._execute = function(command) {
	end_chunk = false;

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
			end_chunk = true
			console.log("RETURN");
			if(this.stack) {
				this.pc = this.stack.pop();
			} else {
				throw "Runtime Error: Return with no GOSUB at " + this.pc;
			}
			break;

		case "end":
			end_chunk = true;
			this.pc = this.program.length;
			break;

		case "goto":
			end_chunk = true;
			if(command.label in this.label_index) {
				this.pc = this.label_index[command.label];
			} else {
				throw "Runtime Error: Unknown Label '" + command.label + "' at line " + this.pc;
			}
			break;

		case "gosub":
			end_chunk = true;
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
			end_chunk = true;
			if(this._eval(command.cmp)) {
				this._execute(command.stmt);
			} else {
				this.pc += 1;
			}
			break;

		case "label":
		case undefined:
			this.pc += 1;
			break;

		default:
			console.log("GOT UNKNOWN COMMAND TYPE " + command.type)
			this.pc += 1;
			break;
	}
	return !end_chunk;
}

// Evaluate an expression
SBPRuntime.prototype._eval = function(expr) {
	if(expr.op == undefined) {
		if (expr in this.user_vars) {
			return this.user_vars[expr];
		} else {
			return expr;
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
}

// Compile an index of all the labels in the program
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
							throw "Unknown label " + line.label + " on line " + i;
						}
						break;
				}
			}
		}
}


SBPRuntime.prototype._unhandledCommand = function(command) {
	console.log('Unhandled Command: ' + JSON.stringify(command));
}

SBPRuntime.prototype.emit_gcode = function(s) {
	this.current_chunk.push(s);
}

SBPRuntime.prototype.MX = function(args) {
	this.emit_gcode("G1 X" + args[0]);
}

SBPRuntime.prototype.MY = function(args) {
	this.emit_gcode("G1 Y" + args[0]);
}

SBPRuntime.prototype.MZ = function(args) {
	this.emit_gcode("G1 Z" + args[0]);
}

SBPRuntime.prototype.MA = function(args) {
	this.emit_gcode("G1 A" + args[0]);
}

SBPRuntime.prototype.MB = function(args) {
	this.emit_gcode("G1 B" + args[0]);
}

SBPRuntime.prototype.MC = function(args) {
	this.emit_gcode("G1 C" + args[0]);
}

SBPRuntime.prototype.M2 = function(args) {
	this.emit_gcode("G1 X" + args[0] + " Y" + args[1]);
}

SBPRuntime.prototype.M3 = function(args) {
	this.emit_gcode("G1 X" + args[0] + "Y" + args[1] + "Z" + args[2]);
}

SBPRuntime.prototype.M4 = function(args) {
	this.emit_gcode("G1 X" + args[0] + "Y" + args[1] + "Z" + args[2] + "A" + args[3]);
}

SBPRuntime.prototype.M5 = function(args) {
	this.emit_gcode("G1 X" + args[0] + "Y" + args[1] + "Z" + args[2] + "A" + args[3] + "B" + args[4]);
}

SBPRuntime.prototype.M6 = function(args) {
	this.emit_gcode("G1 X" + args[0] + "Y" + args[1] + "Z" + args[2] + "A" + args[3] + "B" + args[4] + "C" + args[5]);
}

SBPRuntime.prototype.JX = function(args) {
	this.emit_gcode("G0 X" + args[0]);
}

SBPRuntime.prototype.JY = function(args) {
	this.emit_gcode("G0 Y" + args[0]);
}

SBPRuntime.prototype.JZ = function(args) {
	this.emit_gcode("G0 Z" + args[0]);
}

SBPRuntime.prototype.JA = function(args) {
	this.emit_gcode("G0 A" + args[0]);
}

SBPRuntime.prototype.JB = function(args) {
	this.emit_gcode("G0 B" + args[0]);
}

SBPRuntime.prototype.JC = function(args) {
	this.emit_gcode("G0 C" + args[0]);
}

SBPRuntime.prototype.J2 = function(args) {
	this.emit_gcode("G0 X" + args[0] + " Y" + args[1]);
}

SBPRuntime.prototype.J3 = function(args) {
	this.emit_gcode("G0 X" + args[0] + "Y" + args[1] + "Z" + args[2]);
}

SBPRuntime.prototype.J4 = function(args) {
	this.emit_gcode("G0 X" + args[0] + "Y" + args[1] + "Z" + args[2] + "A" + args[3]);
}

SBPRuntime.prototype.J5 = function(args) {
	this.emit_gcode("G0 X" + args[0] + "Y" + args[1] + "Z" + args[2] + "A" + args[3] + "B" + args[4]);
}

SBPRuntime.prototype.J6 = function(args) {
	this.emit_gcode("G0 X" + args[0] + "Y" + args[1] + "Z" + args[2] + "A" + args[3] + "B" + args[4] + "C" + args[5]);
}

exports.SBPRuntime = SBPRuntime


