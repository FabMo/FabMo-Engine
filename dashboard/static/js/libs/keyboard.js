;(function (root, factory) {

  /* CommonJS */
  if (typeof module == 'object' && module.exports) module.exports = factory()

  /* AMD module */
  else if (typeof define == 'function' && define.amd) define(factory)

  /* Browser global */
  else root.WheelControl = factory()
}(this, function () {
  "use strict"

  var NUDGE_TIMEOUT = 200;
  var MOVE_THRESH = 10;           // for mouse to disrupt ?
  ////## var Keyboard_enabled = false;   ////## not used ???
  var KEY_RIGHT = 39;
  var KEY_LEFT = 37;
  var KEY_UP = 38;
  var KEY_DOWN = 40;
  var KEY_PGUP = 33;
  var KEY_PGDOWN = 34;

var Keyboard = function(id, options) {
	this.id = id;
	this.elem = this.id ? $(id) : null;
	if(this.elem) {
		this.elem.attr('tabindex', 0)		
	}
	this.moves = 0;
	this.init();
	this.move = null;
	this.going = false;
	this.interval = null;
	this.listeners = {'go' : [], 'stop': [], 'nudge' :  []}
	this.setOptions(options);
	this.nudgeTimer = null;
}

/* Keyboard keys and mouse-keypad keys work similarly, but not identically. Idea is that presses up to a threshold
     length will trigger a "fixed move" (via nudge process) as will any presses with "fixed" button on. Presses longer
     will trigger longer moves, with refresh pumping new moves to engine/g2. Stop now triggers stop via g2 "kill" from
     engine. */

Keyboard.prototype.init = function() {
	if(this.elem) {
		this.elem.click(this.onClick.bind(this));
		this.elem.on('focus', this.onFocus.bind(this));
		this.elem.on('mouseenter', this.onMouseEnter.bind(this));
		this.elem.on('blur', this.onBlur.bind(this));
		this.elem.on('mousemove', this.onMouseMove.bind(this));
		this.elem.on('keydown', this.onKeyDown.bind(this));
		this.elem.on('mouseleave', this.onMouseLeave.bind(this))
		this.elem.on('keyup', this.onKeyUp.bind(this));		
	} else {
		$(document).on('keydown', this.onKeyDown.bind(this));
		$(document).on('keyup', this.onKeyUp.bind(this));		

	}
}

Keyboard.prototype.setOptions = function(options) {
	options = options || {}
	this.refreshInterval = options.refreshInterval || this.refreshInterval || 50; // from 100 to make more responsive like pad

console.log("refreshInterval now=" + this.refreshInterval);
}

Keyboard.prototype.emit = function(evt, data) {
	if(evt in this.listeners) {
		var listeners = this.listeners[evt];
		for(var i=0; i<listeners.length; i++) {
			try {
				
				listeners[i](data);
			} catch(e) {
				console.error("Error calling listener: " + e);
			}
		}
	}
}

Keyboard.prototype.on = function(evt, func) {
	if(evt in this.listeners) {
		this.listeners[evt].push(func);
	}
}

Keyboard.prototype.setEnabled = function(enabled) {
	this.enabled = enabled;
	if(enabled) {
		this.moves = MOVE_THRESH;
		if(this.elem) {			
			this.elem.removeClass('keyboard-button-inactive').addClass('keyboard-button-active');				
		}
	} else {
		this.going = false;
		this.moves = 0;
		if(this.elem) {			
			this.elem.removeClass('keyboard-button-active').addClass('keyboard-button-inactive');				
		}
	}
}

Keyboard.prototype.refresh = function() {  // Keep pumping moves unless we should STOP
	if(!this.enabled || !this.going) {
		this.emit('stop', null);
	} else if ($('.fixed-switch input').is(':checked')) { 
	    console.log("fixed-DOWN");
	    this.nudgeTimer = 1;
	    this.going = true;
		if(this.enabled) {
			this.emit('nudge', this.move);
		}
	} else {
		if(this.enabled) {
			this.emit('go', this.move);
		}
		this.interval = setTimeout(this.refresh.bind(this), this.refreshInterval);
	}
}

Keyboard.prototype.start = function(axis, direction) {
	if(this.going) { return; }
	this.move = {'axis' : axis, 'dir' : direction};
	this.going = true;
	this.refresh();
}

Keyboard.prototype.stop = function() {
	this.going = false;
	if(this.interval) {
		clearTimeout(this.interval);
		this.interval = null;
	}
	this.emit('stop', null);
}

Keyboard.prototype.onClick = function(evt) {
	this.setEnabled(!this.enabled);
}

Keyboard.prototype.onFocus = function(evt) {}
Keyboard.prototype.onMouseEnter = function(evt) {}

Keyboard.prototype.onBlur = function(evt) {
	this.setEnabled(false);
}

Keyboard.prototype.onMouseMove = function(evt) {
	if(this.moves-- <= 0) {
		this.setEnabled(false);
	}
}

Keyboard.prototype.onKeyDown = function(evt) {
	if (this.going || !this.enabled) {return}
		this.nudgeTimer = setTimeout(function() {
		if(!this.going) {

			switch(evt.keyCode) {
				case KEY_UP:
					this.start('y', 1);
					break;

				case KEY_DOWN:
					this.start('y', -1);
					break;

				case KEY_LEFT:
					this.start('x', -1);
					break;

				case KEY_RIGHT:
					this.start('x', 1);
					break;

				case KEY_PGUP:
					this.start('z', 1);
					break;

				case KEY_PGDOWN:
					this.start('z', -1);
					break;

			}	
		}
	}.bind(this), NUDGE_TIMEOUT);
}

Keyboard.prototype.onMouseLeave = function(evt) {
	this.setEnabled(false);
	if(this.going) {
		this.stop();
	}
}

Keyboard.prototype.onKeyUp = function(evt) {
	if(this.nudgeTimer) {
 		clearTimeout(this.nudgeTimer);
 		this.nudgeTimer = null;
 		if(!this.enabled) { return;}

 		switch(evt.keyCode) {
 				case KEY_UP:
 					this.nudge('y', 1);
 					break;

 				case KEY_DOWN:
 					this.nudge('y', -1);
 					break;

 				case KEY_LEFT:
 					this.nudge('x', -1);
 					break;

 				case KEY_RIGHT:
 					this.nudge('x', 1);
 					break;

 				case KEY_PGUP:
 					this.nudge('z', 1);
 					break;

 				case KEY_PGDOWN:
 					this.nudge('z', -1);
 					break;
 				default:
 					return;
 			}	

	} else {
		if(this.going || this.enabled ) { this.stop(); }
	} 
}

Keyboard.prototype.nudge = function(axis, direction) {
	if(this.going) { return this.stop(); }
	var nudge = {'axis' : axis, 'dir' : direction};
	if(this.enabled) {
		this.emit('nudge', nudge);
	}
}

return Keyboard;
}));

