var log = require('../log').logger('manual');

var T_RENEW = 500;
var SAFETY_FACTOR = 1.25;
var RENEW_SEGMENTS = 15;

function ManualRuntime() {
	this.machine = null;
	this.driver = null;
}

ManualRuntime.prototype.connect = function(machine) {
	this.machine = machine;
	this.driver = machine.driver;
	this.machine.setState(this, "manual");
	this.moving = false;
	this.keep_moving = false;
	this.current_axis = null;
	this.current_speed = null;
	this.status_handler =  this._onG2Status.bind(this);
	this.driver.on('status',this.status_handler);
};

ManualRuntime.prototype.disconnect = function() {
	this.driver.removeListener('status', this.status_handler);
	this._changeState("idle");
};

ManualRuntime.prototype._changeState = function(newstate) {
	this.machine.setState(this, newstate);
};

ManualRuntime.prototype._onG2Status = function(status) {
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
	}
	this.machine.emit('status',this.machine.status);
};


ManualRuntime.prototype.executeCode = function(code) {
	log.debug("Recieved manual command: " + JSON.stringify(code));
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
		default:
			log.error("Don't know what to do with '" + code.cmd + "' in manual command.")
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
		log.debug("Already moving");
		if(axis === this.currentAxis && speed === this.currentSpeed) {
			this.maintainMotion();
		} else {
			// Deal with direction changes here
		}
	} else {
		this.currentAxis = axis;
		this.currentSpeed = speed;
		this.currentDirection = dir;
		this.renewDistance = speed*(T_RENEW/60000)*SAFETY_FACTOR;
		this.moving = this.keep_moving = true;
		this.renewMoves();
	}
};

ManualRuntime.prototype.renewMoves = function() {
	if(this.keep_moving) {
		this.keep_moving = false;
		var segment = this.currentDirection*(this.renewDistance / RENEW_SEGMENTS);
		var move = 'G91 F' + this.currentSpeed.toFixed(3) + '\n';
		for(var i=0; i<RENEW_SEGMENTS; i++) {
			move += ('G1 ' + this.currentAxis + segment.toFixed(5) + '\n');
		}
		this.driver.gcodeWrite(move);
		setTimeout(this.renewMoves.bind(this), T_RENEW)		
	} else {
		this.moving = false;
		this.keep_moving = false;
		this.driver.quit();
	}
}

ManualRuntime.prototype.stopMotion = function() {
	this.keep_moving = false;
	this.moving = false;
	this.driver.quit();
}

ManualRuntime.prototype.pause = function() {
	this.driver.feedHold();
}


exports.ManualRuntime = ManualRuntime;
