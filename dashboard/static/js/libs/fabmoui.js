;(function (root, factory) {

  /* CommonJS */
  if (typeof module == 'object' && module.exports) module.exports = factory()

  /* AMD module */
  else if (typeof define == 'function' && define.amd) define(factory)

  /* Browser global */
  else root.FabMoUI = factory()
}(this, function () {
  "use strict"

var MAX_INPUTS = 16;
var currentUnits = null;
var mouseX;
var mouseY;
$(document).on("mousemove touchmove", function(e) {
   mouseX = e.pageX; 
   mouseY = e.pageY;
});  


function FabMoUI(tool, options){
	this.progress = 0;

	this.event_handlers = {
		'error' : [],
		'message' : [],
		'status' : [],
		'disconnect' : [],
		'reconnect' : []
	}
	this.tool = tool;
	// the tool we need to check for

	this.prefix = '';
	// useful if several tools in the same app.

	this.refresh = 125;
	// define the status refresh time.

	this.keypad = true;
	// able or disable the keypad.

	//1 step of keypad, in inches

	this.file_control= true;


	//display move speed
	$('#manual-move-speed').on('input', function(e){
		$('.speed_read_out').show();
		$('.speed_read_out').html($('#manual-move-speed').val());
		$('.speed_read_out').css({'top':$('#manual-move-speed').offset().top-35, 'left': mouseX })
		
	});

	$('#manual-move-speed').on('mouseup touchend', function(){
		$('.speed_read_out').hide();
	})

	$('#right-position-container').on('click', function(){
		$('#dro-tab').css('width', '1em');
		setTimeout(function(){
			$('#dro-tab').css('width', '0.5em'); 
		}, 200);
		if(!$('#right-position-container').hasClass('dropped')){
			$('.dro-dropdown').removeClass('dropped');
			setTimeout(function(){
				$('#right-position-container').removeClass('dropped');
			}, 200);
		} else {
			$('.dro-dropdown').addClass('dropped');
			$('#right-position-container').addClass('dropped');
		}
	})

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
	this.posA_selector = this.status_div_selector + ' .posa';
	this.posB_selector = this.status_div_selector + ' .posb';

	this.state_selector = this.status_div_selector + ' .state';
	this.file_info_div_selector = this.status_div_selector + ' .file-info';
	this.filename_selector = this.file_info_div_selector + ' .filename';
	this.progress_selector = this.file_info_div_selector + ' .progress';

	this.manual_controls_selector = '.fabmo-manual-control';

	this.stop_button_selector = this.file_control_selector + ' .stopJob';
	this.resume_button_selector = this.file_control_selector + ' .resumeJob';
	this.pause_button_selector = this.file_control_selector + ' .pauseJob-wrapper';

	this.units_selector = '.units';

	if(this.keypad){
		this.my_keypad = this.Keypad;
//		this.Keypad();
	}

	if(this.file_control){
		this.my_file_control = this.FileControl;
		this.FileControl();
	}

	this.tool.on('status', function(status_report) {
		this.updateStatusContent(status_report);
	}.bind(this));

	
}

FabMoUI.prototype.on = function(evt, handler) {
	if(evt in this.event_handlers) {
		this.event_handlers[evt].push(handler);
	}
	if(evt === 'error') {
		if(this.tool.status.state === 'stopped') {
			if(this.tool.status.info.error) {
				handler(this.tool.status.info.error);
			}
		}
	}
}

FabMoUI.prototype.emit = function(type, evt) {
	if(type in this.event_handlers) {
		for(var i in this.event_handlers[type]) {
			var handler = this.event_handlers[type][i];
			handler(evt);
		}
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
};

FabMoUI.prototype.updateText = function(control, txt) {
	var t = control.text();
	var v = control.val();
	if(t != txt) {
		control.text(txt);
	}
	if(v != txt) {
		control.val(txt);
	}
};

FabMoUI.prototype.updateStatusContent = function(status){

	var that = this;
	var prev_state = that.tool.state;
	that.tool.state=status.state;
	if(prev_state !== status.state) {
		if(status.state === 'stopped') {
			if(status.info) {
				if(status.info.error) {
					this.emit('error', status.info.error);
				}
			}
		} else if(status.state === 'paused') {
			if(status.info) {
				if(status.info.message) {
					this.emit('message', status.info.message);
				}
			}
		}
	}

	var unit = status.unit || '??';

	var digits = unit === 'mm' ? 2 : 3;

	if (unit !== currentUnits){
		currentUnits = unit;
		that.updateText($(that.units_selector), unit)
	}

	['x','y','z','a','b'].forEach(function(axis) {
		var pos = 'pos' + axis;
		if(pos in status) {
			if(axis === "b") {
				$('.x_pos.y_pos').hide();
				$('.b_pos').show();
				$('.x_pos.y_neg').hide();
				$('.b_neg').show();

			} else if(axis === "a"){
				$('.x_neg.y_pos').hide();
				$('.a_pos').show();
				$('.x_neg.y_neg').hide();
				$('.a_neg').show();
			}else {
				$('.x_neg.y_pos').show();
				$('.x_neg.y_neg').show();
				$('.x_pos.y_pos').show();
				$('.a_pos').hide();
				$('.b_pos').hide();
				$('.x_pos.y_neg').show();
				$('.b_neg').hide();
				$('.a_neg').hide();
			}
			$('.' + axis + 'axis').show();
			console.log(axis);
			try {
				var posText = status[pos].toFixed(digits);
			} catch(e) {
				var posText = (pos + '.' + pos + pos + pos).toUpperCase();
			}
			that.updateText($('.' + pos), posText);
		} else {
			$('.' + axis + 'axis').hide();
		}
	});



	//Current File or job
	if(status.job) {
	    var time_in_ms = Date.now()-status.job.started_at;
        var time_elapsed_ms = time_in_ms % 1000;
        var time_in_s = Math.floor(time_in_ms /1000);
        var time_elapsed_s = time_in_s % 60;
        var time_in_m =  Math.floor(time_in_s/60);
        var time_elapsed_m = time_in_m%60;
        var time_in_h =  Math.floor(time_in_m/60);
        var time_elapsed_h = time_in_h;
        var time_elapsed_text = ((time_elapsed_h)?time_elapsed_h+'h ':'')+
                            ((time_elapsed_m)?time_elapsed_m+'m ':'')+
                            ((time_elapsed_s)?time_elapsed_s+'s':'');

		$('.startNextContainer').hide();
		$(that.file_info_div_selector).removeClass('hide');
		$('.currentJobTitle').text(status.job.name);
		$(that.filename_selector).html(status.job.name);
		var transform_styles = ['-webkit-transform',
                        '-ms-transform',
                        'transform'];
		var prog = ((status.line/status.nb_lines)*100).toFixed(2);
		if (prog > 100){
			prog = 100;
		}
		if (isNaN(prog)){
			prog = 0;
		}
		var percent = Math.round(prog);

		// Enforce monotonicity of progress
		if(percent <= this.progress) {
			percent = this.progress
		}
		this.progress = percent;

		var cc = 255 - Math.round(255*(percent/100));
		var rotation = Math.round(180*(percent/100));
 		var fill_rotation = rotation;
 		var fix_rotation = rotation * 2;
		if ($(window).width() < 700) {
   			$('.radial_progress').show();
			$('.inset .percentage').css('color', 'rgba('+cc+', 255, '+cc+', 1)');
			$('.mask .fill').css('background-color', 'rgba('+cc+', 255, '+cc+', 1)');
			$('.inset .percentage').text(percent + '%');
            $('.elapsed_time_text').text(time_elapsed_text);
			for(i in transform_styles) {
			$('.fill, .mask.full').css(transform_styles[i], 'rotate(' + fill_rotation + 'deg)');
			$('.fill.fix').css(transform_styles[i], 'rotate(' + fix_rotation + 'deg)');
			$('.load_container').hide();
		}
		} else {
			$('.radial_progress').hide();
   			$('.load_container').show();
			$('.percent_comp').text(percent + '%');
			$('.horizontal_fill').css('width', percent + '%');
            $('.elapsed_time_text').text(time_elapsed_text);
		}
		$(that.progress_selector).css("width",prog.toString() + "%");
	}
	else {
		$(that.file_info_div_selector).addClass('hide');
		$('.load_container').hide();
		$('#loadbar').hide();
		$('.radial_progress').hide();
		$(that.filename_selector).empty();
		$(that.progress_selector).empty();
		$('.currentJobTitle').text('');
		$('.horizontal_fill').css('width', '0%');
		this.progress = 0;
	}

	for(var i=1; i<MAX_INPUTS+1; i++) {
		var iname = 'in' + i;
		if(iname in status) {
			var selector = that.status_div_selector + ' .in' + i;
			if(status[iname] == 1) {
				$(selector).removeClass('off').addClass('on');
			} else if(status[iname] == 0) {
				$(selector).removeClass('on').addClass('off');
			} else {
				$(selector).removeClass('on off').addClass('disabled');
			}
		} else {
			break;
		}
	}
	

	$(that.status_div_selector).trigger('statechange',status.state);

	var statename = status.state.charAt(0).toUpperCase() + status.state.slice(1);

	if(status.state != 'manual') {
		$('.tab-bar').removeClass('manual')
	}
	if(status.state === 'idle') {
		that.allowKeypad();
		$(that.status_div_selector).removeClass('fabmo-status-running fabmo-status-paused fabmo-status-error fabmo-status-disconnected fabmo-status-idle fabmo-status-passthrough');
		$(that.status_div_selector).removeClass('fabmo-status-idle');
		$(".tools-current > li a").removeClass('paus err disc');
		$(that.state_selector).html(statename);
		$(".exit-button").hide();
		$(that.pause_button_selector+" div div:first-child").removeClass('spinner red');
		
		if(that.file_control)
		{
			$(that.stop_button_selector).hide();
			$(that.resume_button_selector).hide();
			$(that.pause_button_selector).hide();
		}
	}
	else if(status.state === 'running' || status.state === 'homing' || status.state === 'probing') {
		that.forbidKeypad();
		$(that.status_div_selector).removeClass('fabmo-status-running fabmo-status-paused fabmo-status-error fabmo-status-disconnected fabmo-status-idle fabmo-status-passthrough');
		$(that.status_div_selector).removeClass('fabmo-status-running');
		$(".tools-current > li a").removeClass('paus disc').addClass('err');
		$(that.state_selector).html(statename);
		if(that.file_control)
		{
			$(that.stop_button_selector).hide();
			$(that.pause_button_selector).show();
			$(that.resume_button_selector).hide();
			$(that.resume_button_selector+" div:first-child").removeClass('spinner green');
			$(that.stop_button_selector+" div:first-child").removeClass('spinner red');
		}
	}
	else if(status.state === 'manual') {
		that.allowKeypad();
		$('.tab-bar').addClass('manual')
		$(that.status_div_selector).removeClass('fabmo-status-running fabmo-status-paused fabmo-status-error fabmo-status-disconnected fabmo-status-idle fabmo-status-passthrough');
		$(that.status_div_selector).removeClass('fabmo-status-running');
		$(".tools-current > li a").removeClass('disc err').addClass('paus');
		$(that.state_selector).html(statename);

		if(that.file_control)
		{
			$(that.stop_button_selector).hide();
			$(that.resume_button_selector).hide();
			$(that.pause_button_selector).hide();
		}
	}
	else if(status.state === 'paused') {
		$(that.status_div_selector).removeClass('fabmo-status-running fabmo-status-paused fabmo-status-error fabmo-status-disconnected fabmo-status-idle fabmo-status-passthrough');
		$(that.status_div_selector).removeClass('fabmo-status-paused');
		$(".tools-current > li a").removeClass('paus disc err').addClass('paus');
		$(that.state_selector).html(statename);
				$(".exit-button").hide();

		if(that.file_control)
		{
			$(that.stop_button_selector).show();
			$(that.pause_button_selector).hide();
			$(that.resume_button_selector).show();
			$(that.pause_button_selector+" div div:first-child").removeClass('spinner red');

		}
	}
	else if(status.state === 'passthrough') {
		that.forbidKeypad();
		$(".tools-current > li a").removeClass('paus disc err').addClass('paus');
		$(that.status_div_selector).removeClass('fabmo-status-running fabmo-status-paused fabmo-status-error fabmo-status-disconnected fabmo-status-idle fabmo-status-passthrough');
		$(that.status_div_selector).addClass('fabmo-status-passthrough');
		$(that.state_selector).html('passthrough');
		$(that.stop_button_selector).hide();
		$(that.pause_button_selector).hide();
		$(that.resume_button_selector).hide();
		$(".exit-button").hide();

	}
	else if(status.state == 'limit') {
		that.forbidKeypad();
		$(that.status_div_selector).removeClass('fabmo-status-running fabmo-status-paused fabmo-status-error fabmo-status-disconnected fabmo-status-idle fabmo-status-passthrough');
		$(that.status_div_selector).removeClass('fabmo-status-error');
		$(".tools-current > li a").removeClass('paus err').addClass('disc');
		$(that.state_selector).html(status.state);
				$(".exit-button").hide();

		if(that.file_control)
		{
			$(that.pause_button_selector).hide();
			$(that.resume_button_selector).show()
			$(that.stop_button_selector).hide();
		}
	}
	else if(status.state == 'not_ready' || status.state == 'dead') {
		statename = 'Unavailable';
		that.forbidKeypad();
		$(that.status_div_selector).removeClass('fabmo-status-running fabmo-status-paused fabmo-status-error fabmo-status-disconnected fabmo-status-idle fabmo-status-passthrough');
		$(that.status_div_selector).addClass('fabmo-status-error');
		$(that.state_selector).html(statename);
		$(".exit-button").hide();

		if(that.file_control)
		{
			$(that.pause_button_selector).hide();
			$(that.resume_button_selector).hide();
			$(that.stop_button_selector).hide();
		}
	}
	else if(status.state == 'stopped') {
		that.forbidKeypad();
		$(".exit-button").hide();

		$(that.status_div_selector).removeClass('fabmo-status-running fabmo-status-error fabmo-status-disconnected fabmo-status-idle fabmo-status-passthrough');
		$(that.status_div_selector).addClass('fabmo-status-paused');
		$(that.state_selector).html(statename);
		if(that.file_control)
		{
			$(that.pause_button_selector).hide();
			$(that.resume_button_selector).hide();
			$(that.stop_button_selector).hide();
		}
	}
	else if (status.state === 'armed'){
		
	}
	else {
		$(".tools-current > li a").removeClass('paus err').addClass('disc');
		console.warn('Unknown status' + JSON.stringify(status));
	}

	if(status.state === 'idle' || status.state === 'manual') {
		$(that.manual_controls_selector).removeClass('hide');
	} else {
		$(that.manual_controls_selector).addClass('hide');
	}

	this.emit('status', status);
};




FabMoUI.prototype.updateStatus = function(){
	var that=this;
	that.tool.getStatus(function(err, status){
		if(!err){
			that.updateStatusContent(status);
			that.emit('reconnect');
		}
		else{
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
				$(that.stop_button_selector).hide();
				$(that.pause_button_selector).hide();
				$(that.resume_button_selector).hide();
			}
		}
	});

};


FabMoUI.prototype.pause = function(){
	var that = this;
	that.tool.pause(function(err, data){
		if (err) {
			console.error(err)
		} else {
			that.tool.getStatus(function(err, data){
				if (err) {
					console.log(err);
				} else {
					if(data.state === "running") {
						that.pause();
					}
				}
			})
		}
	});
}




FabMoUI.prototype.FileControl = function(){
	var that = this;
	$(that.pause_button_selector).click(function(e) {
		$(that.pause_button_selector+" div div:first-child").addClass('spinner red');
		that.pause();
	});

	$(that.resume_button_selector).click(function(e) {
		$(that.resume_button_selector+" div:first-child").addClass('spinner green');
		that.tool.resume(function(err, data){
			if (err) {
				console.error(err)
			} else {
			}
		});
	});

	$(that.stop_button_selector).click(function(e) {
		$(that.stop_button_selector+" div:first-child").addClass('spinner red');
		that.tool.quit(function(err, data){
			if (err) {
				console.error(err)
			} else {
			}
		});
	});
}

return FabMoUI;


}));
