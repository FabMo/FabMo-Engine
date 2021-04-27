/*
 * runtime/manual/driver.js
 * 
 * This module defines ManualDriver, which is a helper object that manages
 * manual control of the machine.  It is the real implementation for the ManualRuntime
 * but exists as a helper so that it can be used inside of other runtimes that need to use the
 * manual state, and want to do it in the same way that the manual runtime does.
 */
var log = require('../../log').logger('manual');
var config = require('../../config');
var stream = require('stream');
var util = require('util');
var events = require('events')
var Q = require('q');

// Parameters related to filling the queue, motion, etc.
// These are fussy.
var T_RENEW = 300;
var SAFETY_FACTOR = 4.0;
// TODO should be in the ManualDriver instance?!
var count;
var RENEW_SEGMENTS = 10;
var FIXED_MOVES_QUEUE_SIZE = 3;
var count = 0;


// ManualDriver constructor
// The manual driver provides functions for managing the state of the G2 driver while "manually"
// streaming commands to it, as is done when in "pendant" mode or similar
//   drv - The driver instance to manage
//    st - An open stream feeding into an active machining cycle on that driver
function ManualDriver(drv, st, mode) {
	this.stream = st;
	this.driver = drv;
	this.renew_timer = null;
	this.movement_timer = null;
	this.fixedQueue = [];
	this.entered = false;
	this.exited = false;

	// True while the tool is known to be in motion
	this.moving = false;

	// True while the user intends (as far as we know) for the tool to continue moving
	this.keep_moving = false;

	// Set to true to exit the manual state once the current operation is completed
	this.exit_pending = false;
	this.stop_pending = false;
	this.omg_stop = false;

	// The default mode is "normal" (feed the queue with constant movement along a vector)
	if(mode === 'raw') {
		this.mode = 'raw';
	} else {
		this.mode = 'normal';
	}

	// Current trajectory
	this.current_axis = null;
	this.current_speed = null;
	this.completeCallback = null;
	this.status_handler = this._onG2Status.bind(this);

	// Setup to process status reports from G2
	this.driver.on('status',this.status_handler);
}
util.inherits(ManualDriver, events.EventEmitter);

// Enter the machining cycle
// This does a little setup too (sets manual state jerk values, etc)
// TODO: Pass the setup stuff in?  (In case runtimes want to do things differently?)
// Returns a promise that resolves on exit
ManualDriver.prototype.enter = function() {
	if(this.entered) { return; }
	this.driver.manual_hold = true;
	switch(this.mode) {
		case 'normal':
			// Retrieve the manual-mode-specific jerk settings and apply them (temporarily) for this manual session
			var jerkXY = config.machine._cache.manual.xy_jerk || 250;
			var jerkZ = config.machine._cache.manual.z_jerk || 250;
		    this.stream.write('M100.1 ({xjm:'+jerkXY+'})\n');
		    this.stream.write('M100.1 ({yjm:'+jerkXY+'})\n');
		    this.stream.write('M100.1 ({zjm:'+jerkZ+'})\n');	
			// Turn off z-lift, set incremental mode, and send a 
			// "dummy" move to prod the machine into issuing a status report
			this.stream.write('M100.1 ({zl:0})\nM0\nG91\n G0 X0 Y0 Z0\n');	
			this.driver.prime();		
			break;
		case 'raw':
			this.stream.write('M100.1 ({zl:0})\nM0\n');
			this.driver.prime();		
		break;
		default:
			log.warn('Unknown manual drive mode on enter: ' + this.mode);
		break;
	}
	this.entered = true;
	this.deferred = Q.defer();

	return this.deferred.promise;
}

// Exit the machining cycle
// This stops motion if it is in progress, and restores the settings changed in enter()
////## Exiting from normal and raw now done the same; but left stubbed separately for potential divergence
ManualDriver.prototype.exit = function() {
	if(this.isMoving()) {
		// Don't exit yet - just pend.
		log.debug('Pending the exit');
		this.exit_pending = true;
		this.stopMotion();
	} else {
		log.debug('Executing immediate exit')
		this.driver.manual_hold = false;
		switch(this.mode) {
			case 'normal':
				config.driver.restoreSome(['xjm','yjm','zjm', 'zl'], function() {
				    this._done();
		        }.bind(this));			
				log.debug("===> setting to exact path")
		        this.stream.write('G61\n'); ////## making sure not left in exact stop mode
				this.stream.write('M30\n');
				////## added to maintain line number priming in all scenarios ...
				this.driver.queueFlush(function() {
					this.driver.resume();		
				}.bind(this));
		        break;
			case 'raw':
				config.driver.restoreSome(['xjm','yjm','zjm', 'zl'], function() {
				    this._done();
		        }.bind(this));			
				log.debug("===> setting to exact path; raw stop?")
		        this.stream.write('G61\n'); ////## making sure not left in exact stop mode
				this.stream.write('M30\n');
				////## added to maintain line number priming in all scenarios ...
				this.driver.queueFlush(function() {
					this.driver.resume();		
				}.bind(this));
				break;
			default:
				log.warn('Unknown manual drive mode on exit: ' + this.mode);
				break;
		}
		this.driver.removeListener('status', this.status_handler);
		this.exited = true;
		this._done();
	}
}

// Start motion on the specified axis (and optional second axis) at the specified speed
// TODO - This function should really just take an arbitrary vector
//           axis - The first axis to move (eg "X")
//          speed - The speed in current units
//    second_axis - The second axis to move
//   second_speed - The second axis speed
ManualDriver.prototype.startMotion = function(axis,  speed, second_axis, second_speed) {
	var dir = speed < 0 ? -1.0 : 1.0;
	var second_dir = second_speed < 0 ? -1.0 : 1.0;
	speed = Math.abs(speed);
	// Raw mode doesn't accept start motion command
	if(this.mode != 'normal') {
		throw new Error('Cannot start movement in ' + this.mode + ' mode.');
	}

	// Don't start motion if we're in the middle of stopping (can do it from stopped, though)
	if(this.stop_pending || this.omg_stop) {
		return;
	}
	
	// If we're moving already, maintain motion
	if(this.moving) {
		if(axis === this.currentAxis && speed === this.currentSpeed) {
			this.maintainMotion();
		} else {
			this.stopMotion();
			// TODO Deal with direction changes here
		}
	} else {
		// Deal with one axis vs 2 (See TODO above)
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

		// Flag that we're kicking off a move
		this.moving = this.keep_moving = true;

		// Length of the moves we pump the queue with, based on speed vector
		this.renewDistance = speed*(T_RENEW/60000)*SAFETY_FACTOR;                
		// Make sure we're in relative moves and the speed is set
////##		this.stream.write('G91 F' + this.currentSpeed.toFixed(3) + '\n');
		log.debug("===> setting to exact path")
		this.stream.write('G91 F' + this.currentSpeed.toFixed(3) + '\n' + 'G61' + '\n');

		// Start pumping moves
		this._renewMoves("start");
	}

}

// Set the flag that indicates to this driver that motion is still requested along the current heading
// This function only has any effect if the machine is already moving
ManualDriver.prototype.maintainMotion = function() {
	if(this.moving) {
		this.keep_moving = true;
	}
}

// Stop all movement 
ManualDriver.prototype.stopMotion = function() {
	if(this._limit()) { return; }
 	this.stop_pending = true;       ////## queue not clearing right ... testing
	this.keep_moving = false;
	if(this.renew_timer) {
		clearTimeout(this.renew_timer);
	}
	this.omg_stop = true;
    this.driver.manualFeedHold();
	this.driver.queueFlush(function() {
		this.driver.resume();		
	}.bind(this));
}

// Stop all movement (also? TODO: What's this all about?)
ManualDriver.prototype.quitMove = function() {
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

ManualDriver.prototype.runGCode = function(code) {
	if(this.mode == 'raw') {
		this.driver.mode = 'raw';
		if(this.moving) {
			log.debug('writing gcode while moving')
			this.stream.write(code.trim() + '\n');
			this.maintainMotion()			
		} else {
			log.debug('writing gcode while static')
			this.moving = true;

			////## To debug G2 action; this kludge allows easy multiple lines with an "&" placed after each cmd
			//      in betaINSERT function of Sb4; try a "^" to kill; and a "#" to restart G2.
			log.debug("... possibly converting special codes in betaInsert");
			code = code.replace(/&/g,'\n');
			code = code.replace(/^/, '\x04\n');
			code = code.replace(/#/, '\x18\n');
			log.debug(code);

			this.stream.write(code.trim() + '\n');
			this.maintainMotion();		
			this._renewMoves('start')
		}
	} else {
		throw new Error('Cannot run gcode when in ' + this.mode + ' mode.');
	}
}

// Go to a specified absolute position
//   pos - Position vector as an object, eg: {"X":10, "Y":5}
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

// Set the machine position to the specified vector ////## meaning "location" here not move vector?
// ////## Is it possible that timing could produce an inaccurate position update here???
// ////##        ** pretty scary to reset location after zeroing and not do it by offset???
//   pos - New position vector as an object,  eg: {"X":10, "Y":5}
ManualDriver.prototype.set = function(pos) {
	var toSet = {};
	if ( this.driver.status.unit === "in" ) {  // inches
		unitConv = 0.039370079;
	} else {
		unitConv = 1;
	}
	if(this.mode === 'normal') {

		// var gc = 'G10 L20 P2 ';
		this.driver.get('mpo', function(err, MPO) {
			Object.keys(pos).forEach(function(key) {
				console.log(key);
				switch(key) {
					case "X":
						toSet.g55x = Number(((MPO.x * unitConv) - pos[key]).toFixed(5));
						break;
					case "Y":
						toSet.g55y = Number(((MPO.y * unitConv) - pos[key]).toFixed(5));
						break;
					case "Z": 
						toSet.g55z = Number(((MPO.z * unitConv) - pos[key]).toFixed(5));
						break;
					case "A":
						toSet.g55a = Number(((MPO.a* 1) - pos[key]).toFixed(5));
						break;
					case "B": 
						toSet.g55b = Number(((MPO.b* 1) - pos[key]).toFixed(5));
						break;
					default:
						log.error("don't understand axis");
				}
			}.bind(this));
			config.driver.setMany(toSet, function(err, value) {
				
				//total hack to update the positions
				this.stream.write("G91\nG0\nX0\nG91");
				this.driver.prime();
				config.driver.reverseUpdate(['g55x','g55y','g55z','g55a','g55b'], function(err, data) {});
			}.bind(this));
		}.bind(this));

	} else {
		throw new Error("Can't set from " + this.mode + ' mode.');
	}

}

// Internal function for handling nudges.
// Nudges are little fixed incremental moves that are usually initiated by a short tap on one of the
// direction keys on a pendant display, or by pressing the direction keys in a specified "fixed" mode
// If the machine is currently in the middle of a nudge or is moving in a long move, the nudge is queued,
// and executed at the end of the current move.  This is the function that dequeues and executes them.
// TODO: Like start above, nudges should be arbritrary vectors rather than axis, second_axis
// Returns the number of nudges
ManualDriver.prototype._handleNudges = function() {
	count = this.fixedQueue.length;

	if(this.fixedQueue.length > 0) {
		while(this.fixedQueue.length > 0) {
			var move = this.fixedQueue.shift();
			this.moving = true;
			this.keep_moving = false;
			var axis = move.axis.toUpperCase();

			if('XYZABCUVW'.indexOf(axis) >= 0) {
////##				var moves = ['G91'];
				log.debug("===> setting to exact distance")
				var moves = ['G91 G61.1'];  ////## setting exact distance for fixed-moves/nudges so g2 does not build longer vector
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

// Issue a nudge (small fixed move)  If the machine is already moving, queue up the nudge.
// Don't queue more than FIXED_MOVES_QUEUE_SIZE, though, to keep the machines behavior from running away.
// ie: You shoudln't be allowed to queue 50 nudges during a long slow move, and see them execute at the end.
//              axis - The first axis to move (eg "X")
//             speed - The speed in current units
//          distance - The length of the nudge
//       second_axis - The second axis to move
//   second_distance - The second axis speed

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

// Return true if the machine is moving
ManualDriver.prototype.isMoving = function() {
	return this.moving;
}

// Internal function called to "pump" moves into the queue
// This function is called periodically until a stop is requested, or the users intent to continue moving evaporates.
// The idea behind this function is that it is called at an interval that outpaces the 
//   reason - The reason this functon is being called (used for debug purposes)
ManualDriver.prototype._renewMoves = function(reason) {
	if(this.mode === 'normal') {	
		if(this.moving && this.keep_moving) {
			this.keep_moving = false;
			var segment = this.currentDirection*(this.renewDistance / RENEW_SEGMENTS);
			var second_segment = this.second_currentDirection*(this.renewDistance / RENEW_SEGMENTS);
			var moves = []
			if (this.second_axis){
				for(var i=0; i<RENEW_SEGMENTS; i++) {
					var move = 'G1' + this.currentAxis + segment.toFixed(4) + this.second_axis + second_segment.toFixed(4) + '\n'
					moves.push(move);
				}

			} else {
				for(var i=0; i<RENEW_SEGMENTS; i++) {
					var move = 'G1' + this.currentAxis + segment.toFixed(4)+'\n'
					moves.push(move);
				}
			}
			this.stream.write(moves.join(''));	
			this.driver.prime();
			this.renew_timer = setTimeout(function() {
				this._renewMoves("timeout")
			}.bind(this), T_RENEW)
		} else {
			this.stopMotion();
		}
	} else {
		if(!(this.moving && this.keep_moving)) {
			//this.stopMotion();
		} else {
			this.renew_timer = setTimeout(function() {
				this._renewMoves("timeout")
			}.bind(this), T_RENEW)			
		}
	} 
}

// Status handler
ManualDriver.prototype._onG2Status = function(status) {
	if(this.movement_timer) {
		clearTimeout(this.movement_timer);
	}

	this.movement_timer = setTimeout(function() {
		this.moving = false;
	}, 2000);

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
				log.debug("===> Redundant KILL (STAT_RUNNING) ?");
				this.driver.manualFeedHold(function(){
				}.bind(this));
			}
			break;
		case this.driver.STAT_STOP:
			this.stop_pending = false;
			if(this.omg_stop) {
				log.debug("===> Redundant KILL (STAT_STOP)?");
				this.stop_pending = true;
				this.driver.manualFeedHold(function(){
					this.driver.queueFlush(function() {
						this.driver.manual_hold = false;	
					}.bind(this));
				}.bind(this));
			}
		case this.driver.STAT_END:
		case this.driver.STAT_HOLDING:
			// Handle nudges once we've come to a stop
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

// Boilerplate limit handler
// TODO needs work
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

// Internal call that is issued when manual mode is done
// Resolves the promise created by the enter() function and resets internal state
ManualDriver.prototype._done = function() {
	this.moving = false;
    this.keep_moving = false;
    this.stream = null;
    this.entered = false;
	this.deferred.resolve();
}


module.exports = ManualDriver;
