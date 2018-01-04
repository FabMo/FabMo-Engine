var log = require('../../log').logger('manual');
var config = require('../../config');
var stream = require('stream');
var util = require('util');
var events = require('events')
var Q = require('q');

var T_RENEW = 200;
var SAFETY_FACTOR = 2.0;
var RENEW_SEGMENTS = 10;
var FIXED_MOVES_QUEUE_SIZE = 3;


function ManualDriver(drv, st) {
	this.stream = st;
	this.driver = drv;

	this.fixedQueue = [];

	this.exited = false;

	// True while the tool is known to be in motion
	this.moving = false;

	// True while the user intends (as far as we know) for the tool to continue moving
	this.keep_moving = false;

	// Set to true to exit the manual state once the current operation is completed
	this.exit_pending = false;

	this.stop_pending = false;

	// Current trajectory
	this.current_axis = null;
	this.current_speed = null;
	this.completeCallback = null;
	this.status_handler = this._onG2Status.bind(this);
	this.driver.on('status',this.status_handler);
//	var this.deferred = this.enter();
}
util.inherits(ManualDriver, events.EventEmitter);

ManualDriver.prototype.enter = function() {
	var jerkXY = config.machine._cache.manual.xy_jerk || 250;
	var jerkZ = config.machine._cache.manual.z_jerk || 250;
    this.stream.write('M100.1 ({xjm:'+jerkXY+'})\n');
    this.stream.write('M100.1 ({yjm:'+jerkXY+'})\n');
    this.stream.write('M100.1 ({zjm:'+jerkZ+'})\n');	
    this.stream.write('M100.1 ({zl:0})\n');	

	this.deferred = Q.defer();
	return this.deferred.promise;

}

ManualDriver.prototype.exit = function() {
	if(this.isMoving()) {
		// Don't exit yet - just pend.
		this.exit_pending = true;
		this.stopMotion();

	} else {
		config.driver.restoreSome(['xjm','yjm','zjm', 'zl'], function() {
		    //log.info("Finished running stream: " + stat);
		    this._done();
        }.bind(this));
		this.driver.removeListener('status', this.status_handler);
		this.exited = true;
		this.deferred.resolve();
	}
}

ManualDriver.prototype.startMotion = function(axis, speed) {
	log.debug("startMotion called")
	var dir = speed < 0 ? -1.0 : 1.0;
	speed = Math.abs(speed);
	if(this.moving) {
		log.debug("Already moving")
		if(axis === this.currentAxis && speed === this.currentSpeed) {
			this.maintainMotion();
		} else {
			this.stopMotion();
			// Deal with direction changes here
		}
	} else {
		log.debug("Not moving")
		// Set Heading
		this.currentAxis = axis;
		this.currentSpeed = speed;
		this.currentDirection = dir;
		this.moving = this.keep_moving = true;
		this.renewDistance = speed*(T_RENEW/60000)*SAFETY_FACTOR;                
		this.stream.write('G91 F' + this.currentSpeed.toFixed(3) + '\n');
		this._renewMoves();
	}
}

ManualDriver.prototype.maintainMotion = function() {
	if(this.moving) {
		this.keep_moving = true;
	}
}

ManualDriver.prototype.stopMotion = function() {
	if(this._limit()) { return; }
	this.keep_moving = false;
	if(this.moving) {
		this.stop_pending = true;
		this.driver.feedHold();
		this.driver.queueFlush(function() {
			this.driver.resume();		
		}.bind(this));
	} else {
		this.stop_pending = false;
	}
}

ManualDriver.prototype.goto = function(pos) {

}

ManualDriver.prototype._handleNudges = function() {
	var count = this.fixedQueue.length;

	if(this.fixedQueue.length > 0) {
		while(this.fixedQueue.length > 0) {
			var move = this.fixedQueue.shift();
			this.moving = true;
			this.keep_moving = false;
			var axis = move.axis.toUpperCase();
			if('XYZABCUVW'.indexOf(axis) >= 0) {
				var moves = ['G91'];
				if(move.speed) {
					moves.push('G1 ' + axis + move.distance.toFixed(5) + ' F' + move.speed.toFixed(3))
				} else {
					moves.push('G0 ' + axis + move.distance.toFixed(5) + ' F' + move.speed.toFixed(3))
				}

				moves.forEach(function(move) {
					this.stream.write(move + '\n');
					//this.stream.write('G4 P0.050\n');
				}.bind(this));
			}
		}
		this.driver.prime();
	} else {
		this.moving = this.keep_moving = false;
	}
	return count;
}

ManualDriver.prototype.nudge = function(axis, speed, distance) {
    if(this.fixedQueue.length >= FIXED_MOVES_QUEUE_SIZE) {
	log.warn('fixedMove(): Move queue is already full!');
    	    return;
    }
	this.fixedQueue.push({axis: axis, speed: speed, distance: distance});
    if(this.moving) {
	//	this.fixedQueue.push({axis: axis, speed: speed, distance: distance});
		log.warn("fixedMove(): Queueing move, due to already moving.");
	} else {
		this._handleNudges();
	}
}

ManualDriver.prototype.isMoving = function() {
	return this.moving;
}


ManualDriver.prototype._renewMoves = function() {
	if(this.moving && this.keep_moving) {
		log.debug('Renewing moves because of reasons')
		this.keep_moving = false;
		var segment = this.currentDirection*(this.renewDistance / RENEW_SEGMENTS);
		//console.log("Paused? ", this.driver.context._paused);
		//console.log("Flooded? ", this.driver.flooded);
		//console.log(this.driver.getInfo())
		//this.driver.resume();
		for(var i=0; i<RENEW_SEGMENTS; i++) {
			var move = 'G1 ' + this.currentAxis + segment.toFixed(5) + '\n'
			this.stream.write(move);
		}
		this.driver.prime();
		setTimeout(function() {
			this._renewMoves()
		}.bind(this), T_RENEW)
	} else {
		this.stopMotion();
	}
}

ManualDriver.prototype._onG2Status = function(status) {

	switch(status.stat) {
		case this.driver.STAT_INTERLOCK:
		case this.driver.STAT_SHUTDOWN:
		case this.driver.STAT_PANIC:
			this.emit('crash');
			break;
		case this.driver.STAT_ALARM:
			if(this._limit()) { return; }
			break;
		case this.driver.STAT_STOP:
		case this.driver.STAT_END:
		case this.driver.STAT_HOLDING:
			if(this._handleNudges()) {
				// Nudges got handled
			} else {
				// No nudges
				if(this.exit_pending) {
					this.exit();
				}
				this.stop_pending = false;
			}
			break;
	}
};

ManualDriver.prototype._limit = function() {
	var er = this.driver.getLastException();
	if(er && er.st == 203) {
		var msg = er.msg.replace(/\[[^\[\]]*\]/,'');
		this.keep_moving = false;
		this.moving = false;
		this.driver.clearLastException();
		this.emit('crash', {error : msg});
		return true;
	}
	return false;
}

ManualDriver.prototype._done = function() {
	this.moving = false;
    this.keep_moving = false;
    this.stream = null;
}


module.exports = ManualDriver;