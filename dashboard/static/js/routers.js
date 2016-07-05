/*
 * routers.js defines the application routers which map URLs to application functions.
 */
define(function(require) {

	var $ = require('jquery');
	var Backbone = require('backbone');

	var Router = Backbone.Router.extend({
		routes: {
			"app/:id"     		: "_launchApp",
			"menu"        		: "show_menu",
			""					: "show_menu",
			"authentication(?message=:message)"	: "show_auth"

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
			$('#mainContent').hide();
			this.context.appClientView.hide();
			this.context.closeApp();
			this.context.appMenuView.show();
			this.context.hideModalContainer();
			this.context.menuShown = true;
		},
		show_auth: function (message){
			if (message){
				console.log(message);
				message.toString();
				var par = message.replace(/-/g, ' ');
				console.log(par);
				$('#add_err').html('<div class="error"> <i class="fa fa-exclamation-circle" aria-hidden="true"></i><span class="sr-only"> '+par+'</span></div>');
				$('#add_err').show();

			}
			
			$.ajax({url: "authentication/logout", success: function(result){
        		console.log(result);
   			}});
			$('#mainContent').show();
		},
		loadView : function(view) {
		this.view && this.view.remove();
		this.view = view;
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
