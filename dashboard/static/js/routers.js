/*
 * routers.js defines the application routers which map URLs to application functions.
 */
define(function(require) {

	var $ = require('jquery');
	var Backbone = require('backbone');
	console.log(Backbone.VERSION);
	var Router = Backbone.Router.extend({
		routes: {
			"app/:id"     		: "_launchApp",
			"menu"        		: "show_menu",
			""					: "show_menu"
		},
		launchApp: function(id, args, callback) {
			callback = callback || function() {};
			this.context.launchApp(id, args || {}, function(err, data) {
				if(err) { return callback(err); }
				this.navigate('app/' + id);
			}.bind(this));
		},
		_launchApp: function(id) {
			this.launchApp(id);
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
		}
		/*
		initialize: function(options) {
			$('a[href^="#"]').click(function(e) { this.navigate('/'); }.bind(this));
		}*/
	});

	return Router
});