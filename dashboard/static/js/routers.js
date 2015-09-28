/*
 * routers.js defines the application routers which map URLs to application functions.
 */
define(function(require) {

	var Backbone = require('backbone');

	var Router = Backbone.Router.extend({
		routes: {
			"app/:id"     		: "launch_app",
			"menu"        		: "show_menu",
		},
		launch_app: function(id) {
			this.context.launchApp(id, {}, function(err, data) {});
		},
		show_menu: function() {
			this.context.appClientView.hide();
			this.context.appMenuView.show();
			this.context.hideModalContainer();
		},
		setContext: function(context) {
			this.context = context;
		}
	});
	return Router;
});