/*
 * main.js is the entry point for the application.
 */
define(function(require) {

	// context is the application context
	// dashboard is the application context, but only the parts we want the apps to see
	var context = require('context');
	var dashboard = require('dashboard');

	var $ = require('jquery');
	var Backbone = require('backbone');
	var underscore = require('underscore');

	var FabMo = require('fabmo');
	var FabMoUI = require('fabmo-ui');

	var WheelControl = require('handwheel');
	
	var events = require()
	// Allow to click more than 1 time on a link, to reload a page for example
	allowSameRoute();

	// Load the apps from the server
	context.apps = new context.models.Apps();
	context.apps.fetch({
		success: function() {
			// Create the menu based on the apps thus retrieved 
			context.appMenuView = new context.views.AppMenuView({collection : context.apps, el : '#app_menu_container'});

			//Sortable app icon (not used now, just for play !) //Disabled
			
			var menu_container = document.getElementById('app_menu_container');
			/*
			new Sortable(menu_container, {
				group: "apps",
				ghostClass: "sortable-ghost",
				disabled: true,
				animation: 150,
				delay: 500,
				store: {
				  // Get the order of elements. Called once during initialization. //
				  get: function (sortable) {		      
				  	  var order = localStorage.getItem(sortable.options.group);
				      return order ? order.split('|') : [];
				  },
				  // Save the order of elements. Called every time at the drag end //
				  set: function (sortable) {
				      var order = sortable.toArray();
				      localStorage.setItem(sortable.options.group, order.join('|'));
				  }
				}
			});
			*/

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

			dashboard.ui.updateStatus();

			// Configure keyboard input
			var wheel = setupHandwheel();

			// Start the application
			router = new context.Router();
			router.setContext(context);

			//dashboard.ui.on('status', function(status) {});

			Backbone.history.start();
		}
	});




	//$(function () { $('.app-studio-files').jstree(); });

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
// Functions for dispatching g-code to the tool
function gcode(string) {
	dashboard.machine.gcode(string,function(err,data){
		// Maybe report an error here.
	});
}

// Functions for dispatching g-code to the tool
function sbp(string) {
	dashboard.machine.sbp(string,function(err,data){
		// Maybe report an error here
	});
}

function addJob(job,callback){
	dashboard.machine.send_job(job,function(err){
		if(err){console.error(err);callback(err);return;}
		if(callback && typeof(callback) === "function")callback(undefined);
	});
}

function allowSameRoute(){
	//Fix the bug that doesn't allow the user to click more than 1 time on a link
	//Intercept the event "click" of a backbone link, then temporary set the route to "/"
	$('a[href^="#"]').click(function(e) { router.navigate('/'); });
}

$(document).on('close.fndtn.reveal', '[data-reveal]', function (evt) {
  var modal = $(this);
  dashboard.machine.quit(function() {});
});

// Handlers for the home/probe buttons
$('.button-zerox').click(function(e) {sbp('ZX'); });  
$('.button-zeroy').click(function(e) {sbp('ZY'); });  
$('.button-zeroz').click(function(e) {sbp('ZZ'); });

});

