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
	var hash = '';
	engine.getConfig(function(err,data){
		defaultApp = data.machine.default_app;
		hash = data.engine.version.substring(0,5);
		console.log(hash);
		return [defaultApp, hash];
	});
	console.log(hash);
	var Router = Backbone.Router.extend({
		routes: {
			"app/:id"     		: "redirect_app",
			":version/app/:id"     		: "_launchApp",
			":version"					: "show_menu",
			""					: "redirect",
			"authentication(?message=:message)"	: "show_auth",
			'*notFound': 'redirect'

		},
		launchApp: function(id, args, callback) {
			callback = callback || function() {};
			
			this.context.launchApp(id, args || {}, function(err, data) {
				
				if(err) { return callback(err); }
				this.navigate('/'+hash+'/app/'+ id);
			}.bind(this));
		},
		_launchApp: function(version, id) {
			if (version === hash) {
				this.launchApp(id);
			}else {
				this.navigate('/'+hash+'/app/'+ id, {trigger: true});
			}
			
		},
		show_menu: function(version) {
			if (version === hash) {
				this.launchApp(defaultApp);
			}
			else {
				this.navigate(hash, {trigger: true});
			}
		},
		redirect: function(){
			this.navigate('/'+hash, {trigger: true});
		},
		redirect_app: function(id){
			this.navigate('/'+hash+'/app/'+ id, {trigger: true});
		},
		show_auth: function (message){
			if (message){
				message.toString();
				var par = message.replace(/-/g, ' ');
				$('#add_err').html('<div class="error"> <i class="fa fa-exclamation-circle" aria-hidden="true"></i><span> '+par+'</span></div>');
				$('#add_err').removeAttr('style');

			}
			
			$.ajax({url: "authentication/logout", success: function(result){
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
