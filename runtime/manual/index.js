var log = require('../../log').logger('manual');
var config = require('../../config');

var T_RENEW = 500;
var SAFETY_FACTOR = 5;
var RENEW_SEGMENTS = 4;

function ManualRuntime() {
	this.machine = null;
	this.driver = null;
}

ManualRuntime.prototype.toString = function() {
	return "[ManualRuntime]";
}

ManualRuntime.prototype.connect = function(machine) {
	this.machine = machine;
	this.driver = machine.driver;
	this.ok_to_disconnect = true;
	this.machine.setState(this, "manual");
	this.moving = false;
	this.keep_moving = false;
	this.current_axis = null;
	this.current_speed = null;
	this.status_handler =  this._onG2Status.bind(this);
	this.completeCallback = null;
	this.driver.on('status',this.status_handler);
};

ManualRuntime.prototype.disconnect = function() {
	if(this.ok_to_disconnect) {
		log.info("Disconnecting manual runtime");
		this.driver.removeListener('status', this.status_handler);
		this._changeState("idle");
	} else {
		throw new Error("Cannot disconnect while manually driving the tool.");
	}
};

ManualRuntime.prototype._changeState = function(newstate, message) {
	if(newstate === "idle") {
		this.ok_to_disconnect = true;
		var callback = this.completeCallback || function() {};
		this.completeCallback = null;
		config.driver.restoreSome(['zl'], callback)
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

	switch(this.machine.status.state) {
		case "not_ready":
			// This shouldn't happen.
			log.error("WAT.");
			break;

		case "manual":
			if(status.stat === this.driver.STAT_HOLDING && status.stat === 0) {
				this._changeState("paused");
				break;
			}

			if((status.stat === this.driver.STAT_STOP || status.stat === this.driver.STAT_END) && status.hold === 0) {
				this._changeState("idle");
				break;
			}
			break;

		case "paused":
			if((status.stat === this.driver.STAT_STOP || status.stat === this.driver.STAT_END) && status.hold === 0) {
				this._changeState("idle");
				break;
			}
			break;

		case "idle":
			if(status.stat === this.driver.STAT_RUNNING) {
				this._changeState("manual");
				break;
			}
			break;

		case "stopped":
			switch(status.stat) {
				case this.driver.STAT_STOP:
				case this.driver.STAT_END:
					this._changeState("idle");
					break;
			}
			break;

	}
	this.machine.emit('status',this.machine.status);
};


ManualRuntime.prototype.executeCode = function(code, callback) {
	this.completeCallback = callback;
	log.debug("Recieved manual command: " + JSON.stringify(code));

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
	this.keep_moving = true;
}

/*
 * Called to set the tool into motion.
 * If the tool is already moving, the flag is set to maintain that motion
 */
ManualRuntime.prototype.startMotion = function(axis, speed) {
	var dir = speed < 0 ? -1.0 : 1.0;
	speed = Math.abs(speed);
	if(this.moving) {
		log.debug("startMotion: Already moving");
		if(axis === this.currentAxis && speed === this.currentSpeed) {
			this.maintainMotion();
		} else {
			// Deal with direction changes here
		}
	} else {
		log.debug("startMotion: Not moving yet.")
		this.currentAxis = axis;
		this.currentSpeed = speed;
		this.currentDirection = dir;
		this.renewDistance = speed*(T_RENEW/60000)*SAFETY_FACTOR;
		this.moving = this.keep_moving = true;
		this.driver.set('zl',0,function() {
			this.renewMoves();
		}.bind(this));
	}
};

ManualRuntime.prototype.renewMoves = function() {
	if(this.keep_moving) {
		this.keep_moving = false;
		var segment = this.currentDirection*(this.renewDistance / RENEW_SEGMENTS);
		var moves = ['G91 F' + this.currentSpeed.toFixed(3)]
		for(var i=0; i<RENEW_SEGMENTS; i++) {
			moves.push('G1 ' + this.currentAxis + segment.toFixed(5) + '\n');
		}
		this.driver.runGCodes(moves);
		setTimeout(this.renewMoves.bind(this), T_RENEW)
	} else {
		if(this.moving) {
			this.stopMotion();
		}
//		if(this.machine.status.state != "stopped") {
//			this.stopMotion();
//		}
	}
}

ManualRuntime.prototype.stopMotion = function() {
	if(this._limit()) { return; }
	if(this.moving) {
		log.debug("Runtime stopMotion()");
		log.stack();

		this.keep_moving = false;
		this.moving = false;

		this.driver.quit();
	}
}

ManualRuntime.prototype.fixedMove = function(axis, speed, distance) {
	if(this.moving) {
		log.warn("fixedMove: Already moving");
	} else {
		var axis = axis.toUpperCase();
		if('XYZABCUVW'.indexOf(axis) >= 0) {
			if(speed) {
				var moves = ['G91','G1 ' + axis + distance.toFixed(5) + ' F' + speed.toFixed(3)];
			} else {
				var moves = ['G91', 'G0 ' + axis + distance.toFixed(5)];
			}
			this.driver.runGCodes(moves);
		}
	}
}

ManualRuntime.prototype.pause = function() {
	this.driver.feedHold();
}

ManualRuntime.prototype.quit = function() {
	log.debug("Runtime quit()");
	this.driver.quit();
}

ManualRuntime.prototype.resume = function() {
	this.driver.resume();
}


exports.ManualRuntime = ManualRuntime;
