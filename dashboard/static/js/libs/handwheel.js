CLICK_DIST = 10;
function dist(a,b) {
    return Math.sqrt((b.x-a.x)*(b.x-a.x) + (b.y-a.y)*(b.y-a.y));
}

var WheelControl = function(element, options) {
	options = options || {}
	this.canvas = document.getElementById(element);
    var r = Math.min(this.canvas.width, this.canvas.height)/2.0
    this.ctx = this.canvas.getContext("2d");
    
    // Settings
    this.thumbRadius = options.thumbRadius || r/7.0;
    this.thumbActiveRadius = options.thumbActiveRadius || r/6.0;
    this.radius = r - this.thumbActiveRadius;
    this.center = {x:this.canvas.width/2.0, y:this.canvas.height/2.0};
    this.controls = [];
    this.bgColor = options.bgColor || null;
    this.minSpeed = options.minSpeed || 0.1;
    this.maxSpeed = options.maxSpeed || 4.0;
    this.speedIncrement = options.speedIncrement || 0.1;
    this.speedDigits = options.speedDigits || 1;
    var wheelSpeed = options.wheelSpeed || this.minSpeed;
    this.wheelSpeed = Math.min(Math.max(wheelSpeed, this.minSpeed), this.maxSpeed);
    this.units = options.units || 'in';

    // Private data
    this.mousepos = {x:null,y:null};
    this.controls = [];
    this.listeners = {};

    var centerTextColor = '#aaaaaa';
    var centerTextStyle = '18px Arial';

    // Wheel for moving the tool
    var xyzwheel = new Handwheel({
    	radius : this.radius*0.6,
    	center : this.center,
    	centerText : this.wheelSpeed.toFixed(this.speedDigits) + '\nin/sec',
    	centerTextColor : centerTextColor,
    	centerTextStyle : centerTextStyle,
    	thumbRadius : this.thumbRadius,
    	thumbActiveRadius : this.thumbActiveRadius,
    	angleOffset : Math.PI/3.0,
    	railStyle : 'solid',
    	thumbActiveTextStyle : 'Arial 50px'
    });

    xyzwheel.addThumb({
    	label: 'X',
    	activeColor: '#ff0000',
    });

    xyzwheel.addThumb({
    	label: 'Y',
    	activeColor: '#00aa00'
    });

    xyzwheel.addThumb({
    	label: 'Z',
    	activeColor: '#0000aa'
    });

    // Wheel for adjusting speed
    var speedwheel = new Scalewheel({
    	radius : this.radius*0.6,
    	center : this.center,
    	thumbRadius : this.thumbRadius,
    	thumbActiveRadius : this.thumbActiveRadius, 
    	label : 'S',
    	position : this.wheelSpeed,
    	centerText : this.wheelSpeed.toFixed(this.speedDigits) + '\nin/sec',
        centerTextColor : centerTextColor,
        centerTextStyle : centerTextStyle
    });

    // Arrow for positive nudge
    var plusnudge = new Nudger({
    	radius : this.radius,
    	center : this.center,
    	startAngle : 3.0*Math.PI/2.0,
    	endAngle : 7.0*Math.PI/4.0,
    	arrow : 'end',
    	labelStyle : '25px Arial',
    	labelText : '+'
    });

    // Arrow for negative nudge
    var minusnudge = new Nudger({
    	radius : this.radius,
    	center : this.center,
    	endAngle : 3.0*Math.PI/2.0,
    	startAngle : 5.0*Math.PI/4.0,
    	arrow : 'start',
    	labelStyle : '25px Arial',
    	labelText : '-'
    });

    var speedlabel = new Label({
        text : 'Speed',
        textColor : '#aaaaaa',
        center : this.center,
        position : 'top',
        radius : this.radius
    });

    var handwheellabel = new  Label({
        text : 'Handwheel',
        textColor : '#aaaaaa',
        center : this.center,
        position : 'bottom',
        radius : this.radius        
    })

    // List of controls with access to the canvas context
    this.controls.push(speedwheel);
    this.controls.push(xyzwheel);
    this.controls.push(plusnudge);
    this.controls.push(minusnudge);
    this.controls.push(speedlabel);
    this.controls.push(handwheellabel);

    // Setup what is initially visible
    speedwheel.hide();
    xyzwheel.show();
    plusnudge.show();
    minusnudge.show();
    handwheellabel.show();

    // Bind events
    this._setupListeners();
    
    var switchToSpeedwheel = function() {
        xyzwheel.hide();
        plusnudge.hide();
        minusnudge.hide();
        speedwheel.show();
        speedlabel.show();
        this.draw();        
    }.bind(this);

    var switchToHandwheel = function() {
        xyzwheel.show();
        plusnudge.show();
        minusnudge.show();
        speedwheel.hide();
        speedlabel.hide();
        this.draw();        
    }.bind(this);


    // Center click on the handwheel switches us to speed adjustment
    xyzwheel.on('center', switchToSpeedwheel);

    xyzwheel.on('sweep', function move(data) {
    	this.emit('move', {'axis' : data.thumb.label, 'angle' : data.angle, 'rate' : data.rate})
    }.bind(this));

    xyzwheel.on('release', function release(data) {
        this.draw();
    	this.emit('release', {});
    }.bind(this));

    // Selecting a speed commits it and returns us to the handwheel/nudge control
    speedwheel.on('pos', function setSpeed(data) {
    	speed = this.minSpeed + data.pos*(this.maxSpeed-this.minSpeed);
    	increments = speed / this.speedIncrement;
    	speed = Math.round(increments)*this.speedIncrement;
    	this.emit('speed', {'speed' : speed})
    	setTimeout(switchToHandwheel, 500);
    }.bind(this))

    // Speed selection is indicated live while dragging the speed wheel
    speedwheel.on('sweep', function updateSpeedDisplay(data) {
    	speed = this.minSpeed + data.pos*(this.maxSpeed-this.minSpeed);
    	increments = speed / this.speedIncrement;
    	speed = Math.round(increments)*this.speedIncrement;
    	text = speed.toFixed(this.speedDigits) + '\nin/sec';
    	speedwheel.setCenterText(text);
    	xyzwheel.setCenterText(text);
    }.bind(this));

    speedwheel.on('center', switchToHandwheel);

    plusnudge.on('nudge', function nudgePositive(data) {
        if(xyzwheel.activeThumb) {
            plusnudge.flash(this.ctx, xyzwheel.activeThumb.activeColor, 100);
            axis = xyzwheel.activeThumb.label;
            this.emit('nudge', {'axis' : '+' + axis})
        }
    }.bind(this));

    minusnudge.on('nudge', function nudgePositive(data) {
        if(xyzwheel.activeThumb) {
            minusnudge.flash(this.ctx, xyzwheel.activeThumb.activeColor, 100);
            axis = xyzwheel.activeThumb.label;
            this.emit('nudge', {'axis' : '-' + axis})
        }
    }.bind(this));

    this.draw();
    this.draw();
}

WheelControl.prototype._getMousePos = function(evt) {
    var rect = this.canvas.getBoundingClientRect();
    try {
        var touch = evt.targetTouches[0] || evt.changedTouches[0];
    } catch(e) {
        var touch = null;
    }
    if(touch) {
        return {
            x: touch.pageX - rect.left,
            y: touch.pageY - rect.top
        };
    } else {
        return {
            x: evt.clientX - rect.left,
            y: evt.clientY - rect.top
        };
    }
};


WheelControl.prototype.draw = function() {

	// Clear the canvas
    if(this.bgColor) {
        this.ctx.fillRect(0,0,this.canvas.width,this.canvas.height);
    } else {
        this.ctx.fillStyle = this.bgColor;
        this.ctx.clearRect(0,0,this.canvas.width,this.canvas.height);
    }

    // Draw all the controls
	for(i in this.controls) {
		this.controls[i].draw(this.ctx);
	}
}
WheelControl.prototype._setupListeners = function() {
    var onMouseDown = function(evt) {
        var pos = this._getMousePos(evt);
        this.mousepos = pos;
        for(i in this.controls) {
            control = this.controls[i];
            if(control.visible) {
                if(control.onMouseDown(pos)) {
                    break;
                }
            }
        }
        evt.stopPropagation();
        evt.preventDefault();
        this.draw();
    }.bind(this);

    this.canvas.addEventListener('mousedown', onMouseDown, false);
    this.canvas.addEventListener('touchstart', onMouseDown, false);


    var onMouseUp = function(evt) {
        var pos = this._getMousePos(evt);
        for(i in this.controls) {
            control = this.controls[i];
            if(control.visible) {
                var claimed = false;
                if(dist(pos, this.mousepos) < CLICK_DIST) {
                    var a = control.onMouseUp(pos);
                    var b = control.onClick(pos);
                    claimed = a || b;
                } else {
                    claimed = control.onMouseUp(pos);
                }
                if(claimed) {
                    break;
                }
            }
        }
        evt.stopPropagation();
        evt.preventDefault();
        this.draw();
    }.bind(this);

    this.canvas.addEventListener('mouseup', onMouseUp, false);
    this.canvas.addEventListener('touchend', onMouseUp, false);
    
    this.canvas.addEventListener('blur', function(evt) {
        for(i in this.controls) {
            this.controls[i].deactivate();
        }
        this.draw();
        this.emit('release', {});
    }.bind(this));

    
    var onMouseMove = function(evt) {
        var pos = this._getMousePos(evt);
        for(i in this.controls) {
            control = this.controls[i];
            if(control.visible) {
                control.onMouseMove(pos);               
            }
        }
        this.draw();
    }.bind(this);
    
    this.canvas.addEventListener('mousemove', onMouseMove, false);
    this.canvas.addEventListener('touchmove', onMouseMove, false);

};



WheelControl.prototype.on = function(event, callback) {
	if(event in this.listeners) {
		this.listeners[event].push(callback);
	} else {
		this.listeners[event] = [callback];
	}
}

WheelControl.prototype.emit = function(event, data) {
	if(event in this.listeners) {
		for(i in this.listeners[event]) {
			callback = this.listeners[event][i];
			callback(data);
		}
	}
}
var Handwheel = function(options) {
	// General size/shape
	this.radius = options.radius || 100;
	this.thumbRadius = options.thumbRadius || this.radius/4.0;
	this.thumbActiveRadius = options.thumbActiveRadius || this.thumbRadius;
	this.angleOffset = options.angleOffset || 0.0;
	this.center = options.center || {x:this.radius+this.thumbActiveRadius, y:this.radius+this.thumbActiveRadius}
	this.thumbs = [];
	this.position = 0.0;
	this.visible = true;
	this.active = false;
	this.activeThumb = null;
	this.pos = null;

	// Rail Styles	
	this.railColor = options.railColor || '#aaaaaa';
	this.railStyle = options.railStyle || 'solid';
	this.railWidth = options.railWidth || 5;

	// Thumb Styles
	this.thumbColor = options.thumbColor || '#aaaaaa';
	this.thumbTextColor = options.thumbTextColor || '#ffffff';
	this.thumbActiveColor = options.thumbActiveColor || '#999999';
	this.thumbActiveTextStyle = options.thumbActiveTextStyle || this.thumbTextStyle;
	this.thumbActiveTextColor = options.thumbActiveTextColor || this.thumbTextColor;

	this.centerTextColor = options.centerTextColor || '#000000';
	this.centerTextStyle = options.centerTextStyle || 'Verdana 50px';
	this.centerText = options.centerText || '';

	this.listeners = {};
}

Handwheel.prototype.on = function(event, callback) {
	if(event in this.listeners) {
		this.listeners[event].push(callback);
	} else {
		this.listeners[event] = [callback];
	}
}

Handwheel.prototype.emit = function(event, data) {
	if(event in this.listeners) {
		for(i in this.listeners[event]) {
			callback = this.listeners[event][i];
			callback(data);
		}
	}
}

Handwheel.prototype.setCenterText = function(text) {
	this.centerText = text;
}

Handwheel.prototype.addThumb = function(options) {
	thumb = {}
	thumb.color = options.color || this.thumbColor;
	thumb.label = options.label || '';
	thumb.textColor = options.textColor || this.thumbTextColor;
	thumb.active = false;
	thumb.radius = options.radius || this.thumbRadius;
	thumb.activeColor = options.activeColor || this.thumbActiveColor;
	thumb.activeRadius = options.activeRadius || this.thumbActiveRadius;
	thumb.textStyle = options.textStyle || this.thumbTextStyle;
	thumb.activeTextStyle = options.activeTextStyle || this.thumbActiveTextStyle;
	this.thumbs.push(thumb);
}

Handwheel.prototype.show = function() {
	this.visible = true;
}

Handwheel.prototype.hide = function() {
	this.visible = false;
}

Handwheel.prototype._getThumbCenters = function() {

	var theta = this.angleOffset + this.position;
	var dtheta = 2*Math.PI/this.thumbs.length;

	retval = [];
	for(i in this.thumbs) {
        thumb = this.thumbs[i];
        retval.push({x:this.center.x + this.radius*Math.sin(theta), y:this.center.y + this.radius*Math.cos(theta)});
        theta += dtheta;
    }
    return retval;
}

Handwheel.prototype._drawThumbs = function(ctx) {
	centers = this._getThumbCenters();
	for(i in this.thumbs) {
        thumb = this.thumbs[i];
        ctx.beginPath();
        var center = centers[i]

        // Draw the thumb circle
        if(thumb.active) {
	        ctx.arc(center.x,center.y,thumb.activeRadius,0,2*Math.PI);
	        ctx.fillStyle = thumb.activeColor;
	        ctx.font = thumb.activeTextStyle;
        } else {
	        ctx.arc(center.x,center.y,thumb.radius,0,2*Math.PI);
	        ctx.fillStyle = thumb.color;
	        ctx.font = thumb.textStyle;
	        ctx.fill();
        }
        ctx.fill();

        // Draw the thumb text
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = thumb.textColor;
        ctx.fillText(thumb.label, center.x, center.y);

       // theta += dtheta;
    }
}


Handwheel.prototype._drawCenter = function(ctx) {
    if(this.centerText.indexOf('\n') === -1) {
        // Draw the thumb text
        ctx.font = this.centerTextStyle;
        ctx.fillStyle = this.centerTextColor;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.centerText, this.center.x, this.center.y);        
    } else {
        parts = this.centerText.split('\n');
        var top = parts[0];
        var bot = parts[1];

        ctx.font = this.centerTextStyle;
        ctx.fillStyle = this.centerTextColor;
        ctx.textAlign = 'center';

        ctx.textBaseline = 'bottom';
        ctx.fillText(top, this.center.x, this.center.y)

        ctx.textBaseline = 'top';
        ctx.fillText(bot, this.center.x, this.center.y)
    }
}


Handwheel.prototype._hitsThumb = function(pos) {
	var centers = this._getThumbCenters();
	for(i in this.thumbs) {
        thumb = this.thumbs[i];
        center = centers[i];
        if(dist(pos, center) < thumb.radius) {
        	return thumb;
        }
       // theta += dtheta;
    }
    return null;
}

Handwheel.prototype._hitsCenter = function(pos) {
	return dist(pos, this.center) < (this.radius - this.thumbActiveRadius);
}

Handwheel.prototype._drawSolidRails = function(ctx) {
    ctx.beginPath();
    ctx.arc(this.center.x,this.center.y,this.radius,0,2*Math.PI); 
    if(this.activeThumb) {
    	ctx.strokeStyle = this.activeThumb.activeColor;
    } else {
	    ctx.strokeStyle = this.railColor;
    }

	ctx.lineWidth = this.railWidth;    	
    ctx.stroke();
}

Handwheel.prototype._drawBrokenRails = function(ctx) {
	this._drawSolidRails(ctx);
}

Handwheel.prototype._drawRails = function(ctx) {
	switch(this.railStyle) {
		case 'solid':
			this._drawSolidRails(ctx)
			break;

		case 'dashed':
		case 'broken':
			this._drawBrokenRails(ctx)
			break;
	} 
}

Handwheel.prototype.deactivate = function() {
	this.active = false;
	this.pos = null;
    this.time = null;
}

Handwheel.prototype.onMouseDown = function(pos) {
	hitThumb = this._hitsThumb(pos);

	if(hitThumb) {
        for(i in this.thumbs) {
            this.thumbs[i].active = false;
        }
		this.pos = pos;
		this.active = true;
		hitThumb.active = true;
        this.activeThumb = hitThumb;
        return true;
	}
    return false;
}

Handwheel.prototype.onClick = function(pos) {
	if(this._hitsCenter(pos)) {
		this.emit('center',{});
        return true;
	}
    return false;
}

Handwheel.prototype.onMouseUp = function(pos) {
    if(this.active) {
        this.deactivate();
        this.emit('release', {});
        return true;
    } else {
        return false;
    }
}

Handwheel.prototype.onMouseMove = function(pos) {
	this._handleMove(pos);
}

Handwheel.prototype._handleMove = function(pos) {

    if(this.pos) {
        var a = dist(this.center, this.pos);
        var b = dist(this.center, pos);
        var c = dist(this.pos, pos);

        theta = Math.acos((a*a + b*b - c*c)/(2*a*b));

        var ta = Math.atan2(this.pos.x-this.center.x, this.pos.y-this.center.y);
        var tb = Math.atan2(pos.x-this.center.x, pos.y-this.center.y);
        var dt = tb-ta;

        if(dt > Math.PI) {
            dt -= 2*Math.PI;
        }
        if(dt < -Math.PI) {
            dt += 2*Math.PI;
        }
        //dt = -dt;
        if(this.active) {
            now = new Date().getTime();
            if(this.time) {
                dtime = now - this.time;
                this.position += dt;
                var rate = Math.abs(dt/dtime);
                this.emit('sweep', {'angle' : -dt, 'rate' : rate, 'thumb' : this.activeThumb});
                this.pos = pos;
                return true;
            }
            this.time = now;
        }
    }
    this.pos = pos;
    return false;
};

Handwheel.prototype.draw = function(ctx) {
	if(!this.visible) { return; }
	this._drawRails(ctx);
	this._drawThumbs(ctx);
	this._drawCenter(ctx);
}

var Scalewheel = function(options) {

	// General size/shape
	this.radius = options.radius || 100;
	this.thumbRadius = options.thumbRadius || this.radius/4.0;
	this.startAngle = options.angleOffset || 2.0*Math.PI/3.0;
	this.endAngle = options.endAngle || Math.PI/3.0;
	this.center = options.center || {x:this.radius+this.thumbRadius, y:this.radius+this.thumbRadius}
	this.position = options.position || 0.0;
	this.visible = true;
	this.active = false;
	this.pos = null;
	this.thumbText = options.thumbText || 'S';

	// Rail Styles	
	this.railColor = options.railColor || '#aaaaaa';
	this.railStyle = options.railStyle || 'solid';
	this.railWidth = options.railWidth || 5;

	// Thumb Styles
	this.thumbColor = options.thumbColor || '#aaaaaa';
	this.thumbTextColor = options.thumbTextColor || '#ffffff';
	this.thumbActiveColor = options.thumbActiveColor || '#999999';
	this.thumbActiveRadius = options.thumbActiveRadius || this.thumbRadius;

	this.centerText = options.centerText || '';
	this.centerTextColor = options.centerTextColor || '#aaaaaa';
	this.centerTextStyle = options.centerTextStyle;

	
   	if(this.endAngle > this.startAngle) {
       	this.range = Math.abs(this.endAngle - this.startAngle);
   	} else {
       	this.range = 2.0*Math.PI - Math.abs(this.startAngle - this.endAngle);           		
   	}

	this.listeners = {};
}

Scalewheel.prototype.on = function(event, callback) {
	if(event in this.listeners) {
		this.listeners[event].push(callback);
	} else {
		this.listeners[event] = [callback];
	}
}

Scalewheel.prototype.emit = function(event, data) {
	if(event in this.listeners) {
		for(i in this.listeners[event]) {
			callback = this.listeners[event][i];
			callback(data);
		}
	}
}

Scalewheel.prototype.show = function() {
	this.visible = true;
}

Scalewheel.prototype.hide = function() {
	this.visible = false;
}

Scalewheel.prototype._getThumbCenter = function() {
	return {x:this.center.x + this.radius*Math.cos(this.startAngle + this.position), y:this.center.y + this.radius*Math.sin(this.startAngle + this.position)};
}

Scalewheel.prototype._drawThumb = function(ctx) {
	var theta = this.startAngle + this.position;
	var center = this._getThumbCenter();
    ctx.beginPath();

    // Draw the thumb circle
    if(this.active) {
        ctx.arc(center.x,center.y,thumb.activeRadius,0,2*Math.PI);
        ctx.fillStyle = this.thumbActiveColor;
    } else {
        ctx.arc(center.x,center.y,thumb.radius,0,2*Math.PI);
        ctx.fillStyle = this.thumbColor;
        ctx.fill();
    }
    ctx.fill();

    // Draw the thumb text
    ctx.font = this.thumbTextStyle;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = this.thumbTextColor;
    ctx.fillText(this.thumbText, center.x, center.y);
       
}

Scalewheel.prototype._hitsThumb = function(pos) {
	var center = this._getThumbCenter();
    if(dist(pos, center) < this.thumbRadius) {
    	return true;
    }
    return false;
}

Scalewheel.prototype._hitsCenter = function(pos) {
	return dist(pos, this.center) < (this.radius - this.thumbActiveRadius);
}

Scalewheel.prototype._drawRail = function(ctx) {
    ctx.beginPath();
    ctx.arc(this.center.x,this.center.y,this.radius,this.startAngle,this.endAngle);    
    ctx.strokeStyle = this.railColor;
    ctx.lineWidth = this.railWidth;
    ctx.lineCap = 'round';
    ctx.stroke();
}

Scalewheel.prototype._drawCenter = function(ctx) {
    if(this.centerText.indexOf('\n') === -1) {
        // Draw the thumb text
        ctx.font = this.centerTextStyle;
        ctx.fillStyle = this.centerTextColor;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.centerText, this.center.x, this.center.y);        
    } else {
        parts = this.centerText.split('\n');
        var top = parts[0];
        var bot = parts[1];

        ctx.font = this.centerTextStyle;
        ctx.fillStyle = this.centerTextColor;
        ctx.textAlign = 'center';

        ctx.textBaseline = 'bottom';
        ctx.fillText(top, this.center.x, this.center.y)

        ctx.textBaseline = 'top';
        ctx.fillText(bot, this.center.x, this.center.y)
    }
}

Scalewheel.prototype.deactivate = function() {
	this.active = false;
	this.pos = null;
}

Scalewheel.prototype.onMouseDown = function(pos) {
	if(this._hitsThumb(pos)) {
		this.pos = pos;
		this.active = true;
        return true;
	}
    return false;
}

Scalewheel.prototype.onMouseUp = function(pos) {
    if(this.active) {
        this.deactivate();
        this.emit('pos', {'pos':this.position/this.range})        
        return true;
    } else {
        return false;
    }
}

Scalewheel.prototype.onMouseMove = function(pos) {
	return this._handleMove(pos);
}

Scalewheel.prototype.onClick = function(pos) {
	if(this._hitsCenter(pos)) {
		this.emit('center',{});
        return true;
	}
    return false;
}

Scalewheel.prototype._handleMove = function(pos) {
    if(this.pos) {
        var a = dist(this.center, this.pos);
        var b = dist(this.center, pos);
        var c = dist(this.pos, pos);

        theta = Math.acos((a*a + b*b - c*c)/(2*a*b));

        var ta = Math.atan2(this.pos.x-this.center.x, this.pos.y-this.center.y);
        var tb = Math.atan2(pos.x-this.center.x, pos.y-this.center.y);
        var dt = tb-ta;

        if(dt > Math.PI) {
            dt -= 2*Math.PI;
        }
        if(dt < -Math.PI) {
            dt += 2*Math.PI;
        }

        dt = -dt;

        if(this.active) {
           	this.position += dt;

           	if(this.position > this.range) {
           		this.position = this.range;
           	}
           	if(this.position < 0) {
           		this.position = 0.0;
           	}
           	this.emit('sweep', {'pos' : this.position/this.range});
            this.pos = pos;
            return true;
        }
    }
    this.pos = pos;
    return false;
};

Scalewheel.prototype.draw = function(ctx) {
	if(!this.visible) { return; }
	this._drawRail(ctx);
	this._drawThumb(ctx);
	this._drawCenter(ctx);
}

Scalewheel.prototype.setCenterText = function(txt) {
	this.centerText = txt;
}

Scalewheel.prototype.setPosition = function(pos) {
	this.position = pos*this.range;
}

var Label = function(options) {
    this.radius = options.radius || 100;
    this.text = options.text || '';
    this.center = options.center || {x:radius, y:radius};
    this.textStyle = options.textStyle || '20px Arial';
    this.textColor = options.textColor || 'black';
    this.position = options.position || 'top';
    this.visible = false;
}

Label.prototype.draw = function(ctx) {

    if(this.visible) {
        if(this.position === 'top') {
            angle = 3.0*Math.PI/2.0;
            textBaseline = 'top';
        } else if(this.position === 'bottom') {
            angle = Math.PI/2.0;
            textBaseline = 'bottom';
        }

        ctx.font = this.textStyle;
        ctx.textAlign = 'center';
        ctx.textBaseline = textBaseline;
        ctx.fillStyle = this.textColor;
        ctx.fillText(this.text, this.center.x + this.radius*Math.cos(angle), 
                                this.center.y + this.radius*Math.sin(angle));
    }

}

Label.prototype.show = function() {
    this.visible = true;
}

Label.prototype.hide = function() {
    this.visible = false;
}

Label.prototype.onMouseDown = function(pos) {};
Label.prototype.onMouseUp = function(pos) {};
Label.prototype.onMouseMove = function(pos) {};
Label.prototype.onClick = function(pos) {};

var Nudger = function(options) {

	// General size/shape
	this.radius = options.radius || 100;
	this.thumbRadius = options.thumbRadius || this.radius/4.0;
	this.startAngle = options.startAngle || 5.0*Math.PI/4.0;
	this.endAngle = options.endAngle || 7.0*Math.PI/4.0;
	this.center = options.center || {x:this.radius+this.thumbRadius, y:this.radius+this.thumbRadius}
	this.position = 0.0;
	this.visible = true;
	this.active = false;
	this.pos = null;
	this.arrow = options.arrow || 'end';

	// Rail Styles	
	this.railColor = options.railColor || '#aaaaaa';
	this.railStyle = options.railStyle || 'solid';
	this.railWidth = options.railWidth || 5;

	// Arrowhead/Label Styles
	this.labelColor = options.labelColor || '#aaaaaa';
	this.labelText = options.labelText || '+';
	this.labelStyle = options.labelStyle || '';
	this.labelActiveStyle = options.labelActiveStyle || options.labelStyle;
	this.arrowLength = options.arrowLength || 20;
	this.arrowWidth = options.arrowWidth || 10;

	this.listeners = {};
}

Nudger.prototype.flash = function(ctx, color, ms) {
    var savedRailColor = this.railColor;
    var savedLabelColor = this.labelColor;
    this.railColor = color;
    this.labelColor = color;
    this.draw(ctx);
    setTimeout(function resetColor() {
        this.railColor = savedRailColor;
        this.labelColor = savedLabelColor;
        this.draw(ctx);
    }.bind(this), ms);
}

Nudger.prototype.on = function(event, callback) {
	if(event in this.listeners) {
		this.listeners[event].push(callback);
	} else {
		this.listeners[event] = [callback];
	}
}

Nudger.prototype.emit = function(event, data) {
	if(event in this.listeners) {
		for(i in this.listeners[event]) {
			callback = this.listeners[event][i];
			callback(data);
		}
	}
}

Nudger.prototype.show = function() {
	this.visible = true;
}

Nudger.prototype.hide = function() {
	this.visible = false;
}

Nudger.prototype._hitsArrow = function(pos) {
    if(this.arrow === 'end') {
        var align = 'left'
        var angle = this.endAngle;
        var p = 1.0;        
    } else {
        var align = 'right'
        var angle = this.startAngle;
        var p = -1.0;               
    }
    var s0 = {x:this.center.x + (this.radius)*Math.cos(angle), y:this.center.y + (this.radius)*Math.sin(angle)};
    var s3 = {x:s0.x + length*Math.cos(angle + p*Math.PI/2.0), y:s0.y + length*Math.sin(angle + p*Math.PI/2.0)};

    var d = dist(pos, s3);
    if(d < Math.max(this.arrowLength, this.arrowWidth)) {return true;}

    var d = dist(pos, this.center);
    var inner = this.radius - this.arrowWidth;
    var outer = this.radius + this.arrowWidth;
    var angle = Math.atan2(-(pos.y - this.center.y),-(pos.x - this.center.x)) + Math.PI;

    if(this.endAngle > this.startAngle) {
        var inAngle = (angle >= this.startAngle && angle <= this.endAngle);
    } else {
        var inAngle = (angle >= this.endAngle && angle <= this.startAngle);        
    }
	return (d >= inner && d <= outer) && inAngle;
}

Nudger.prototype._drawRail = function(ctx) {
    ctx.beginPath();
    ctx.arc(this.center.x,this.center.y,this.radius,this.startAngle,this.endAngle);    
    ctx.strokeStyle = this.railColor;
    ctx.lineWidth = this.railWidth;
    ctx.lineCap = 'round';
    ctx.stroke();
}

Nudger.prototype._drawArrowhead = function(ctx) {
	var length = this.arrowLength;
	var width = this.arrowWidth;

	if(this.arrow === 'end') {
		var align = 'left'
		var angle = this.endAngle;
		var p = 1.0;		
	} else {
		var align = 'right'
		var angle = this.startAngle;
		var p = -1.0;				
	}
	var s0 = {x:this.center.x + (this.radius)*Math.cos(angle), y:this.center.y + (this.radius)*Math.sin(angle)};
	var s1 = {x:this.center.x + (this.radius+(width/2.0))*Math.cos(angle), y:this.center.y + (this.radius+(width/2.0))*Math.sin(angle)};
	var s2 = {x:this.center.x + (this.radius-(width/2.0))*Math.cos(angle), y:this.center.y + (this.radius-(width/2.0))*Math.sin(angle)};
	var s3 = {x:s0.x + length*Math.cos(angle + p*Math.PI/2.0), y:s0.y + length*Math.sin(angle + p*Math.PI/2.0)};

	// Draw the arrow
    ctx.beginPath();
	ctx.moveTo(s1.x, s1.y);
	ctx.lineTo(s2.x, s2.y);
	ctx.lineTo(s3.x, s3.y);
	ctx.closePath();
	ctx.strokeStyle = this.railColor;
    ctx.lineWidth = this.railWidth;
    ctx.fillStyle = this.railColor;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.fill();

    // Draw the text label
    ctx.font = this.labelStyle;
    ctx.textAlign = align;
    ctx.textBaseline = 'top';
    ctx.fillStyle = this.labelColor;
    ctx.fillText(this.labelText, s3.x, s3.y);

}

Nudger.prototype.onMouseDown = function(pos) {
    if(this._hitsArrow(pos)) {
        return true;
    }
}

Nudger.prototype.onMouseUp = function(pos) {
    if(this._hitsArrow(pos)) {
        return true;
    }    
}
Nudger.prototype.onMouseMove = function(pos) {}
Nudger.prototype.onClick = function(pos) {
    if(this._hitsArrow(pos)) {
        this.emit('nudge', {});
        return true;
    }
    return false;
}

Nudger.prototype.draw = function(ctx) {
	if(!this.visible) { return; }
	this._drawRail(ctx);
	this._drawArrowhead(ctx);
}
