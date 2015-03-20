/*
 * main.js is the entry point for the application.
 */

define(function(require) {

	// context is the application context
	// dashboard is the application context, but only the parts we want the apps to see
	var context = require('context');
	var dashboard = require('dashboard');

	Hammer = require("libs/hammer");
	touchy = require("libs/jquery.touchy");

	// Allow to click more than 1 time on a link, to reload a page for example
	allowSameRoute();

	// Load the apps from the server
	context.apps = new context.models.Apps();
	context.apps.fetch();

	// Create the menu based on the apps thus retrieved 
	context.appMenuView = new context.views.AppMenuView({collection : context.apps, el : '#app_menu_container'});

	// Create remote machine model based on the one remote machine that we know exists (the one we're connecting to)
	context.remoteMachines.reset([
		new context.models.RemoteMachine({
				hostname : window.location.hostname,
				ip : window.location.hostname,
				port : window.location.port
		})
	]);

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

	// Configure keyboard input
	//context.bindKeypad(dashboard.ui);
	setupHandwheel();

	// Start the application
	router = new context.Router();
	router.setContext(context);


	Backbone.history.start();


	//$(function () { $('.app-studio-files').jstree(); });

function setupHandwheel() {
	wheel = new HandWheel("wheel", {
		ppr:32, 
		thumbColor: "#9C210C", 
		wheelColor:"#DD8728", 
		lineColor:"#000000",
		textFont: "source_sans_proextralight"
	});

	var angle = 0.0;
	var SCALE = 0.010;

	wheel.on("sweep", function(evt) {
		var degrees = evt.angle*180.0/Math.PI;
		angle += degrees;
		var distance = Math.abs(angle*SCALE);
		if(angle > 5.0) {
			angle = 0;
			dashboard.machine.fixed_move('+' + wheel.getMode(), distance, function(err) {});
		}
		if(angle < -5.0) {
			angle = 0;
			dashboard.machine.fixed_move('-' + wheel.getMode(), distance, function(err) {});
		}
	});

	wheel.on("release", function(evt) {
		dashboard.machine.quit(function() {})
	});

}
// Functions for dispatching g-code to the tool
function gcode(string) {
	dashboard.machine.gcode(string,function(err,data){
		if(!err) {
			console.log('Success: ' + string);
		} else {
			console.log('Failure: ' + string);
		}
	});
}

function addJob(job,callback){
	dashboard.machine.send_job(job,function(err){
		if(err){console.log(err);callback(err);return;}
		if(callback && typeof(callback) === "function")callback(undefined);
	});
}

function allowSameRoute(){
	//Fix the bug that doesn't allow the user to click more than 1 time on a link
	//Intercept the event "click" of a backbone link, then temporary set the route to "/"
	$('a[href^="#"]').click(function(e) { router.navigate('/'); });
}

// Handlers for the home/probe buttons
$('.button-homexy').click(function(e) {gcode('G28.2 X0 Y0'); });
$('.button-homez').click(function(e) {gcode('G28.2 Z0'); });
$('.button-probez').click(function(e) {gcode('G38.2 Z-4 F10\nG10 L2 P1 Z-0.125'); });
$('.button-zerox').click(function(e) {gcode('G28.3 X0'); });  
$('.button-zeroy').click(function(e) {gcode('G28.3 Y0'); });  
$('.button-zeroz').click(function(e) {gcode('G28.3 Z0'); });

});

