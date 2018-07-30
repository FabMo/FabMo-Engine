var log = require('../../log').logger('manual');
var config = require('../../config');
var stream = require('stream');
var util = require('util');
var events = require('events')
var Q = require('q');

var T_RENEW = 250;
var SAFETY_FACTOR = 1.75;
var count;
var RENEW_SEGMENTS = 10;
var FIXED_MOVES_QUEUE_SIZE = 3;
var count = 0;


function ManualDriver(drv, st) {
	this.stream = st;
	this.driver = drv;
	this.renew_timer = null;
	this.fixedQueue = [];

	this.exited = false;

	// True while the tool is known to be in motion
	this.moving = false;

	// True while the user intends (as far as we know) for the tool to continue moving
	this.keep_moving = false;

	// Set to true to exit the manual state once the current operation is completed
	this.exit_pending = false;

	this.stop_pending = false;

	this.omg_stop = false;

	// Current trajectory
	this.current_axis = null;
	this.current_speed = null;
	this.completeCallback = null;
	this.status_handler = this._onG2Status.bind(this);
	this.driver.on('status',this.status_handler);
}
util.inherits(ManualDriver, events.EventEmitter);

ManualDriver.prototype.enter = function() {
	var jerkXY = config.machine._cache.manual.xy_jerk || 250;
	var jerkZ = config.machine._cache.manual.z_jerk || 250;
    this.stream.write('M100.1 ({xjm:'+jerkXY+'})\n');
    this.stream.write('M100.1 ({yjm:'+jerkXY+'})\n');
    this.stream.write('M100.1 ({zjm:'+jerkZ+'})\n');	
	this.stream.write('M100.1 ({zl:0})\nM0\n G4 P0.1\n');	
	this.driver.prime();
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
	}
}

ManualDriver.prototype.startMotion = function(axis,  speed, second_axis, second_speed) {
	var dir = speed < 0 ? -1.0 : 1.0;
	var second_dir = second_speed < 0 ? -1.0 : 1.0;
	speed = Math.abs(speed);
	if(this.stop_pending || this.omg_stop) {
		return;
	}
	if(this.moving) {
		if(axis === this.currentAxis && speed === this.currentSpeed) {
			this.maintainMotion();
		} else {
			this.stopMotion();
			// Deal with direction changes here
		}
	} else {
		if (second_axis){
			this.second_axis = second_axis;
			this.second_currentDirection = second_dir;
		} else {
			this.second_axis = null;
			this.second_currentDirection = null;
		}
		// Set Heading
		this.currentAxis = axis;
		this.currentSpeed = speed;
		this.currentDirection = dir;

		this.moving = this.keep_moving = true;
		this.renewDistance = speed*(T_RENEW/60000)*SAFETY_FACTOR;                
		this.stream.write('G91 F' + this.currentSpeed.toFixed(3) + '\n');
		this._renewMoves("start");
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
	if(this.renew_timer) {
		clearTimeout(this.renew_timer);
	}
	this.omg_stop = true
	this.stop_pending = true;
	this.driver.feedHold();
	this.driver.queueFlush(function() {
		this.driver.resume();		
	}.bind(this));
}

ManualDriver.prototype.quitMove = function(){
	
	if(this._limit()) { return; }
	this.keep_moving = false;
	if(this.moving) {
		this.stop_pending = true;
		this.driver.quit();
		this.driver.queueFlush(function() {
			this.driver.resume();		
		}.bind(this));
	} else {
		this.stop_pending = false;
	}

}

ManualDriver.prototype.goto = function(pos) {
	var move = "G90\nG0 ";

	for (var key in pos) {
		if (pos.hasOwnProperty(key)) {
			move += key + pos[key] + " ";
		}
	}
	move += "\nM0\nG91\n";
	this.driver.prime();
	this.stream.write(move);
}

ManualDriver.prototype.set = function(pos) {
	
	var gc = 'G10 L20 P2 ';

	Object.keys(pos).forEach(function(key) {
		gc += key + pos[key].toFixed(5);
	}.bind(this));
	
		this.stream.write(gc + "\nM0\nG91\n");
		this.driver.prime();
		setTimeout(function() {
			config.driver.reverseUpdate(['g55x','g55y','g55z','g55a','g55b'], function(err, data) {});
		}.bind(this), 500);

}

ManualDriver.prototype._handleNudges = function() {
	count = this.fixedQueue.length;

	if(this.fixedQueue.length > 0) {
		while(this.fixedQueue.length > 0) {
			var move = this.fixedQueue.shift();
			this.moving = true;
			this.keep_moving = false;
			var axis = move.axis.toUpperCase();

			if('XYZABCUVW'.indexOf(axis) >= 0) {
				var moves = ['G91'];
				if(move.second_axis) {
					var second_axis = move.second_axis.toUpperCase();
					if(move.speed) {
						moves.push('G1 ' + axis + move.distance.toFixed(5) +' '+ second_axis + move.second_distance.toFixed(5) + ' F' + move.speed.toFixed(3))
					} else {
						moves.push('G0 ' + axis + move.distance.toFixed(5)  +' '+ move.second_axis.toUpperCase + move.second_distance.toFixed(5) + ' F' + move.speed.toFixed(3))
					}
				} else {
					if(move.speed) {
						moves.push('G1 ' + axis + move.distance.toFixed(5) + ' F' + move.speed.toFixed(3))
					} else {
						moves.push('G0 ' + axis + move.distance.toFixed(5) + ' F' + move.speed.toFixed(3))
					}
				}
				
				// You can't put an M0 or a G4 in here to break up the nudges.
				// Don't do it. Doooon't do it.
				moves.forEach(function(move) {
					this.stream.write(move + '\n');
				}.bind(this));
			}
		}
		this.driver.prime();
	} else {
		this.moving = this.keep_moving = false;
	}
	return count;
}

ManualDriver.prototype.nudge = function(axis, speed, distance, second_axis, second_distance) {
    if(this.fixedQueue.length >= FIXED_MOVES_QUEUE_SIZE) {
	log.warn('fixedMove(): Move queue is already full!');
    	    return;
	}
	if(second_axis) {
		this.fixedQueue.push({axis: axis, speed: speed, distance: distance, second_axis : second_axis, second_distance: second_distance});
	} else {
		this.fixedQueue.push({axis: axis, speed: speed, distance: distance});
	}

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


ManualDriver.prototype._renewMoves = function(reason) {
	if(this.moving && this.keep_moving) {
		this.keep_moving = false;
		var segment = this.currentDirection*(this.renewDistance / RENEW_SEGMENTS);
		var second_segment = this.second_currentDirection*(this.renewDistance / RENEW_SEGMENTS);
		var moves = []
		if (this.second_axis){
			for(var i=0; i<RENEW_SEGMENTS; i++) {
				var move = 'G1 ' + this.currentAxis + segment.toFixed(5) +' '+ this.second_axis + second_segment.toFixed(5) +'\n'
				moves.push(move);
			}

		} else {
			for(var i=0; i<RENEW_SEGMENTS; i++) {
				var move = 'G1 ' + this.currentAxis + segment.toFixed(5) + '\n'
				moves.push(move);
			}
		}
		this.stream.write(moves.join('\n'));	
		this.driver.prime();
		this.renew_timer = setTimeout(function() {
			this._renewMoves("timeout")
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
		case this.driver.STAT_RUNNING:
			this.moving = true;
			if(this.omg_stop) {
				this.stop_pending = true;
				this.driver.feedHold();
				this.driver.queueFlush(function() {
					this.driver.resume();		
				}.bind(this));
			}
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
				this.omg_stop = false
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
	this.deferred.resolve();
}


module.exports = ManualDriver;
