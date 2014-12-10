function FabMoUI(tool, options){
	this.tool = tool;
	// the tool we need to check for

	this.prefix = '';
	// useful if several tools in the same app.

	this.refresh = 50;
	// define the status refresh time.

	this.keypad = true;
	// able or disable the keypad.

	this.move_step = '0.5';
	//1 step of keypad, in inches

	this.file_control= true;

	if (options){
		this.prefix = options.prefix ? options.prefix + '-' : ''; 
		this.refresh = options.refresh || 100;
		this.keypad = (options.keypad === false ) ? false : true;
		this.file_control = (options.file_control === false ) ? false : true;
	}

	this.status_div_selector = '.fabmo-'+this.prefix+'status';
	this.keypad_div_selector = '.fabmo-'+this.prefix+'keypad';
	this.file_control_selector = '.fabmo-'+this.prefix+'file-control';


	this.posX_selector = this.status_div_selector + ' .posx';
	this.posY_selector = this.status_div_selector + ' .posy';
	this.posZ_selector = this.status_div_selector + ' .posz';
	this.state_selector = this.status_div_selector + ' .state';
	this.file_info_div_selector = this.status_div_selector + ' .file-info';
	this.filename_selector = this.file_info_div_selector + ' .filename';
	this.progress_selector = this.file_info_div_selector + ' .progress';


	this.stop_button_selector = this.file_control_selector + ' .fabmo-stop-button';
	this.resume_button_selector = this.file_control_selector + ' .fabmo-resume-button';
	this.pause_button_selector = this.file_control_selector + ' .fabmo-pause-button';


	this.plusX_button_selector = this.keypad_div_selector + ' .button-plus-X';
	this.minusX_button_selector = this.keypad_div_selector + ' .button-minus-X';
	this.plusY_button_selector = this.keypad_div_selector + ' .button-plus-Y';
	this.minusY_button_selector = this.keypad_div_selector + ' .button-minus-Y';
	this.plusZ_button_selector = this.keypad_div_selector + ' .button-plus-Z';
	this.minusZ_button_selector = this.keypad_div_selector + ' .button-minus-Z';


	setInterval(this.updateStatus.bind(this),this.refresh);


	if(this.keypad){
		this.my_keypad = this.Keypad;
		this.Keypad();
	}

	if(this.file_control){
		this.my_file_control = this.FileControl;
		this.FileControl();
	}

}

FabMoUI.prototype.lock = function(){
	this.right = false;
	this.left = false;
	this.up = false;
	this.down = false;
	this.page_up = false;
	this.page_down = false;
};

FabMoUI.prototype.Keypad = function(){
	var that = this;
	that.locks=new that.lock();
	this.keypad_allow=false;
	this.menu_open=false;

	$("#trackpad-zone").click(function(e){
		var posX = e.pageX  - ($("body").width() - $("#right-menu").width());
        var posY = e.pageY - $("#trackpad-zone").position().top - 44.5;

        posX = posX/$("#trackpad-zone").width();
        posY = posY/$("#trackpad-zone").height();

        if(posX <= 0.333) {
        	if(posY <=0.333)		{ 
        		console.log("Left Top");
        		that.tool.gcode2('G91 G01 X-'+that.move_step+' Y'+that.move_step); 
        	}
        	else if (posY <= 0.666)	{ 
        		console.log("Left Middle");
        		that.tool.gcode2('G91 G01 X-'+that.move_step); 
        	}
        	else 					{ 
        		console.log("Left Bottom");
        		that.tool.gcode2('G91 G01 X-'+that.move_step+' Y-'+that.move_step); 
        	}
        }
        else if (posX <= 0.666){
        	if(posY <=0.333)		{ 
        		console.log("Middle Top");
        		that.tool.gcode2('G91 G01 Y'+that.move_step); 
        	}
        	else if (posY <= 0.666)	{ 
        		console.log("Center : do nothing");
        	}
        	else 					{ 
        		console.log("Middle Bottom");
        		that.tool.gcode2('G91 G01 Y-'+that.move_step); 
        	}
        }
    	else {
        	if(posY <=0.333)		{ 
        		console.log("Right Top");
        		that.tool.gcode2('G91 G01 X'+that.move_step+' Y'+that.move_step); 
        	}
        	else if (posY <= 0.666)	{ 
        		console.log("Right Middle");
        		that.tool.gcode2('G91 G01 X'+that.move_step); 
        	}
        	else 					{ 
        		console.log("Right Bottom");
        		that.tool.gcode2('G91 G01 X'+that.move_step+' Y-'+that.move_step); 
        	}
        }
	});

	$(document).keydown(function(e) {
		that.updateStatus.bind(that);
		if (that.keypad_allow && that.menu_open){
			if (e.which === 37 && !that.locks.left && !that.locks.right) //left
			{
				that.locks.left=true;
				that.tool.start_move("-x",that.locks,function(){});
			}
			if (e.which === 38 && !that.locks.up && !that.locks.down) //up
			{
				that.locks.up=true;
				that.tool.start_move("y",that.locks,function(){});
			}
			if (e.which === 39 && !that.locks.right && !that.locks.left) //right
			{
				that.locks.right=true;
				that.tool.start_move("x",that.locks,function(){});			}
			if (e.which === 40 && !that.locks.up && !that.locks.down) //down
			{
				that.locks.down=true;
				that.tool.start_move("-y",that.locks,function(){});
			}
			if (e.which === 33 && !that.locks.page_up && !that.locks.page_down) //page_up
			{
				that.locks.page_up=true;
				that.tool.start_move("z",that.locks,function(){});
			}
			if (e.which === 34 && !that.locks.page_up && !that.locks.page_down) //page_down
			{
				that.locks.page_down=true;
				that.tool.start_move("-z",that.locks,function(){});
			}
		}
	});

	$(document).keyup(function(e) {
		that.updateStatus.bind(that);
		if (that.keypad_allow){
			if (e.which === 37 ) //left
			{
				that.locks.left=false;
				that.tool.stop_move(function(){});
			}
			if (e.which === 38 ) //up
			{
				that.locks.up=false;
				that.tool.stop_move(function(){});
			}
			if (e.which === 39 ) //right
			{
				that.locks.right=false;
				that.tool.stop_move(function(){});
			}
			if (e.which === 40 ) //down
			{
				that.locks.down=false;
				that.tool.stop_move(function(){});
			}
			if (e.which === 33 ) //page_up
			{
				that.locks.page_up=false;
				that.tool.stop_move(function(){});
			}
			if (e.which === 34 ) //page_down
			{
				that.locks.page_down=false;
				that.tool.stop_move(function(){});
			}
		}
	});

	$(that.plusX_button_selector).mousedown(function(e) {
		var e1 = jQuery.Event("keydown");
		e1.which = 39; 
		$(that.keypad_div_selector).trigger(e1);
		$(this).mouseleave(function(e){
			var e1 = jQuery.Event("keyup");
			e1.which = 39;
			$(that.keypad_div_selector).trigger(e1);
			$(this).unbind('mouseleave');
		});
	}); 
	$(that.minusX_button_selector).mousedown(function(e) {
		var e1 = jQuery.Event("keydown");
		e1.which = 37; 
		$(that.keypad_div_selector).trigger(e1);
		$(this).mouseleave(function(e){
			var e1 = jQuery.Event("keyup");
			e1.which = 37;
			$(that.keypad_div_selector).trigger(e1);
			$(this).unbind('mouseleave');
		});
	});
	$(that.plusY_button_selector).mousedown(function(e) {
		var e1 = jQuery.Event("keydown");
		e1.which = 38; 
		$(that.keypad_div_selector).trigger(e1);
		$(this).mouseleave(function(e){
			var e1 = jQuery.Event("keyup");
			e1.which = 38;
			$(that.keypad_div_selector).trigger(e1);
			$(this).unbind('mouseleave');
		});
	}); 
	$(that.minusY_button_selector).mousedown(function(e) {
		var e1 = jQuery.Event("keydown");
		e1.which = 40; 
		$(that.keypad_div_selector).trigger(e1);
		$(this).mouseleave(function(e){
			var e1 = jQuery.Event("keyup");
			e1.which = 40;
			$(that.keypad_div_selector).trigger(e1);
			$(this).unbind('mouseleave');
		});
	});
	$(that.plusZ_button_selector).mousedown(function(e) {
		var e1 = jQuery.Event("keydown");
		e1.which = 33; 
		$(that.keypad_div_selector).trigger(e1);
		$(this).mouseleave(function(e){
			var e1 = jQuery.Event("keyup");
			e1.which = 33;
			$(that.keypad_div_selector).trigger(e1);
			$(this).unbind('mouseleave');
		});
	}); 
	$(that.minusZ_button_selector).mousedown(function(e) {
		var e1 = jQuery.Event("keydown");
		e1.which = 34; 
		$(that.keypad_div_selector).trigger(e1);
		$(this).mouseleave(function(e){
			var e1 = jQuery.Event("keyup");
			e1.which = 34;
			$(that.keypad_div_selector).trigger(e1);
			$(this).unbind('mouseleave');
		});
	});

	$(that.plusX_button_selector).mouseup(function(e) {
		var e1 = jQuery.Event("keyup");
		e1.which = 39; 
		$(that.keypad_div_selector).trigger(e1);
	}); 
	$(that.minusX_button_selector).mouseup(function(e) {
		var e1 = jQuery.Event("keyup");
		e1.which = 37; 
		$(that.keypad_div_selector).trigger(e1);
	});
	$(that.plusY_button_selector).mouseup(function(e) {
		var e1 = jQuery.Event("keyup");
		e1.which = 38; 
		$(that.keypad_div_selector).trigger(e1);
	}); 
	$(that.minusY_button_selector).mouseup(function(e) {
		var e1 = jQuery.Event("keyup");
		e1.which = 40; 
		$(that.keypad_div_selector).trigger(e1);
	});
	$(that.plusZ_button_selector).mouseup(function(e) {
		var e1 = jQuery.Event("keyup");
		e1.which = 33; 
		$(that.keypad_div_selector).trigger(e1);
	}); 
	$(that.minusZ_button_selector).mouseup(function(e) {
		var e1 = jQuery.Event("keyup");
		e1.which = 34; 
		$(that.keypad_div_selector).trigger(e1);
	});
};

FabMoUI.prototype.setMenuOpen = function(){
	this.menu_open = true;
};

FabMoUI.prototype.setMenuClosed = function(){
	this.menu_open = false;
};

FabMoUI.prototype.allowKeypad = function(){
	this.keypad_allow = true;
	$(this.keypad_div_selector).show();
	$("#keypad").addClass("hidden");
};

FabMoUI.prototype.forbidKeypad = function(){
	this.keypad_allow = false;
	$(this.keypad_div_selector).hide();
	$("#keypad").removeClass("hidden");
};

FabMoUI.prototype.statusKeypad = function(){
	return this.keypad_allow;
}

FabMoUI.prototype.updateText = function(control, txt) {
	t = control.text();
	v = control.val();
	if(t != txt) {
		control.text(txt);
	}
	if(v != txt) {
		control.val(txt);
	}
};

FabMoUI.prototype.updateStatus = function(){
	var that=this;
	that.tool.get_status(function(err, status){
		if(!err){
			that.tool.state=status.state;

			var x = status.posx.toFixed(3);
			var y = status.posy.toFixed(3);
			var z = status.posz.toFixed(3);
			that.updateText($(that.posX_selector), x);
			that.updateText($(that.posY_selector), y);
			that.updateText($(that.posZ_selector), z);
			if(status.current_file) {
				$(that.file_info_div_selector).removeClass('hide');
				$(that.filename_selector).html(status.current_file);
				var prog = ((status.line/status.nb_lines)*100).toFixed(2);
				that.updateText($(that.progress_selector),prog + '%');
			} else {
				$(that.file_info_div_selector).addClass('hide');
				$(that.filename_selector).empty();
				$(that.progress_selector).empty();
			}
			$(that.status_div_selector).trigger('statechange',status.state);
			if(status.state === 'idle') {
				that.allowKeypad();
				$(that.status_div_selector).removeClass('fabmo-status-running fabmo-status-paused fabmo-status-error fabmo-status-disconnected fabmo-status-idle fabmo-status-passthrough');
				$(that.status_div_selector).removeClass('fabmo-status-idle');
				$(".tools-current > li a").removeClass('paus err disc');
				$(that.state_selector).html('Idle');
				if(that.file_control)
				{
					$(that.stop_button_selector).addClass('hide');
					$(that.resume_button_selector).addClass('hide');
					$(that.pause_button_selector).addClass('hide');
				}
			}
			else if(status.state === 'running' || status.state === 'homing' || status.state === 'probing') {
				that.forbidKeypad();
				$(that.status_div_selector).removeClass('fabmo-status-running fabmo-status-paused fabmo-status-error fabmo-status-disconnected fabmo-status-idle fabmo-status-passthrough');
				$(that.status_div_selector).removeClass('fabmo-status-running');
				$(".tools-current > li a").removeClass('paus disc').addClass('err');
				$(that.state_selector).html('' + status.state);
				if(that.file_control)
				{
					$(that.stop_button_selector).removeClass('hide');
					$(that.pause_button_selector).removeClass('hide');
					$(that.resume_button_selector).addClass('hide');
				}
			}
			else if(status.state === 'manual') {
				that.allowKeypad();
				$(that.status_div_selector).removeClass('fabmo-status-running fabmo-status-paused fabmo-status-error fabmo-status-disconnected fabmo-status-idle fabmo-status-passthrough');
				$(that.status_div_selector).removeClass('fabmo-status-running');
				$(".tools-current > li a").removeClass('disc err').addClass('paus');
				$(that.state_selector).html('' + status.state);
				if(that.file_control)
				{
					$(that.stop_button_selector).addClass('hide');
					$(that.resume_button_selector).addClass('hide');
					$(that.pause_button_selector).addClass('hide');
				}
			}
			else if(status.state === 'paused') {
				$(that.status_div_selector).removeClass('fabmo-status-running fabmo-status-paused fabmo-status-error fabmo-status-disconnected fabmo-status-idle fabmo-status-passthrough');
				$(that.status_div_selector).removeClass('fabmo-status-paused');
				$(".tools-current > li a").removeClass('paus disc err').addClass('paus');
				$(that.state_selector).html('' + status.state);
				if(that.file_control)
				{
					$(that.stop_button_selector).removeClass('hide');
					$(that.pause_button_selector).addClass('hide');
					$(that.resume_button_selector).removeClass('hide');
				}
			} 
			else if(status.state === 'passthrough') {
				that.forbidkeypad();
				$(".tools-current > li a").removeClass('paus disc err').addClass('paus');
				$(that.status_div_selector).removeClass('fabmo-status-running fabmo-status-paused fabmo-status-error fabmo-status-disconnected fabmo-status-idle fabmo-status-passthrough');
				$(that.status_div_selector).addClass('fabmo-status-passthrough');
				$(that.state_selector).html('passthrough');
				$(that.stop_button_selector).addClass('hide');
				$(that.pause_button_selector).addClass('hide');
				$(that.resume_button_selector).addClass('hide');
			}
			else if(status.state == 'limit') {
				that.forbidkeypad();
				$(that.status_div_selector).removeClass('fabmo-status-running fabmo-status-paused fabmo-status-error fabmo-status-disconnected fabmo-status-idle fabmo-status-passthrough');
				$(that.status_div_selector).removeClass('fabmo-status-error');
				$(".tools-current > li a").removeClass('paus err').addClass('disc');
				$(that.state_selector).html(status.state);
				if(that.file_control)
				{
					$(that.pause_button_selector).addClass('hide');
					$(that.resume_button_selector).removeClass('hide');
					$(that.stop_button_selector).addClass('hide');
				}
			}
			else {
				$(".tools-current > li a").removeClass('paus err').addClass('disc');
				that.forbidkeypad();
				console.log('Unknown status');
			}
		}
		else if(err == that.tool.default_error.no_device){
			that.forbidKeypad();
			$(".tools-current > li a").removeClass('paus err').addClass('disc');
			delete this;
			$(that.posX_selector).html('X.XXX');
			$(that.posY_selector).html('X.XXX');
			$(that.posZ_selector).html('X.XXX');
			$(that.status_div_selector).removeClass('fabmo-status-running fabmo-status-paused fabmo-status-error fabmo-status-disconnected fabmo-status-idle fabmo-status-passthrough');
			$(that.status_div_selector).removeClass('fabmo-status-disconnected');
			$(that.state_selector).html('Disconnected');
			$(that.status_div_selector).trigger('statechange','Disconnected');
			if(that.file_control)
			{
				$(that.stop_button_selector).addClass('hide');
				$(that.pause_button_selector).addClass('hide');
				$(that.resume_button_selector).addClass('hide');
			}

		}
		else{
			that.forbidKeypad();
			$(".tools-current > li a").removeClass('paus err').addClass('disc');
			delete this;
			$(that.posX_selector).html('X.XXX');
			$(that.posY_selector).html('X.XXX');
			$(that.posZ_selector).html('X.XXX');
			$(that.status_div_selector).removeClass('fabmo-status-running fabmo-status-paused fabmo-status-error fabmo-status-disconnected fabmo-status-idle fabmo-status-passthrough');
			$(that.status_div_selector).removeClass('fabmo-status-disconnected');
			$(that.state_selector).html('Unknown Error');
			$(that.status_div_selector).trigger('statechange','Error');
			if(that.file_control)
			{
				$(that.stop_button_selector).addClass('hide');
				$(that.pause_button_selector).addClass('hide');
				$(that.resume_button_selector).addClass('hide');
			}
		}
	});

};

FabMoUI.prototype.FileControl = function(){
	var that = this;
	$(that.pause_button_selector).click(function(e) {
		that.tool.pause(function(){});
	});
	$(that.resume_button_selector).click(function(e) {
		that.tool.resume(function(){});
	});
	$(that.stop_button_selector).click(function(e) {
		that.tool.quit(function(){});
	});

 };