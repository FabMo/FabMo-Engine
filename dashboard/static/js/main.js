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
	var FabMo = require('fabmo');
	var FabMoUI = require('fabmo-ui');
	var WheelControl = require('handwheel');

	var wheel;

	// Load the apps from the server
	dashboard.ui= new FabMoUI(dashboard.machine);
	context.apps = new context.models.Apps();
	context.apps.fetch({
		success: function() {
			// Create the menu based on the apps thus retrieved 
			context.appMenuView = new context.views.AppMenuView({collection : context.apps, el : '#app_menu_container'});

			// Create a FabMo object for the dashboard
			dashboard.machine = new FabMo(window.location.hostname, window.location.port);
			dashboard.socket = require('websocket').SocketIO();

			// Create a FabMoUI object for the same (but don't recreate it if it already exists)
			if (!dashboard.ui) {
				dashboard.ui= new FabMoUI(dashboard.machine);
			}
			else {
				dashboard.ui.tool = dashboard.machine;
			}

			dashboard.ui.on('error', function(err) {
				$('#modalDialogTitle').text('Error!');
				$('#modalDialogLead').html('<div style="color:red">There was an error!</div>');
				$('#modalDialogMessage').text(err || 'There is no message associated with this error.');
				if(dashboard.machine.status_report.job) {
					$('#modalDialogDetail').html(
						'<p>' + 
						  '<b>Job Name:  </b>' + dashboard.machine.status_report.job.name + '<br />' + 
						  '<b>Job Description:  </b>' + dashboard.machine.status_report.job.description + 
						'</p>'
						);
				} else {
					$('#modalDialogDetail').html('<p>Additional information for this error is unavailable.</p>');										
				}
				$('#modalDialog').foundation('reveal', 'open');
			});

			// Request a status update from the tool
			dashboard.ui.updateStatus();

			// Configure handwheel input
			wheel = setupHandwheel();

			// Start the application
			router = new context.Router();
			router.setContext(context);

			// Sort of a hack, but works OK.
			$('#spinner').hide();

			// Start backbone routing
			Backbone.history.start();
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
		dashboard.machine.quit(function() {});
	}

	wheel.on('move', function makeMove(data) {
		var degrees = data.angle*180.0/Math.PI;
		angle += degrees;
		var distance = wheel.inUnits(Math.abs(angle*SCALE), wheel.units);
		var axis = data.axis;
		var speed = wheel.inUnits(wheel.speed, wheel.units);
		if(angle > TICKS_MOVE) {
			if(last_move) {
				dashboard.machine.quit(function() {});
			}
			angle = 0;
			dashboard.machine.fixed_move('+' + axis, distance, speed, function(err) {});
			last_move = 0;
		}
		if(angle < -TICKS_MOVE) {
			if(!last_move) {
				dashboard.machine.quit(function() {});
			}
			angle = 0;
			dashboard.machine.fixed_move('-' + axis, distance, speed, function(err) {});
			last_move = 1;
		}

		if(watchdog) { clearTimeout(watchdog); }
		watchdog = setTimeout(stopToolMotion, WATCHDOG_TIMEOUT);

	});

	wheel.on('release', function quit(data) {
		dashboard.machine.quit(function() {})
	});

	wheel.on('nudge', function nudge(data) {
		var nudge = NUDGE[wheel.units];
		var speed = wheel.inUnits(wheel.speed, wheel.units);
		dashboard.machine.fixed_move(data.axis, nudge, wheel.speed, function(err) {});
	});
	return wheel;
}

// Kill the currently running job when the modal error dialog is dismissed
$(document).on('close.fndtn.reveal', '[data-reveal]', function (evt) {
  var modal = $(this);
  dashboard.machine.quit(function() {});
});

// Handlers for the home/probe buttons
$('.button-zerox').click(function(e) {dashboard.machine.sbp('ZX', function(){}); });  
$('.button-zeroy').click(function(e) {dashboard.machine.sbp('ZY', function(){}); });  
$('.button-zeroz').click(function(e) {dashboard.machine.sbp('ZZ', function(){}); });


$('.play').on('click', function(e){
	$("#main").addClass("offcanvas-overlap-left");
	dashboard.machine.job_run(function (){
		dashboard.machine.list_jobs_in_queue(function (err, data){
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

dashboard.ui.on('status', function(status) {
	if(status.unit) {
		wheel.setUnits(status.unit);	
	}

	dashboard.machine.list_jobs_in_queue(function (err, data){
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

});

var disconnected = false;

dashboard.ui.on('disconnect', function() {
	if(!disconnected) {
		disconnected = true;
		$('#disconnectDialog').foundation('reveal', 'open');
	}
});

dashboard.ui.on('reconnect', function() {
	if(disconnected) {
		disconnected = false;
		$('#disconnectDialog').foundation('reveal', 'close');
	}
});

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
	$('.currentJobTitle').css('width', '40%');
	$('.currentJobTitle').css('padding-left', '100px');
}
})();
$.post('/time', {
	'utc' : new Date().toUTCString()
});

});






