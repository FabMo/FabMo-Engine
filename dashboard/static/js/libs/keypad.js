;(function (root, factory) {

  /* CommonJS */
  if (typeof module == 'object' && module.exports) module.exports = factory()

  /* AMD module */
  
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
	this.listeners = {'go' : [], 'stop': [], 'nudge':[], 'exit':[], 'enter' : []}
	this.pressThreshold = 50;
	this.pressTime = 150;
	this.tapInterval = 150;
	this.target = null;
}

Keypad.prototype.init = function() {
	var e = this.elem;
	var Hammer = require('./hammer.min.js');

	var drive_buttons = e.find('.drive-button');
	drive_buttons.each(function(index, element) {
		var hammer = new Hammer.Manager(element);
		hammer.add(new Hammer.Tap({time: this.pressTime-1, interval: this.tapInterval, threshold: this.pressThreshold}));
		hammer.add(new Hammer.Press({time: this.pressTime, threshold: this.pressThreshold}));
		hammer.add(new Hammer.Pan({threshold: this.pressThreshold}));

		hammer.on('press', this.onDrivePress.bind(this));
		hammer.on('pressup', this.end.bind(this));
		hammer.on('tap', this.onDriveTap.bind(this));
		hammer.on('panend', this.end.bind(this));
		hammer.on('pancancel', this.end.bind(this));

		window.addEventListener('orientationchange', this.end.bind(this));

		$(element).on('blur', this.end.bind(this));
		$(element).on('mouseleave', this.onDriveMouseleave.bind(this));
		$(element).on('touchend', this.end.bind(this));
		$(document).on('scroll', this.end.bind(this));
		element.addEventListener("contextmenu", function(evt) {evt.preventDefault()});
	}.bind(this));

	/*
	var exit_button = e.find('.exit-button');
	if(exit_button) {
		var hammer = new Hammer.Manager(exit_button[0]);
		hammer.add(new Hammer.Tap({time: this.pressTime-1, interval: this.tapInterval, threshold: this.pressThreshold}));
		hammer.on('tap', this.onExitTap.bind(this));
	} else {
		console.warn('no exit button')
	} */


	// var enter_button = $('.enter-button');
	// if(enter_button) {
	// 	var hammer = new Hammer.Manager(enter_button[0]);
	// 	hammer.add(new Hammer.Tap({time: this.pressTime-1, interval: this.tapInterval, threshold: this.pressThreshold}));
	// 	hammer.on('tap', this.onEnterTap.bind(this));
	// }else {
	// 	console.warn('no enter button')
	// }

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

Keypad.prototype.enter = function() {
	this.emit('enter', null)
}

Keypad.prototype.refresh = function() {
	if(!this.enabled || !this.going) {
		this.emit('stop', null);
	} else {
		this.emit('go', this.move);
		this.interval = setTimeout(this.refresh.bind(this), this.refreshInterval);
	}
}

Keypad.prototype.start = function(axis, direction, second_axis, second_direction) {
	if(this.going) { return; }
	if (second_axis) {
		this.move = {'axis' : axis, 'dir' : direction, 'second_axis' : second_axis, 'second_dir' : second_direction};
	} else {
		this.move = {'axis' : axis, 'dir' : direction};
	}
	this.going = true;
	this.refresh();
}

Keypad.prototype.nudge = function(axis, direction, second_axis, second_direction) {
	if(this.going) { return; }
	if (second_axis) {
		var nudge = {'axis' : axis, 'dir' : direction, 'second_axis' : second_axis, 'second_dir' : second_direction};
	} else {
		var nudge = {'axis' : axis, 'dir' : direction};
	}

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

Keypad.prototype.exit = function() {
	this.emit('exit');
}

Keypad.prototype.onDrivePress = function(evt) {


	this.target = evt.target;
	this.setEnabled(true);
	var e = $(evt.target);
	e.focus();
	if(e.hasClass('drive-button-fixed')) {
		this.onDriveTap(evt);
		
	} else {
		if(!this.going) {
			if(e.hasClass('x_pos') && e.hasClass('y_pos')) {
				this.start('x', 1, 'y', 1);
			}
			else if(e.hasClass('x_neg') && e.hasClass('y_pos')) {
				this.start('x', -1, 'y', 1);
			}
			else if(e.hasClass('x_neg') && e.hasClass('y_neg')) {
				this.start('x', -1, 'y', -1);
			}
			else if(e.hasClass('x_pos') && e.hasClass('y_neg')) {
				this.start('x', 1, 'y', -1);
			}
			else if(e.hasClass('x_pos')) {
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
			} else if(e.hasClass('a_pos')){
				this.start('a', 1)
			} else if(e.hasClass('a_neg')){
				this.start('a', -1)
			} else if(e.hasClass('b_pos')){
				this.start('b', 1)
			} else if(e.hasClass('b_neg')){
				this.start('b', -1)
			} else {
				return;
			}
			e.addClass('drive-button-active').removeClass('drive-button-inactive');
		}
	}

}

Keypad.prototype.onDriveTap = function(evt) {
	
	var e = $(evt.target);
	if(this.going) {
		this.end();
	} else {
		if(e.hasClass('x_pos') && e.hasClass('y_pos')) {
			this.nudge('x', 1, 'y', 1);
		}
		else if(e.hasClass('x_neg') && e.hasClass('y_pos')) {
			this.nudge('x', -1, 'y', 1);
		}
		else if(e.hasClass('x_neg') && e.hasClass('y_neg')) {
			this.nudge('x', -1, 'y', -1);
		}
		else if(e.hasClass('x_pos') && e.hasClass('y_neg')) {
			this.nudge('x', 1, 'y', -1);
		}
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
		} else if(e.hasClass('a_pos')){
			this.nudge('a', 1)
		} else if(e.hasClass('a_neg')){
			this.nudge('a', -1)
		} else if(e.hasClass('b_pos')){
			this.nudge('b', 1)
		} else if(e.hasClass('b_neg')){
			this.nudge('b', -1)
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

Keypad.prototype.onExitTap = function(evt) {
	this.exit();
}

Keypad.prototype.onEnterTap = function(evt) {
	this.enter();
}

Keypad.prototype.onDriveMouseleave = function(evt) {
	if(evt.target == this.target) {
		this.end();		
	}
}

return Keypad;
}));

