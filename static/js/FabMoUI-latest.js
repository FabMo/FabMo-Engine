$('.fabmo-state').removeClass('fabmo-status-running fabmo-status-paused fabmo-status-error fabmo-status-disconnected fabmo-status-idle ');
$('.fabmo-state').addClass('fabmo-status-idle');
$('.fabmo-state').html(status.state);
$('.fabmo-posx').html(status.posx);

function FabMoUI(tool, options){
	this.event_handlers = {'status' : []};

	this.tool = tool;
	// the tool we need to check for

	this.prefix = '';
	// useful if several tools in the same app.

	this.refresh = 100;
	// define the status refresh time.

	this.keypad = true;
	// able or disable the keypad.

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


	this.stop_button_selector = this.file_control_selector + ' .fabmo-stop-button'
	this.resume_button_selector = this.file_control_selector + ' .fabmo-resume-button';
	this.pause_button_selector = this.file_control_selector + ' .fabmo-pause-button';
	this.new_stop_selector = this.file_control_selector + ' .stopJob';

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
		this.FileControl()
	}

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
}

FabMoUI.prototype.updateStatus = function(){
	var that=this;
	that.tool.get_status(function(err, status){
		if(!err){

			handlers = that.event_handlers['status'];
			for(var i=0; i<handlers.length; i++) {
				typeof handlers[i] === 'function' && handlers[i](status);
			}

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
				$(that.status_div_selector).removeClass('fabmo-status-running fabmo-status-paused fabmo-status-error fabmo-status-disconnected fabmo-status-idle fabmo-status-passthrough');
				$(that.status_div_selector).removeClass('fabmo-status-idle');
				$(that.state_selector).html('Idle');
				if(that.file_control)
				{
					$(that.stop_button_selector).addClass('hide');
					$(that.resume_button_selector).addClass('hide');
					$(that.pause_button_selector).addClass('hide');
				}
			}
			else if(status.state === 'running' || status.state === 'homing' || status.state === 'probing') {
				
				$(that.status_div_selector).removeClass('fabmo-status-running fabmo-status-paused fabmo-status-error fabmo-status-disconnected fabmo-status-idle fabmo-status-passthrough');
				$(that.status_div_selector).removeClass('fabmo-status-running');
				$(that.state_selector).html('' + status.state);
				if(that.file_control)
				{
					$(that.stop_button_selector).removeClass('hide');
					$(that.pause_button_selector).removeClass('hide');
					$(that.resume_button_selector).addClass('hide');
				}
			}
			else if(status.state === 'manual') {
				$(that.status_div_selector).removeClass('fabmo-status-running fabmo-status-paused fabmo-status-error fabmo-status-disconnected fabmo-status-idle fabmo-status-passthrough');
				$(that.status_div_selector).removeClass('fabmo-status-running');
				$(that.state_selector).html('' + status.state);
				if(that.file_control)
				{
					$(that.stop_button_selector).addClass('hide');
					$(that.resume_button_selector).addClass('hide');
					$(that.pause_button_selector).addClass('hide');
				}
			}
			else if(status.state == 'paused') {
				$(that.status_div_selector).removeClass('fabmo-status-running fabmo-status-paused fabmo-status-error fabmo-status-disconnected fabmo-status-idle fabmo-status-passthrough');
				$(that.status_div_selector).removeClass('fabmo-status-paused');
				$(that.state_selector).html('' + status.state);
				if(that.file_control)
				{
					$(that.stop_button_selector).removeClass('hide');
					$(that.pause_button_selector).addClass('hide');
					$(that.resume_button_selector).removeClass('hide');
				}
			} 
			else if(status.state == 'passthrough') {
				$(that.status_div_selector).removeClass('fabmo-status-running fabmo-status-paused fabmo-status-error fabmo-status-disconnected fabmo-status-idle fabmo-status-passthrough');
				$(that.status_div_selector).addClass('fabmo-status-passthrough');
				$(that.state_selector).html('passthrough');
				$(that.pause_button_selector).addClass('hide');
				$(that.pause_button_selector).addClass('hide');
				$(that.pause_button_selector).addClass('hide');
			}
			else if(status.state == 'limit') {
				$(that.status_div_selector).removeClass('fabmo-status-running fabmo-status-paused fabmo-status-error fabmo-status-disconnected fabmo-status-idle fabmo-status-passthrough');
				$(that.status_div_selector).removeClass('fabmo-status-error');
				$(that.state_selector).html(status.state);
				if(that.file_control)
				{
					$(that.pause_button_selector).addClass('hide');
					$(that.resume_button_selector).removeClass('hide');
					$(that.stop_button_selector).addClass('hide');
				}
			}
			else {
				console.log('unknown status');
			}
		}
		else if(err == that.tool.default_error.no_device){
			$(that.posX_selector).html('???');
			$(that.posY_selector).html('???');
			$(that.posZ_selector).html('???');
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
			$(that.posX_selector).html('???');
			$(that.posY_selector).html('???');
			$(that.posZ_selector).html('???');
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

}

FabMoUI.prototype.Keypad = function(){
	var that = this;
	this.keypad_allow=false;
	that.lock_right = false
	that.lock_left = false;
	that.lock_up = false;
	that.lock_down = false;
	that.lock_page_up = false;
	that.lock_page_down = false;


	$(document).keydown(function(e) {
		if (that.keypad_allow){
			if (e.which === 37 && !that.lock_left && !that.lock_right) //left
			{
				that.lock_left=true;
				that.tool.start_move("-x",function(){});
			}
			if (e.which === 38 && !that.lock_up && !that.lock_down) //up
			{
				that.lock_up=true;
				that.tool.start_move("y",function(){});
			}
			if (e.which === 39 && !that.lock_right && !that.lock_left) //right
			{
				that.lock_right=true;
				that.tool.start_move("x",function(){});
			}
			if (e.which === 40 && !that.lock_up && !that.lock_down) //down
			{
				that.lock_down=true;
				that.tool.start_move("-y",function(){});
			}
			if (e.which === 33 && !that.lock_page_up && !that.lock_page_down) //page_up
			{
				that.lock_page_up=true;
				that.tool.start_move("z",function(){});
			}
			if (e.which === 34 && !that.lock_page_up && !that.lock_page_down) //page_down
			{
				that.lock_page_down=true;
				that.tool.start_move("-z",function(){});
			}
		}
	});
	$(document).keyup(function(e) {
		if (that.keypad_allow){
			if (e.which === 37 ) //left
			{
				that.lock_left=false;
				that.tool.stop_move(function(){});
			}
			if (e.which === 38 ) //up
			{
				that.lock_up=false;
				that.tool.stop_move(function(){});
			}
			if (e.which === 39 ) //right
			{
				that.lock_right=false;
				that.tool.stop_move(function(){});
			}
			if (e.which === 40 ) //down
			{
				that.lock_down=false;
				that.tool.stop_move(function(){});
			}
			if (e.which === 33 ) //page_up
			{
				that.lock_page_up=false;
				that.tool.stop_move(function(){});
			}
			if (e.which === 34 ) //page_down
			{
				that.lock_page_down=false;
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
		})
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
		})
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
		})
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
		})
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
		})
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
		})
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
}


FabMoUI.prototype.allowKeypad = function(){
	this.keypad_allow = true;
}

FabMoUI.prototype.forbidKeypad = function(){
	this.keypad_allow = false;
}

FabMoUI.prototype.FileControl = function(){
	var that = this;
	$(that.pause_button_selector).click(function(e) {
		that.tool.pause(function(){});
		console.log(that.new_stop_selector)
	});
	$(that.resume_button_selector).click(function(e) {
		that.tool.resume(function(){});
	});
	$(that.stop_button_selector).click(function(e) {
		that.tool.quit(function(){});
	});

}

FabMoUI.prototype.on = function(event, callback) {
	if(event == 'status') {
		this.event_handlers['status'].push(callback);
		console.log(this.event_handlers)
	}
}