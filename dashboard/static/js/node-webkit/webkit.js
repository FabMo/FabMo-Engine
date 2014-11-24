define(function(require) {

// Node webkit globals
var nwkg_package_file = requireNode('../package.json');
var nwkg_win = window.gui.Window.get();
var nwkg_app_manager = requireNode('./js/node-webkit/app_manager.js');
var _ = requireNode('./js/libs/underscore.js')._ ;
nwkg_win.on('document-start',function(frame){
	try{
		// create a global variable in the app context. (so developers can grap information directly from this variable, in a secure way.)
		dashboard = require('dashboard');
		console.log("Binding dashboard (" + dashboard + ") to app...");
		frame.contentWindow.dashboard = dashboard;
	} catch(e) {
		console.log(e);
	}
});
/*
process.on('uncaughtException', function(err) {
	console.log("UNCAUGHT EXCEPTION");
	console.log(err);
	console.log(err.stack);
});
*/

	return {
		'package' : nwkg_package_file,
		'app_manager' : nwkg_app_manager
	}
});