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
			var wheel = setupHandwheel();

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
		wheelSpeed : 1.0,
		labelColor : 'white'
	});	

	var SCALE = 0.030;
	var TICKS_MOVE = 20;
	var NUDGE = 0.010;

	var angle = 0.0;
	var speed = 1.0;

	wheel.on('speed', function changeSpeed(data) {
		speed = data.speed;
	});

	wheel.on('move', function makeMove(data) {
		var degrees = data.angle*180.0/Math.PI;
		angle += degrees;
		var distance = Math.abs(angle*SCALE*speed);
		var axis = data.axis;

		if(angle > TICKS_MOVE) {
			angle = 0;
			dashboard.machine.fixed_move('+' + axis, distance, speed*60.0, function(err) {});
		}
		if(angle < -TICKS_MOVE) {
			angle = 0;
			dashboard.machine.fixed_move('-' + axis, distance, speed*60.0, function(err) {});
		}
	});

	wheel.on('release', function quit(data) {
		dashboard.machine.quit(function() {})
	});

	wheel.on('nudge', function nudge(data) {
		dashboard.machine.fixed_move(data.axis, NUDGE, speed*60, function(err) {});
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
	dashboard.machine.get_status(function (data) {
	console.log(data);
	});
	console.log("this is running");
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
	console.log('cool yo');
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



$.post('/time', {
	'utc' : new Date().toUTCString()
});

});



