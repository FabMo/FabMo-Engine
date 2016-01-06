;(function (root, factory) {

  /* CommonJS */
  if (typeof module == 'object' && module.exports) module.exports = factory()

  /* AMD module */
  else if (typeof define == 'function' && define.amd) define(['hammer', 'jquery'],factory)

  /* Browser global */
  else root.WheelControl = factory(Hammer, $)

}(this, function (Hammer) {
  "use strict"

var Keypad = function(id, options) {
	this.id = id;
	this.elem = $(id);
	//this.elem.attr('tabindex', 0) // For keyboard
	this.setOptions(options);
	this.init();
	this.move = null;
	this.going = false;
	this.interval = null;
	this.enabled = false;
	this.listeners = {'go' : [], 'stop': [], 'nudge':[]}
	this.pressThreshold = 50;
	this.pressTime = 250;
	this.tapInterval = 250;
}

Keypad.prototype.init = function() {
	var e = this.elem;

	var drive_buttons = e.find('.drive-button');
	drive_buttons.each(function(index, element) {
		var hammer = new Hammer.Manager(element);
		hammer.add(new Hammer.Tap({time: this.pressTime-1, interval: this.tapInterval, threshold: this.pressThreshold}));
		hammer.add(new Hammer.Press({time: this.pressTime, threshold: this.pressThreshold}));
		hammer.on('press', this.onDrivePress.bind(this));
		hammer.on('pressup', this.onDriveRelease.bind(this));
		hammer.on('tap', this.onDriveTap.bind(this));
		$(element).on('blur', this.onDriveBlur.bind(this));
		$(element).on('mouseleave', this.onDriveMouseleave.bind(this));
		$(element).on('touchend', this.end.bind(this));
		$(document).on('scroll', this.end.bind(this));

	}.bind(this));
}

Keypad.prototype.setOptions = function(options) {
	options = options || {}
	this.refreshInterval = options.refreshInterval || this.refreshInterval || 100;
	this.pressTime = options.pressTime || this.pressTime || 250;
	this.pressThreshold = options.pressThreshold || this.pressThreshold || 10;
	this.tapInterval = options.tapInterval || this.tapInterval || 250;

}

Keypad.prototype.emit = function(evt, data) {
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

Keypad.prototype.on = function(evt, func) {
	if(evt in this.listeners) {
		this.listeners[evt].push(func);
	}
}

Keypad.prototype.setEnabled = function(enabled) {
	this.enabled = enabled;
	if(!enabled) {
		this.elem.find('.drive-button').addClass('drive-button-inactive').removeClass('drive-button-active')
	}
}


Keypad.prototype.refresh = function() {
	if(!this.enabled || !this.going) {
		this.emit('stop', null);
	} else {
		this.emit('go', this.move);
		this.interval = setTimeout(this.refresh.bind(this), this.refreshInterval);
	}
}

Keypad.prototype.start = function(axis, direction) {
	if(this.going) { return; }
	this.move = {'axis' : axis, 'dir' : direction};
	this.going = true;
	this.refresh();
}

Keypad.prototype.nudge = function(axis, direction) {
	if(this.going) { return; }
	var nudge = {'axis' : axis, 'dir' : direction};
	this.emit('nudge', nudge);
}

Keypad.prototype.stop = function() {
	this.going = false;
	if(this.interval) {
		clearTimeout(this.interval);
		this.interval = null;
	}
	this.emit('stop', null);
}

Keypad.prototype.end = function() {

	if(this.enabled) {
		this.setEnabled(false);
	}
	if(this.going) {
		this.stop();
	}
}

Keypad.prototype.onDrivePress = function(evt) {
	this.setEnabled(true);
	var e = $(evt.target);
	if(!this.going) {
		if(e.hasClass('x_pos')) {
			this.start('x', 1);
		}
		else if(e.hasClass('x_neg')) {
			this.start('x', -1);
		}
		else if(e.hasClass('y_pos')) {
			this.start('y', 1);
		}
		else if(e.hasClass('y_neg')) {
			this.start('y', -1);
		}
		else if(e.hasClass('z_pos')) {
			this.start('z', 1);
		}
		else if(e.hasClass('z_neg')) {
			this.start('z', -1);
		} else {
			return;
		}
		e.addClass('drive-button-active').removeClass('drive-button-inactive');
	}
}

Keypad.prototype.onDriveTap = function(evt) {
	console.log("driveTap")
	var e = $(evt.target);
	if(this.going) {
		this.end();
	} else {
		if(e.hasClass('x_pos')) {
			this.nudge('x', 1);
		}
		else if(e.hasClass('x_neg')) {
			this.nudge('x', -1);
		}
		else if(e.hasClass('y_pos')) {
			this.nudge('y', 1);
		}
		else if(e.hasClass('y_neg')) {
			this.nudge('y', -1);
		}
		else if(e.hasClass('z_pos')) {
			this.nudge('z', 1);
		}
		else if(e.hasClass('z_neg')) {
			this.nudge('z', -1);
		} else {
			return;
		}
		e.addClass('drive-button-active-transient').removeClass('drive-button-inactive');
		setTimeout(function() {
			if(!this.going) {
				e.removeClass('drive-button-active-transient').addClass('drive-button-inactive');				
			}
		}.bind(this), 25);
	}
}

Keypad.prototype.onDriveMouseleave = function(evt) {
	this.end();
}

Keypad.prototype.onDriveTouchend = function(evt) {
	this.end();
}

Keypad.prototype.onDriveBlur = function(evt) {
	this.end();
}

Keypad.prototype.onDriveRelease = function(evt) {
	this.end();
}


return Keypad;
}));

