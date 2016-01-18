/*
 * main.js is the entry point for the application.
 */
define(function(require) {

	// context is the application context
	// dashboard is the bridge between the application context and the apps
	var context = require('context');
	var dashboard = require('dashboard');

	// Vendor libraries
	var $ = require('jquery');
	var Backbone = require('backbone');
	var underscore = require('underscore');

	// Our libraries
	var FabMoAPI = require('fabmo');
	var FabMoUI = require('fabmo-ui');
	
	var WheelControl = require('handwheel');
	var Keyboard = require('keyboard');
	var Keypad = require('keypad');

	var wheel, keypad, keyboard;
	
	// API object defines our connection to the tool.
	var engine = new FabMoAPI();

	var modalIsShown = false;
	
	// Detect touch screen
	
	var supportsTouch = 'ontouchstart' in window || navigator.msMaxTouchPoints;

	// Initial read of engine configuration
	engine.getConfig();

	context.apps = new context.models.Apps();

	// Load the apps from the server
	context.apps.fetch({
		success: function() {
			// Create the menu based on the apps thus retrieved 
			context.appMenuView = new context.views.AppMenuView({collection : context.apps, el : '#app_menu_container'});

			// Create a FabMo object for the dashboard
			dashboard.setEngine(engine);
			dashboard.ui=new FabMoUI(dashboard.engine);

			// Configure handwheel input
			try {
				wheel = setupHandwheel();
			} catch(e) {
				console.error(e);
			}
			keyboard = setupKeyboard();
			keypad = setupKeypad();

			// Start the application
			router = new context.Router();
			router.setContext(context);

			// Sort of a hack, but works OK.
			$('#spinner').hide();

			// Start backbone routing
			Backbone.history.start();
			
			// Request a status update from the tool
			engine.getStatus();
		}
	});




function setupHandwheel() {

	var wheel = new WheelControl('wheel', {
		labelColor : 'white'
	});	

	var SCALE = 0.75;
	var TICKS_MOVE = 20;
	var NUDGE = {'mm' : 0.1, 'in' : 0.010};
	var WATCHDOG_TIMEOUT = 200;

	var angle = 0.0;

	var watchdog = null;
	var last_move = 0;

	function stopToolMotion() {
		dashboard.engine.manualStop();
	}

	wheel.on('move', function makeMove(data) {
		var degrees = data.angle*180.0/Math.PI;
		angle += degrees;
		var distance = wheel.inUnits(Math.abs(angle*SCALE), wheel.units);
		var axis = data.axis;
		var speed = wheel.inUnits(wheel.speed, wheel.units);
		if(angle > TICKS_MOVE) {
			if(last_move) {
				dashboard.engine.manualStop();
			}
			angle = 0;
			//dashboard.engine.fixed_move('+' + axis, distance, speed, function(err) {});
			dashboard.engine.manualStart(axis, speed);

			last_move = 0;
		}
		if(angle < -TICKS_MOVE) {
			if(!last_move) {
				dashboard.engine.quit();
			}
			angle = 0;
//			dashboard.engine.fixed_move('-' + axis, distance, speed, function(err) {});
			dashboard.engine.manualStart(axis, -speed);

			last_move = 1;
		}

		if(watchdog) { clearTimeout(watchdog); }
		watchdog = setTimeout(stopToolMotion, WATCHDOG_TIMEOUT);

	});

	wheel.on('release', function quit(data) {
		dashboard.engine.quit()
	});

	wheel.on('nudge', function nudge(data) {
		var nudge = NUDGE[wheel.units];
		var speed = wheel.inUnits(wheel.speed, wheel.units);
		dashboard.engine.manualMoveFixed(data.axis, wheel.speed, nudge, function(err) {});
	});
	return wheel;
}

function getManualMoveSpeed(move) {
	var speed_ips = null;
	try {
		switch(move.axis) {
			case 'x':
			case 'y':
				speed_ips = engine.config.machine.manual.xy_speed;
				break;
			case 'z':
				speed_ips = engine.config.machine.manual.z_speed;
				break; 
		}
	} catch(e) {
		console.error(e);
	}
	return speed_ips;
}

function getManualNudgeIncrement(move) {
	var increment_inches = null;
	try {
		switch(move.axis) {
			case 'x':
			case 'y':
				increment_inches = engine.config.machine.manual.xy_increment;
				break;
			case 'z':
				increment_inches = engine.config.machine.manual.z_increment;
				break; 
		}
	} catch(e) {
		console.error(e);
	}
	return increment_inches;
}

function setupKeyboard() {
	var keyboard = new Keyboard('#keyboard');
	keyboard.on('go', function(move) {
		
		if(move) {
			dashboard.engine.manualStart(move.axis, move.dir*60.0*(getManualMoveSpeed(move) || 0.1));
		} 
	});

	keyboard.on('stop', function(evt) {
		dashboard.engine.manualStop();
	})
	return keyboard;
}

function setupKeypad() {

	var keypad = new Keypad('#keypad');
	keypad.on('go', function(move) {
		if(move) {
			dashboard.engine.manualStart(move.axis, move.dir*60.0*(getManualMoveSpeed(move) || 0.1));
		} 
	});

	keypad.on('stop', function(evt) {
		dashboard.engine.manualStop();
	});

	keypad.on('nudge', function(nudge) {
		dashboard.engine.manualMoveFixed(nudge.axis, 60*getManualMoveSpeed(nudge), nudge.dir*getManualNudgeIncrement(nudge))
		//dashboard.engine.manualMoveFixed(nudge.axis, null, nudge.dir*getManualNudgeIncrement(nudge) || 0.010);
	});
	return keypad;
}

function showModal(options) {
	if(modalIsShown) {
		return;
	}
	modalIsShown = true;

	if(options['title']) {
		$('#modalDialogTitle').html(options.title).show();		
	} else {		
		$('#modalDialogTitle').hide();
	}

	if(options['lead']) {
		$('#modalDialogLead').html(options.lead).show();		
	} else {		
		$('#modalDialogLead').hide();
	}

	if(options['message']) {
		$('#modalDialogMessage').html(options.message).show();		
	} else {		
		$('#modalDialogMessage').hide();
	}

	if(options['detail']) {
		$('#modalDialogDetail').html(options.detail).show();		
	} else {		
		$('#modalDialogDetail').hide();
	}

	$('#modalDialogButtons').hide();
	if(options['okText']) {
		$('#modalDialogButtons').show();
		$('#modalDialogOKButton').text(options.okText).show().one('click', function() {
			$('#modalDialogCancelButton').off('click');
			(options['ok'] || function() {})();
		});
	} else {
		$('#modalDialogOKButton').hide();
	}

	if(options['cancelText']) {
		$('#modalDialogButtons').show();
		$('#modalDialogCancelButton').text(options.cancelText).show().one('click', function() {
			$('#modalDialogOKButton').off('click');
			(options['cancel'] || function() {})();
		});
	} else {
		$('#modalDialogCancelButton').hide();
	}

	if(options['cancel']) {
		$('#modalDialogClose').show().one('click', function() {
			options.cancel();
		});
	} else {
		$('#modalDialogClose').hide();
	}

	$('#modalDialog').foundation('reveal', 'open');
}

function hideModal() {
	if(!modalIsShown) { return; }
	modalIsShown = false;
	$('#modalDialog').foundation('reveal', 'close');	
}

// Kill the currently running job when the modal error dialog is dismissed
/*$(document).on('close.fndtn.reveal', '[data-reveal]', function (evt) {
  var modal = $(this);
  if(engine.status.state === "stopped") {
	  dashboard.engine.quit();
	  console.info("Quitting the tool on dismiss")  	
  } else if(engine.status.state === "paused") {
  	dashboard.engine.resume();
  } else {
	  console.warn("Not quitting the tool because it's not stopped.")  	
  }
});*/

// listen for escape key press to quit the engine
$(document).on('keyup', function(e) {
    if(e.keyCode == 27) {
        console.log("ESC key pressed - quitting engine.");
        dashboard.engine.quit();
    }
});

//goto this location 

$('html').on('click', function (e) {
		if (e.target.id === "go-here") {
		var x = $('.posx').attr('value','')[1].value;
		var y = $('.posy').attr('value','')[1].value;
		var z = $('.posz').attr('value','')[1].value;
		var gcode = "G0 X" + x + " Y" + y + " Z" + z;
		dashboard.engine.gcode(gcode);
		$('.go-here').hide();
		} else if (e.target.id === "axis"){
			$('.go-here').show();
		} else {
			$('.go-here').hide();
		}
});
$('.posx, .posy, .posz').keyup(function(event){
    if(event.keyCode == 13){
    	event.preventDefault();
        var x = $('.posx').attr('value','')[1].value;
		var y = $('.posy').attr('value','')[1].value;
		var z = $('.posz').attr('value','')[1].value;
		var gcode = "G0 X" + x + " Y" + y + " Z" + z;
		dashboard.engine.gcode(gcode);
		$('.go-here').hide();
    }
});

// Handlers for the home/probe buttons
$('.button-zerox').click(function(e) {dashboard.engine.sbp('ZX'); });  
$('.button-zeroy').click(function(e) {dashboard.engine.sbp('ZY'); });  
$('.button-zeroz').click(function(e) {dashboard.engine.sbp('ZZ'); });

$('.play').on('click', function(e){
	$("#main").addClass("offcanvas-overlap-left");
	dashboard.engine.job_run(function (){
		dashboard.engine.getJobQueue(function (err, data){
			if (data.name == 'undefined' || data.length === 0) {
				$('.nextJob').text('No Job Pending');
				$('.play').hide();
				$('.gotoJobManager').show();
				$('.nextJob').css('top', '2px');
				$('.startnextLabel').css('top', '2px');
			} else {
				$('.nextJob').text(data[0].name);
			}
		});
	});
});

engine.on('status', function(status) {
	try {	
		if(status.unit) {
			wheel.setUnits(status.unit);	
		}
		dashboard.engine.getJobQueue(function (err, data){
			if (data.name == 'undefined' || data.length === 0) {
				$('.nextJob').text('No Job Pending');
				$('.play').hide();
				$('.gotoJobManager').show();
				$('.nextJob').css('top', '2px');
				$('.startnextLabel').css('top', '2px');
			} else {
				$('.nextJob').text(data[0].name);
				$('.play').show();
				$('.gotoJobManager').hide();
				$('.nextJob').css('top', '-9.5px');
				$('.startnextLabel').css('top', '-9.5px');
			}
		});
	} catch(e) {

	}
});

var disconnected = false;

engine.on('disconnect', function() {
	if(!disconnected) {
		disconnected = true;
		$('#disconnectDialog').foundation('reveal', 'open');
	}
});

engine.on('connect', function() {
	if(disconnected) {
		disconnected = false;
		$('#disconnectDialog').foundation('reveal', 'close');
	}
});

engine.on('status', function(status) {
	if(status['info']) {
		if(status.info['message']) {
			showModal({
				title : 'Message',
				lead : status.info.message,
				okText : 'Continue',
				cancelText : 'Quit',
				ok : function() {
					dashboard.engine.resume();
				},
				cancel : function() {
					dashboard.engine.quit();
				}

 			})
		} else if(status.info['error']) {

			if(dashboard.engine.status.job) {
				var detailHTML = '<p>' + 
					  '<b>Job Name:  </b>' + dashboard.engine.status.job.name + '<br />' + 
					  '<b>Job Description:  </b>' + dashboard.engine.status.job.description + 
					'</p>'
			} else {
				var detailHTML = '<p>Additional information for this error is unavailable.</p>';										
			}

			showModal({
				title : 'Message',
				lead : '<div style="color:red">An error has occurred!</div>',
				message: status.info.error,
				detail : detailHTML,
				cancelText : 'Quit',
				cancel : function() {
					dashboard.engine.quit();
				}

 			})

		}
	} else {
		hideModal();
	}
});
setInterval(function() {
	engine.ping(function(err, time) {
		if(err) {
			console.error(err);
		} else {
			console.info("PING Response time: " + time + "ms");
		}
	});
}, 3000);

(function () {
if ($(window).width() < 620) {
    function start_marquee() {
        function go() {
            i = i < width ? i + step : 1;
            m.style.marginLeft = -i + 'px';
        }
        var i = 0,
            step = 3,
            space = '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;';
        var m = document.getElementById('marquee');
        var t = m.innerHTML; 
        m.innerHTML = t + space;
        m.style.position = 'absolute'; 
        var width = (m.clientWidth + 1);
        m.style.position = '';
        m.innerHTML = t + space + t + space + t + space + t + space + t + space + t + space + t + space;
        if (m.addEventListener) {
            m.addEventListener('mouseenter', function () {
                step = 0;
            }, false);
            m.addEventListener('mouseleave', function () {
                step = 3;
            }, false);
        }
        var x = setInterval(go, 50);
    }
    if (window.addEventListener) {
        window.addEventListener('load', start_marquee, false);
    } else if (window.attachEvent) { //IE7-8
        window.attachEvent('onload', start_marquee);
    }
	
	$('.currentContainer').css('width', '100px');
	$('.currentJobTitle').css('width', '50%');
	$('.currentJobTitle').css('padding-left', '100px');
}
})();
$.post('/time', {
	'utc' : new Date().toUTCString()
});
function touchScreen () {
	if (supportsTouch) {
		$('#app-client-container').css({'-webkit-overflow-scrolling':'touch','overflow-y':'scroll'});
	} 
}
touchScreen();
});






