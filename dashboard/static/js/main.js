/*
 * main.js is the entry point for the application.
 */

define(function(require) {

	// context is the application context
	// dashboard is the application context, but only the parts we want the apps to see
	var context = require('context');
	var dashboard = require('dashboard');

	// The webkit module deals with node-specific functionality (detection service, etc)
	//var webkit = require('node-webkit/webkit');

	// Allow to click more than 1 time on a link, to reload a page for example
	allowSameRoute();

	context.apps = new context.models.Apps();
	context.apps.fetch();
	context.appMenuView = new context.views.AppMenuView({collection : context.apps, el : '#app_menu_container'});

	// Load the apps from disk, and update the apps collection model
	//
	// TODO - apps will have to be *served* now rather than being loaded - this is server code here!
	//
	/*
	webkit.app_manager.load_apps(webkit.package.apps_dir || './apps', function(err, apps) {
	context.apps = new context.models.Apps(apps);
	context.appMenuView = new context.views.AppMenuView({collection : context.apps, el : '#app_menu_container'});

	// Read the package.json and behave differently if we're in a debug environment
	switch(webkit.package.debug) {
		// NORMAL MODE
		case false:
		case undefined:
		case null:
			// TODO: Do we really need to access remoteMachines through the context here
			context.refreshRemoteMachines(function(err,remoteMachines){
				if(context.remoteMachines.models.length === 0)
				{
					console.log('no machine detected debug');
				}
				else if(context.remoteMachines.models.length >= 1)
				{
					ChooseBestWayToConnect(context.remoteMachines.models[0].attributes,function(ip,port){
						// Once connected, update the dashboard with the all of the connection information
						delete dashboard.machine;
						dashboard.machine = null;
						delete dashboard.ui;
						dashboard.ui = null;
						dashboard.machine = new FabMo(ip, port);
						dashboard.ui= new FabMoUI(dashboard.machine);
						context.bindKeypad(dashboard.ui);
						context.remoteMachines.forEach(function(item) {
							item.set("current","");
						});
						context.remoteMachines.models[0].set("current","current");
					});
				}
			});
			break;
		// DEBUG MODE
		default:
			FabMoAutoConnect(function(err,fabmo){
				if(err){
					return console.log(err);
				} else {
					fabmo.get_info(function(err,info){
						if(err) {
							console.log(err);
						}
						fabmo.hostname = info?info.surname:undefined;
						context.remoteMachines.reset([
							new context.models.RemoteMachine({
								hostname : fabmo.hostname,
								ip : fabmo.ip,
								port : fabmo.port
							})
						]);
						delete dashboard.machine;
						dashboard.machine = null;
						delete dashboard.ui;
						dashboard.ui = null;
						dashboard.machine = fabmo;
						dashboard.ui = new FabMoUI(fabmo);
						context.bindKeypad(dashboard.ui);
					});
				}
			},webkit.package.detection_service_port||8080);

			break;
	}

		
	});
	*/

	context.remoteMachines.reset([
		new context.models.RemoteMachine({
				hostname : window.location.hostname,
				ip : window.location.hostname,
				port : window.location.port
		})
	]);

	delete dashboard.machine;
	dashboard.machine = null;
	delete dashboard.ui;
	dashboard.ui = null;
	dashboard.machine = new FabMo(window.location.hostname, window.location.port);
	dashboard.ui = new FabMoUI(dashboard.machine);
	context.bindKeypad(dashboard.ui);

	// Start the application
	router = new context.Router();
	router.setContext(context);
	Backbone.history.start();

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

