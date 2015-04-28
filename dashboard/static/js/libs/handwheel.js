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
    this.modes = options.modes || [''];
    thumbLabels = options.thumbs || [''];

    this.canvas = document.getElementById(element);
    this.ctx = this.canvas.getContext("2d");
    this.w = this.canvas.width;
    this.h = this.canvas.height;
    this.center = {x:this.w/2.0, y:this.h/2.0}
    this.cr = (this.w + this.h)/4.0;
    this.pos = null;
    this.radius = 0.9*this.cr;
    this.textSize = 0.5*this.radius/2.0;
    this.textString = this.textSize + 'pt ' + this.textFont;
    this.active = false;
    this.angle = null;
    this.thumbs = [];
    this.thumb = null;

    var i=0;
    var pos=0;
    while(i < thumbLabels.length) {
        var center = {
            'x' : this.center.x + Math.cos(pos)*this.radius*0.65,
            'y' : this.center.y + Math.sin(pos)*this.radius*0.65
        }
        this.thumbs.push({
            'label' : thumbLabels[i],
            'pos' : pos,
            'center' : center,
            'radius' : this.radius*0.25
        });
        pos += 2*Math.PI/thumbLabels.length;
        i+=1;
    }

    this.middleRadius = 0.9*(dist(this.center, this.thumbs[0].center) - this.thumbs[0].radius);
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
            if(this.active && this.thumb) {
                for(i in this.thumbs) {
                    thumb = this.thumbs[i];
                    thumb.pos += dt;
                    thumb.center.x = this.center.x + Math.cos(thumb.pos)*this.radius*0.65;
                    thumb.center.y = this.center.y + Math.sin(thumb.pos)*this.radius*0.65;    
                }
                this.emit('sweep', {'angle':dt, 'thumb':this.thumb})
                this._draw();
            }
        }
        this.pos = pos;
}

HandWheel.prototype.nextMode = function() {
    this.mode_idx = (this.mode_idx + 1) % this.modes.length;
    this.emit("mode", {"mode":this.getMode()})
    this._draw();
}

HandWheel.prototype.setPPR = function(ppr) {
    this.ppr = ppr;
}

HandWheel.prototype.getMode = function() {
    return this.modes[this.mode_idx];
}

HandWheel.prototype._hitsThumb = function(pos, thumb) {
    return dist(pos, thumb.center) < thumb.radius;
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

HandWheel.prototype._activate = function(pos) {
        this.active = true;
        this.angle = null;
        this.pos = pos;
}

HandWheel.prototype._deactivate = function(evt) {
       this.active = false;
       this.angle = null;
       this.pos = null;
       this.thumb = null;
       this.emit("release", {});
}

HandWheel.prototype._setupListeners = function() {
    this.canvas.addEventListener('mousedown', function(evt) {
        var pos = this._getMousePos(evt);
        if(this._hitsMiddle(pos)) {
            this.nextMode();
        } else {
            for(i in this.thumbs) {
                thumb = this.thumbs[i];
                if(this._hitsThumb(pos, thumb)) {
                    this.thumb = thumb.label;
                    this._activate(pos);
                }
            }
        }
        evt.stopPropagation();
        evt.preventDefault();
    }.bind(this));

    this.canvas.addEventListener('mouseup', function(evt) {
        this._deactivate(evt);
        this._draw();
    }.bind(this));   
    
    this.canvas.addEventListener('blur', function(evt) {
        this._deactivate(evt);
        this._draw();
    }.bind(this));

    this.canvas.addEventListener('touchstart', function(evt) {
        var pos = this._getMousePos(evt);
        if(this._hitsMiddle(pos)) {
            this.nextMode();
        } else {
            for(i in this.thumbs) {
                thumb = this.thumbs[i];
                if(this._hitsThumb(pos, thumb)) {
                    this.thumb = thumb.label
                    this._activate(pos);
                }
            }
        }
        evt.stopPropagation();
        evt.preventDefault();
    }.bind(this), false);
    
    this.canvas.addEventListener('touchend', function(evt) {
        this._deactivate(evt);
        this._draw();
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
    this._drawThumbs();  
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

HandWheel.prototype._drawThumbs = function() {
    var ctx = this.ctx;
    for(i in this.thumbs) {
        thumb = this.thumbs[i];
        ctx.beginPath();
        ctx.arc(thumb.center.x,thumb.center.y,thumb.radius,0,2*Math.PI);
        ctx.strokeStyle = this.lineColor;
        ctx.fillStyle = this.thumbColor;
        if(this.active) {
            ctx.globalAlpha = (this.thumb === thumb.label) ? 1.0 : 0.5;
        } else {
            ctx.globalAlpha = 1.0;
        }
        ctx.fill();
        ctx.stroke();
        ctx.font = this.textString;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = this.textColor;
        ctx.fillText(thumb.label, thumb.center.x, thumb.center.y);
        ctx.globalAlpha = 1.0;
    }
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
