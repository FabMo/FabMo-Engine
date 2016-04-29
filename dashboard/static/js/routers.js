/*
 * routers.js defines the application routers which map URLs to application functions.
 */
define(function(require) {

	var $ = require('jquery');
	var Backbone = require('backbone');

	var Router = Backbone.Router.extend({
		routes: {
			"app/:id"     		: "launch_app",
			"menu"        		: "show_menu",
			""					: "show_menu"
		},
		launch_app: function(id) {
			this.context.launchApp(id, {}, function(err, data) {});
		},
		show_menu: function() {
			$('#waiting_container').hide();
			this.context.appClientView.hide();
			this.context.closeApp();
			this.context.appMenuView.show();
			this.context.hideModalContainer();
			this.context.menuShown = true;
		},
		setContext: function(context) {
			this.context = context;
		},
		initialize: function(options) {
			$('a[href^="#"]').click(function(e) { this.navigate('/'); }.bind(this));
		}
	});

	return Router
});