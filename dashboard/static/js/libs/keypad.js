;(function (root, factory) {

  /* CommonJS */
  if (typeof module == 'object' && module.exports) module.exports = factory()

  /* AMD module */
  else if (typeof define == 'function' && define.amd) define(factory)

  /* Browser global */
  else root.WheelControl = factory()
}(this, function () {
  "use strict"

var Keypad = function(id, options) {
	this.id = id;
	this.elem = $(id);
	//this.elem.attr('tabindex', 0)
	this.init();
	this.move = null;
	this.going = false;
	this.interval = null;
	this.enabled = false;
	this.listeners = {'go' : [], 'stop': []}
	this.setOptions(options);
}

Keypad.prototype.init = function() {
	var e = this.elem;
	console.log(e)
	var xp = e.find(".x_pos")
	var xn = e.find(".x_neg")
	var yp = e.find(".y_pos")
	var yn = e.find(".y_neg")
	var zp = e.find(".z_pos")
	var zn = e.find(".z_neg")
	var all = [xp,xn,yp,yn,zp,zn];
	console.log(all)
	all.forEach(function(element) {
		console.log(element);
		element.on('mousedown', this.onDriveMousedown.bind(this))
		element.on('mouseup', this.onDriveMouseup.bind(this))
		//element.on('focus', this.onDriveFocus.bind(this))
		element.on('blur', this.onDriveBlur.bind(this))
		//element.on('mouseenter', this.onDriveMouseEnter.bind(this))
		element.on('mouseleave', this.onDriveMouseLeave.bind(this))
	}.bind(this));
}

Keypad.prototype.setOptions = function(options) {
	options = options || {}
	this.refreshInterval = options.refreshInterval || this.refreshInterval || 100;
}

Keypad.prototype.emit = function(evt, data) {
	if(evt in this.listeners) {
		console.info("Emitting " + evt + " event with " + JSON.stringify(data));
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

Keypad.prototype.stop = function() {
	this.going = false;
	if(this.interval) {
		clearTimeout(this.interval);
		this.interval = null;
	}
	this.emit('stop', null);
}


Keypad.prototype.onDriveClick = function(evt) {
	console.log('Drive button click')
}



Keypad.prototype.onDriveMousedown = function(evt) {
	console.log("driveMouseDown")
	this.setEnabled(true);
	var e = $(evt.target);
	console.log(e)
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

Keypad.prototype.onDriveMouseup = function(evt) {
	this.setEnabled(false);
	if(this.going) {
		this.stop();
	}
}

Keypad.prototype.onDriveMouseLeave = function(evt) {
	this.setEnabled(false);
	if(this.going) {
		this.stop();
	}
}

Keypad.prototype.onDriveBlur = function(evt) {
	this.setEnabled(false);
	if(this.going) {
		this.stop();
	}
}

/*
Keyboard.prototype.onMouseLeave = function(evt) {
	this.setEnabled(false);
	if(this.going) {
		this.stop();
	}
}

Keyboard.prototype.onKeyUp = function(evt) {
	this.stop();
}
*/

return Keypad;
}));

