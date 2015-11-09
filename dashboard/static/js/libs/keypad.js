;(function (root, factory) {

  /* CommonJS */
  if (typeof module == 'object' && module.exports) module.exports = factory()

  /* AMD module */
  else if (typeof define == 'function' && define.amd) define(factory)

  /* Browser global */
  else root.WheelControl = factory()
}(this, function () {
  "use strict"

var MOVE_THRESH = 5;
var keypad_enabled = false;
  var KEY_RIGHT = 39;
  var KEY_LEFT = 37;
  var KEY_UP = 38;
  var KEY_DOWN = 40;
  var KEY_PGUP = 33;
  var KEY_PGDOWN = 34;


var Keypad = function(id, options) {
	this.id = id;
	this.elem = $(id);
	this.elem.attr('tabindex', 0)
	this.moves = 0;
	this.init();
	this.direction = null;
	this.going = false;
	this.interval = null;
	this.listeners = {'go' : [], 'stop': []}
}

Keypad.prototype.init = function() {
	this.elem.click(this.onClick.bind(this));
	this.elem.on('focus', this.onFocus.bind(this));
	this.elem.on('blur', this.onBlur.bind(this));
	this.elem.on('mousemove', this.onMouseMove.bind(this));
	this.elem.on('keydown', this.onKeyDown.bind(this));
	this.elem.on('keyup', this.onKeyUp.bind(this));
}

Keypad.prototype.setOptions = function(options) {
	options = options || {}
	this.refreshInterval = options.refreshInterval || this.refreshInterval || 1000;
}

Keypad.prototype.emit = function(evt, data) {
	if(evt in this.listeners) {
		console.info("Emitting " + evt + " event with " + JSON.stringify(data));
		listeners = this.listeners[evt];
		for(var i=0; i<listeners.length; i++) {
			try {
				listeners[i](data);
			} catch(e) {
				log.error("Error calling listener: " + e);
			}
		}
	}
}

Keypad.prototype.on = function(evt, func) {
	if(evt in this.listeners) {
		this.listeners[evt].push(func);
	}
}

Keypad.prototype.setEnabled = function(enabled) {
	this.enabled = enabled;
	if(enabled) {
		this.moves = MOVE_THRESH;
		this.elem.removeClass('keypadDisabled');				
		this.elem.addClass('keypadEnabled');		
	} else {
		this.moves = 0;
		this.elem.addClass('keypadDisabled');		
		this.elem.removeClass('keypadEnabled');		
	}
}


Keypad.prototype.refresh = function() {
	if(!this.enabled || !this.going) {
		this.emit('stop', null);
	} else {
		this.emit('go', {'dir' : this.direction});
		this.interval = setTimeout(this.refresh.bind(this), this.refreshInterval);
	}
}

Keypad.prototype.start = function(direction) {
	if(this.going) { return; }
	this.direction = direction;
	this.going = true;
	this.refresh();
}

Keypad.prototype.stop = function(direction) {
	this.going = false;
	if(this.interval) {
		clearTimeout(this.interval);
		this.interval = null;
	}
	this.emit('stop', null);
}


Keypad.prototype.onClick = function(evt) {
	this.setEnabled(!this.enabled);
	console.log('Click')
}


Keypad.prototype.onFocus = function(evt) {
}

Keypad.prototype.onBlur = function(evt) {
	this.setEnabled(false);
}

Keypad.prototype.onMouseMove = function(evt) {
	if(this.moves-- <= 0) {
		this.setEnabled(false);
	}
}

Keypad.prototype.onKeyDown = function(evt) {
	if(!this.going) {
		switch(evt.keyCode) {
			case KEY_UP:
				this.start('+y');
				break;
		}	
	}
}

Keypad.prototype.onKeyUp = function(evt) {
	this.stop();
}


return Keypad;
}));

