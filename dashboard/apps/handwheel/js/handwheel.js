var HandWheel = function(element, options) {
    var options = options || {}
    this.ppr = options.ppr || 16;
    this.wheelColor = options.wheelColor || "#ffffff";
    this.thumbColor = options.thumbColor || "#ffffff";
    this.bgColor = options.bgColor || null;
    this.canvas = document.getElementById(element);
    this.ctx = this.canvas.getContext("2d");
    this.w = this.canvas.width;
    this.h = this.canvas.height;
    this.cx = this.w/2.0;
    this.cy = this.h/2.0;
    this.cr = (this.w + this.h)/4.0;
    this.thumbPosition = 0.0;

    this.pos = null;
    this.radius = 0.9*this.cr;
    this.active = false;
    this.angle = null;

    this.handlers = {};
    this._setupListeners();
    this._draw();
}

function dist(x1,y1,x2,y2) {
    return Math.sqrt((x2-x1)*(x2-x1) + (y2-y1)*(y2-y1))
}

function deg(x) {
    return x*180.0/Math.PI
}
HandWheel.prototype._handleMove = function(evt) {
        var pos = this._getMousePos(evt);
        
        if(this.pos) {
            var a = dist(this.cx,this.cy, this.pos.x, this.pos.y);
            var b = dist(this.cx,this.cy, pos.x, pos.y);
            var c = dist(this.pos.x,this.pos.y, pos.x, pos.y);

            theta = Math.acos((a*a + b*b - c*c)/(2*a*b));

            var ta = Math.atan2(this.pos.x-this.cx, this.pos.y-this.cy);
            var tb = Math.atan2(pos.x-this.cx, pos.y-this.cy);
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
                this.emit('sweep', {'angle':dt})
                this._draw();
            }
        }
        this.pos = pos;
}

HandWheel.prototype._activate = function(evt) {
        this.active = true;
        this.angle = null;
        this.pos = null;
}

HandWheel.prototype._deactivate = function(evt) {
       this.active = false;
       this.angle = null;
       this.pos = null;
       this.emit("release", {});
}

HandWheel.prototype._setupListeners = function() {
    this.canvas.addEventListener('mousedown', function(evt) {
        this._activate(evt);
    }.bind(this));

    this.canvas.addEventListener('mouseup', function(evt) {
        this._deactivate(evt);
    }.bind(this));   
    
    this.canvas.addEventListener('touchstart', function(evt) {
        this._activate(evt);
    }.bind(this), false);
    
    this.canvas.addEventListener('touchend', function(evt) {
        this._deactivate(evt);
    }.bind(this), false);
    
    this.canvas.addEventListener('touchmove', this._handleMove.bind(this), false);
    this.canvas.addEventListener('mousemove', this._handleMove.bind(this), false);
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
}

HandWheel.prototype._drawCircle = function() {
    var ctx = this.ctx; 
    ctx.beginPath();
    ctx.arc(this.cx,this.cy,this.radius,0,2*Math.PI);    
    ctx.strokeStyle = "#000000";
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
    var r = this.radius*0.25;
    var cx = this.cx + Math.cos(this.thumbPosition)*this.radius*0.65;
    var cy = this.cy + Math.sin(this.thumbPosition)*this.radius*0.65;    
    ctx.beginPath();
    ctx.arc(cx,cy,r,0,2*Math.PI);
    ctx.strokeStyle = "#000000";
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
