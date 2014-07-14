var parser = require('./sbp_parser');
var fs = require('fs');

function SBPRuntime() {
	this.program = []
	this.pc = 0
	this.user_vars = {}
	this.label_index = {}
	this.stack = []
};

SBPRuntime.prototype.runFile = function(filename) {
	fs.readFile(filename, 'utf8', function (err,data) {
		  if (err) {
		  	console.log('Error reading file ' + filename);
		    return console.log(err);
		  } else {
		  	this.runString(data);
		  }
		}.bind(this));
}

SBPRuntime.prototype.runFileSync = function(filename) {
	data = fs.readFileSync(filename, 'utf8');
	this.runString(data);
}
SBPRuntime.prototype.runString = function(s) {
	this.init();
    this.program = parser.parse(s + '\n');
    this._analyzeLabels();  // Build a table of labels
    this._analyzeGOTOs();   // Check all the GOTO/GOSUBs against the label table
    console.log(this.program);
    while(this.tick());
}

SBPRuntime.prototype.tick = function() {
	if(this.pc >= this.program.length) {
		return false;
	}
	line = this.program[this.pc];
	this._execute(line);
	return true;
}

SBPRuntime.prototype._execute = function(command) {
	if(!command) {
		this.pc += 1;
		return
	}
	switch(command.type) {
		case "cmd":
			if((command.cmd in this) && (typeof this[command.cmd] == 'function')) {
				this[command.cmd](command.args);
			} else {
				this._unhandledCommand(command)
			}
			this.pc += 1;
			break;

		case "return":
			console.log("RETURN");
			console.log(this.stack);
			if(this.stack) {
				this.pc = this.stack.pop();
			} else {
				throw "Runtime Error: Return with no GOSUB at " + this.pc;
			}
			break;

		case "end":
			this.pc = this.program.length;
			break;

		case "goto":
			if(command.label in this.label_index) {
				this.pc = this.label_index[command.label];
			} else {
				throw "Runtime Error: Unknown Label '" + command.label + "' at line " + this.pc;
			}
			break;

		case "gosub":
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
}

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
	console.log(s);
}

/* FILE /

/* MOVE */

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
	this.emit_gcode("G1 X" + args[0] + "Y" + args[1] + "Z" + args[2] + "A" + args[3] + "B" + args[4] + "C" " args[5]");
}

SBPRuntime.prototype.MH = function(args) {
	//this.emit_gcode("G1 Z" + safe_Z);
	this.emit_gcode("G1 X0 Y0");
}

/* JOG */

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
	this.emit_gcode("G0 X" + args[0] + "Y" + args[1] + "Z" + args[2] + "A" + args[3] + "B" + args[4] + "C" " args[5]");
}

SBPRuntime.prototype.JH = function(args) {
	//this.emit_gcode("G0 Z" + safe_Z);
	this.emit_gcode("G0 X0 Y0");
}

SBPRuntime.prototype.JS = function(args) {
	this.emit_gcode("F" + args[0]);
}

/* CUTS */

/* ZERO */

SBPRuntime.prototype.ZX = function(args) {
//	this.emit_gcode("G10 L2 P2 X?");
 	this.emit_gcode("G54");
}

SBPRuntime.prototype.ZY = function(args) {
//	this.emit_gcode("G10 L2 P2 Y?");
 	this.emit_gcode("G54");
}

SBPRuntime.prototype.ZZ = function(args) {
//	this.emit_gcode("G10 L2 P2 Z?");
 	this.emit_gcode("G54");
}

SBPRuntime.prototype.ZA = function(args) {
//	this.emit_gcode("G10 L2 P2 A?");
 	this.emit_gcode("G54");
}

SBPRuntime.prototype.ZB = function(args) {
//	this.emit_gcode("G10 L2 P2 B?");
 	this.emit_gcode("G54");
}

SBPRuntime.prototype.ZC = function(args) {
//	this.emit_gcode("G10 L2 P2 Z?");
 	this.emit_gcode("G54");
}

SBPRuntime.prototype.Z2 = function(args) {
//	this.emit_gcode("G10 L2 P2 X? Y?");
 	this.emit_gcode("G54");
}

SBPRuntime.prototype.Z3 = function(args) {
//	this.emit_gcode("G10 L2 P2 X? Y? Z?");
 	this.emit_gcode("G54");
}

SBPRuntime.prototype.Z4 = function(args) {
//	this.emit_gcode("G10 L2 P2 X? Y? Z? A?");
 	this.emit_gcode("G54");
}

SBPRuntime.prototype.Z5 = function(args) {
//	this.emit_gcode("G10 L2 P2 X? Y? Z? A? B?");
 	this.emit_gcode("G54");
}

SBPRuntime.prototype.Z6 = function(args) {
//	this.emit_gcode("G10 L2 P2 X? Y? Z? A? B? C?");
 	this.emit_gcode("G54");
}

SBPRuntime.prototype.ZT = function(args) {
//	this.emit_gcode("G28.1");
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

runtime = new SBPRuntime();
runtime.runFileSync('example.sbp');
console.log(runtime.user_vars);


