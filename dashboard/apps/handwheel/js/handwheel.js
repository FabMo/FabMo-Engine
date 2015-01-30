var HandWheel = function(element, options) {
    var options = options || {}
    this.ppr = options.ppr || 16;
    this.wheelColor = options.wheelColor || "#ffffff";
    this.thumbColor = options.thumbColor || "#ffffff";
    this.bgColor = options.bgColor || null;
    this.active = false;
    this.canvas = document.getElementById(element);
    console.log(element)
    console.log(this.canvas)
    this.ctx = this.canvas.getContext("2d");
    this.w = this.canvas.width;
    this.h = this.canvas.height;
    this.cx = this.w/2.0;
    this.cy = this.h/2.0;
    this.cr = (this.w + this.h)/4.0;
    this.pos = 0;
    this.radius = 0.9*this.cr;
    this.mouse_pressed = false;
    this.handlers = {};
    this._setupListeners();
    this._draw();
}

HandWheel.prototype._handleMove = function(evt) {
        var pos = this._getMousePos(evt);
        var mouseAngle = Math.atan2(this.cx-pos.x, -(this.cy-pos.y))+Math.PI;
        var quadrant = Math.floor(mouseAngle/(2*Math.PI/this.ppr))
    
        if(this.mousePressed && (quadrant != this.q)) {
            if(quadrant == ((this.q+1)%this.ppr)) {
                this.pos = (this.pos + 1)%this.ppr;
                this.emit('tick', {count:+1})
            }
    
            if(quadrant == ((this.q-1)%this.ppr)) {
                this.pos -= 1;
                if(this.pos < 0) { this.pos = this.ppr-1;}
                this.emit('tick', {count:-1})
            }
            
            this._draw();
        }
        this.q = quadrant;
}

HandWheel.prototype._setupListeners = function() {
    this.canvas.addEventListener('mousedown', function(evt) {
        this.mousePressed = true;
        this.q = null;
    }.bind(this));

    this.canvas.addEventListener('mouseup', function(evt) {
       this.mousePressed = false;
       this.q = null;
    }.bind(this));   
    
    this.canvas.addEventListener('mousemove', this._handleMove.bind(this), false);

    this.canvas.addEventListener('touchstart', function(evt) {
        this.mousePressed = true;
        this.q = null;
    }.bind(this), false);
    
    this.canvas.addEventListener('touchend', function(evt) {
       this.mousePressed = false;
       this.q = null;    
    }.bind(this), false);
    
    this.canvas.addEventListener('touchmove', this._handleMove.bind(this), false);

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
    var theta = 2*Math.PI/this.ppr;
    var cx = this.cx + Math.cos(this.pos*theta)*this.radius*0.65;
    var cy = this.cy + Math.sin(this.pos*theta)*this.radius*0.65;    
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
