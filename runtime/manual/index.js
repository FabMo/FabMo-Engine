var log = require('../../log').logger('manual');
var config = require('../../config');
var stream = require('stream');

var T_RENEW = 200;
var SAFETY_FACTOR = 2.0;
var RENEW_SEGMENTS = 10;
var FIXED_MOVES_QUEUE_SIZE = 3;

function ManualRuntime() {
	this.machine = null;
	this.driver = null;
	this.fixedQueue = [];
}

ManualRuntime.prototype.toString = function() {
	return "[ManualRuntime]";
}

//Check if auth is neeeded to execute code
ManualRuntime.prototype.needsAuth = function(s) {
	//all manual needs auth (check) so just return true
	return true;
}

ManualRuntime.prototype.connect = function(machine) {
	this.machine = machine;
	this.driver = machine.driver;
	this.ok_to_disconnect = true;
	this.machine.setState(this, "manual");

	// True while the tool is known to be in motion
	this.moving = false;

	// True while the user intends (as far as we know) for the tool to continue moving
	this.keep_moving = false;

	// Current trajectory
	this.current_axis = null;
	this.current_speed = null;
	this.completeCallback = null;
	this.status_handler = this._onG2Status.bind(this);
	this.driver.on('status',this.status_handler);
};

ManualRuntime.prototype.disconnect = function() {
	if(this.ok_to_disconnect && !this.stream) {
		this.driver.removeListener('status', this.status_handler);
		//this._changeState("idle");
	} else {
		throw new Error("Cannot disconnect while manually driving the tool.");
	}
};

ManualRuntime.prototype._changeState = function(newstate, message) {
	if(newstate === "idle") {
		this.ok_to_disconnect = true;
		var callback = this.completeCallback || function() {};
		this.completeCallback = null;
	} else {
		this.ok_to_disconnect = false;
	}
	this.machine.setState(this, newstate, message);
};

ManualRuntime.prototype._limit = function() {
	var er = this.driver.getLastException();
	if(er && er.st == 203) {
		var msg = er.msg.replace(/\[[^\[\]]*\]/,'');
		this.keep_moving = false;
		this.moving = false;
		this.driver.clearLastException();
		this._changeState('stopped', {error : msg});
		return true;
	}
	return false;
}


ManualRuntime.prototype._onG2Status = function(status) {

	switch(status.stat) {
		case this.driver.STAT_INTERLOCK:
		case this.driver.STAT_SHUTDOWN:
		case this.driver.STAT_PANIC:
			return this.machine.die('A G2 exception has occurred. You must reboot your tool.');
			break;
		case this.driver.STAT_ALARM:
			if(this._limit()) { return; }
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


ManualRuntime.prototype.executeCode = function(code, callback) {
	this.completeCallback = callback;
	//log.debug("Recieved manual command: " + JSON.stringify(code));

	// Don't honor commands if we're not in a position to do so
	switch(this.machine.status.state) {
		case "stopped":
			return;
	}

	switch(code.cmd) {
		case 'start':
			this.startMotion(code.axis, code.speed);
			break;

		case 'stop':
			this.stopMotion();
			break;

		case 'maint':
			this.maintainMotion();
			break;

		case 'fixed':
			this.fixedMove(code.axis, code.speed, code.dist);
			break;

		default:
			log.error("Don't know what to do with '" + code.cmd + "' in manual command.");
			break;
	}
}

ManualRuntime.prototype.maintainMotion = function() {
	if(this.moving) {
		this.keep_moving = true;
	}
}

/*
 * Called to set the tool into motion.
 * If the tool is already moving, the flag is set to maintain that motion
 */
ManualRuntime.prototype.startMotion = function(axis, speed) {
	var jerkXY = config.machine._cache.manual.xy_jerk || 250;
	var jerkZ = config.machine._cache.manual.z_jerk || 250;
	var dir = speed < 0 ? -1.0 : 1.0;
	speed = Math.abs(speed);
	if(this.moving) {
		if(axis === this.currentAxis && speed === this.currentSpeed) {
			this.maintainMotion();
		} else {
			// Deal with direction changes here
		}
	} else {
		
		// Set Heading
		this.currentAxis = axis;
		this.currentSpeed = speed;
		this.currentDirection = dir;

		// Compute the
		this.renewDistance = speed*(T_RENEW/60000)*SAFETY_FACTOR;

		if(!this.stream) {
			this.stream = new stream.PassThrough();
			this._changeState("manual");
			this.moving = this.keep_moving = true;
			this.driver.runStream(this.stream).then(function(stat) {
                config.driver.restoreSome(['xjm','yjm','zjm'], function() {
				    log.info("Finished running stream: " + stat);
				    this.moving = false;
				    this.keep_moving = false;
				    this.stream = null;
				    this._changeState("idle");
                }.bind(this));
			}.bind(this));
		} else {
			throw new Error("Trying to create a new motion stream when one already exists!");
		}
        this.stream.write('M100.1 ({xjm:'+jerkXY+'})\n');
        this.stream.write('M100.1 ({yjm:'+jerkXY+'})\n');
        this.stream.write('M100.1 ({zjm:'+jerkZ+'})\n');
		this.stream.write('G91 F' + this.currentSpeed.toFixed(3) + '\n');
		this.renewMoves();
	}
};

ManualRuntime.prototype.renewMoves = function() {
	if(this.moving && this.keep_moving) {
		this.keep_moving = false;
		var segment = this.currentDirection*(this.renewDistance / RENEW_SEGMENTS);
		for(var i=0; i<RENEW_SEGMENTS; i++) {
			var move = 'G1 ' + this.currentAxis + segment.toFixed(5) + '\n'
			this.stream.write(move);
		}
		this.driver.prime();
		setTimeout(function() {
			this.renewMoves()
		}.bind(this), T_RENEW)
	} else {
			this.stopMotion();
	}
}

ManualRuntime.prototype.stopMotion = function() {
	if(this._limit()) { return; }
	this.keep_moving = false;
	this.quit();
}

ManualRuntime.prototype.fixedMove = function(axis, speed, distance) {
	if(this.fixedQueue.length >= FIXED_MOVES_QUEUE_SIZE) {
        return;
    }
    if(this.moving) {
		this.fixedQueue.push({axis: axis, speed: speed, distance: distance});
		log.warn("fixedMove(): Queueing move, due to already moving.");
	} else {
		this.moving = true;
		var axis = axis.toUpperCase();
		if('XYZABCUVW'.indexOf(axis) >= 0) {
			var moves = ['G91'];
			if(speed) {
				moves.push('G1 ' + axis + distance.toFixed(5) + ' F' + speed.toFixed(3))
			} else {
				moves.push('G0 ' + axis + distance.toFixed(5) + ' F' + speed.toFixed(3))
			}
			this.driver.runList(moves).then(function(stat) {
				this.moving = false;
				if(this.fixedQueue.length > 0) {
					var move = this.fixedQueue.shift();
					setImmediate(this.fixedMove.bind(this), move.axis, move.speed, move.distance)
				} else {
				    this.moving = false;
				    this.keep_moving = false;
				    this.stream = null;
				    this._changeState("idle");
				}
			}.bind(this));
		}
	}
}

ManualRuntime.prototype.pause = function() {
	this.driver.feedHold();
}

ManualRuntime.prototype.quit = function() {
	if(this.moving) {
		this.driver.quit();
	}
	if(this.stream) {
		this.stream.end();
	}
}

ManualRuntime.prototype.resume = function() {
	this.driver.resume();
}


exports.ManualRuntime = ManualRuntime;
