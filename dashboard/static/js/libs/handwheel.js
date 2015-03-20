var HandWheel = function(element, options) {
    
    // Deal with user supplied options
    var options = options || {}
    this.ppr = options.ppr || 16;
    this.wheelColor = options.wheelColor || "#ffffff";
    this.thumbColor = options.thumbColor || "#ffffff";
    this.lineColor = options.lineColor || "#000000";
    this.textColor = options.textColor || "#000000";
    this.bgColor = options.bgColor || null;
    this.textFont = options.textFont || "Arial, Helvetica, sans-serif"
    this.modes = options.modes || ['X','Y','Z'];

    this.canvas = document.getElementById(element);
    this.ctx = this.canvas.getContext("2d");
    this.w = this.canvas.width;
    this.h = this.canvas.height;
    this.center = {x:this.w/2.0, y:this.h/2.0}
    this.cr = (this.w + this.h)/4.0;
    this.thumbPosition = -1.57079632679;
    this.pos = null;
    this.radius = 0.9*this.cr;
    this.textSize = 0.9*this.radius/2.0;
    this.textString = this.textSize + 'pt ' + this.textFont;
    this.active = false;
    this.angle = null;
    this.thumbRadius = this.radius*0.25;
    this.thumbCenter = {}
    this.thumbCenter.x = this.center.x + Math.cos(this.thumbPosition)*this.radius*0.65;
    this.thumbCenter.y = this.center.y + Math.sin(this.thumbPosition)*this.radius*0.65;
    this.middleRadius = 0.9*(dist(this.center, this.thumbCenter) - this.thumbRadius);
    this.mode_idx = 0;
    this.handlers = {};
    this._setupListeners();
    this._draw();
}

function dist(a,b) {
    return Math.sqrt((b.x-a.x)*(b.x-a.x) + (b.y-a.y)*(b.y-a.y))
}

function deg(x) {
    return x*180.0/Math.PI
}

HandWheel.prototype._handleMove = function(evt) {
        var pos = this._getMousePos(evt);
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
                this.thumbPosition += dt;
                this.thumbCenter.x = this.center.x + Math.cos(this.thumbPosition)*this.radius*0.65;
                this.thumbCenter.y = this.center.y + Math.sin(this.thumbPosition)*this.radius*0.65;    
                this.emit('sweep', {'angle':dt})
                this._draw();
            }
        }
        this.pos = pos;
}

HandWheel.prototype.nextMode = function() {
    this.mode_idx = (this.mode_idx + 1) % this.modes.length;
    this.emit("mode", {mode:this.getMode()})
    this._draw();
}

HandWheel.prototype.getMode = function() {
    return this.modes[this.mode_idx];
}

HandWheel.prototype._hitsThumb = function(pos) {
    return dist(pos, this.thumbCenter) < this.thumbRadius;
}

HandWheel.prototype._hitsMiddle = function(pos) {
    return dist(pos, this.center) < this.middleRadius;
}

HandWheel.prototype._drawText = function() {
    var ctx = this.ctx;
    ctx.font = this.textString;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = this.textColor;
    ctx.fillText(this.modes[this.mode_idx], this.center.x, this.center.y);
}

HandWheel.prototype._activate = function(evt) {
        this.active = true;
        this.angle = null;
        this.pos = this._getMousePos(evt);
}

HandWheel.prototype._deactivate = function(evt) {
       this.active = false;
       this.angle = null;
       this.pos = null;
       this.emit("release", {});
}

HandWheel.prototype._setupListeners = function() {
    this.canvas.addEventListener('mousedown', function(evt) {
        pos = this._getMousePos(evt);
        if(this._hitsThumb(pos)) {
            this._activate(evt);
        } else if(this._hitsMiddle(pos)) {
            this.nextMode();
        }
        evt.stopPropagation();
        evt.preventDefault();
    }.bind(this));

    this.canvas.addEventListener('mouseup', function(evt) {
        this._deactivate(evt);
    }.bind(this));   
    
    this.canvas.addEventListener('blur', function(evt) {
        this._deactivate(evt);
    }.bind(this));

    this.canvas.addEventListener('touchstart', function(evt) {
        pos = this._getMousePos(evt);
        if(this._hitsThumb(pos)) {
            this._activate(evt);
        } else if(this._hitsMiddle(pos)) {
            this.nextMode();
        }
        evt.stopPropagation();
        evt.preventDefault();
    }.bind(this), false);
    
    this.canvas.addEventListener('touchend', function(evt) {
        this._deactivate(evt);
    }.bind(this), false);
    
    this.canvas.addEventListener('touchmove', function(evt) {
        if(this.active) { this._handleMove(evt) }
    }.bind(this), false);
    
    this.canvas.addEventListener('mousemove', function(evt) {
        if(this.active) { this._handleMove(evt) }
    }.bind(this), false);
}

HandWheel.prototype.on = function(event, handler) {
    this.handlers[event] = handler;
}

HandWheel.prototype.emit = function(event, data) {
    if(event in this.handlers) {
        this.handlers[event](data);
    }
}

HandWheel.prototype._draw = function() {
    this._clear();
    this._drawCircle();
    this._drawThumb();  
    this._drawText();  
}

HandWheel.prototype._drawCircle = function() {
    var ctx = this.ctx; 
    ctx.beginPath();
    ctx.arc(this.center.x,this.center.y,this.radius,0,2*Math.PI);    
    ctx.strokeStyle = this.lineColor;
    ctx.fillStyle = this.wheelColor;   
    ctx.fill();
    ctx.stroke();
}

HandWheel.prototype._clear = function() {
    var ctx = this.ctx;
    if(this.bgColor) {
        ctx.fillRect(0,0,this.w,this.h);
    } else {
        ctx.fillStyle = this.bgColor;
        ctx.clearRect(0,0,this.w,this.h)
    }
}

HandWheel.prototype._drawThumb = function() {
    var ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(this.thumbCenter.x,this.thumbCenter.y,this.thumbRadius,0,2*Math.PI);
    ctx.strokeStyle = this.lineColor;
    ctx.fillStyle = this.thumbColor;
    ctx.fill();
    ctx.stroke();
}

HandWheel.prototype._getMousePos = function(evt) {
    var rect = this.canvas.getBoundingClientRect();
    if(evt.targetTouches) {
        return {
            x: evt.targetTouches[0].pageX - rect.left,
            y: evt.targetTouches[0].pageY - rect.top
        };
        
    } else {
        return {
            x: evt.clientX - rect.left,
            y: evt.clientY - rect.top
        };
    }
}
