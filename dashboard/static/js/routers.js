/*
 * routers.js defines the application routers which map URLs to application functions.
 */
define(function(require) {
	
		var $ = require('jquery');
		var Backbone = require('backbone');
		var auth = require('./auth.js');
		var FabMoAPI = require('./libs/fabmoapi.js');
		var engine = new FabMoAPI();
		var defaultApp = '';
		engine.getConfig(function(err,data){
			return defaultApp = data.machine.default_app;
		});
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
				this.launchApp(defaultApp);
			},
			show_auth: function (message){
				console.log(message);
				if (message){
					console.log(message);
					message.toString();
					var par = message.replace(/-/g, ' ');
					console.log(par);
					$('#add_err').html('<div class="error"> <i class="fa fa-exclamation-circle" aria-hidden="true"></i><span> '+par+'</span></div>');
					$('#add_err').removeAttr('style');
	
				}
				
				$.ajax({url: "authentication/logout", success: function(result){
					console.log(result);
				   }});
				$('#mainContent').show();
				auth();
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