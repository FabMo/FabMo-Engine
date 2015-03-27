/*
 * This is the application context, which maintains all of the prototypes for all of the models and views
 * as well as instances of some of these which are needed by the application in general.  The context provides 
 * high-level application functions as well in the form of methods.
 * 
 * context.js loads the application models, views and routers, and makes them available, so application script
 * files need only `require('context')` in order to communicate with the top-level application.
 * 
 * This is the sort of application logic that would typically go in an `app.js` - owing to this being the main
 * file of many single page web applications.  Here, we call it the "application context" because the notion of
 * app is already monopolized by the FabMo apps concept. 
 */

 define(function (require) {

	ApplicationContext = function() {
		// Model/View/Router Prototypes
		this.models = require('models');
		this.views = require('views');
		this.Router = require('routers');

		// Model Instances
		this.remoteMachines = new this.models.RemoteMachines();
		this.widgets = new this.models.Widgets();
		this.page = new this.models.Page();

		// View Instances
		//this.remoteMachineMenuView = new this.views.RemoteMachineMenuView({collection : this.remoteMachines});
		this.appClientView = new this.views.AppClientView({el : "#app-client-container"});
		//this.pageView = new this.views.PageView({model: this.page, el : '#modal_container'});

		// App Studio
		this.appStudioFileView = new this.views.AppStudioFileView({el : '#app-studio-files'});
		this.appStudioEditorView = new this.views.AppStudioEditorView({el : '#app-studio-editor'});

		this.current_app_id = null;
	};

	ApplicationContext.prototype.openSettingsPanel = function(){
		$('.off-canvas-wrap').foundation('offcanvas', 'show', 'offcanvas-overlap-right');
	}

	ApplicationContext.prototype.openDROPanel = function(){
		$('.off-canvas-wrap').foundation('offcanvas', 'show', 'offcanvas-overlap-left');
	}

	ApplicationContext.prototype.closeSettingsPanel = function(){
		$('.off-canvas-wrap').foundation('offcanvas', 'hide', 'offcanvas-overlap-right');
	}

	ApplicationContext.prototype.closeDROPanel = function() {
		$('.off-canvas-wrap').foundation('offcanvas', 'hide', 'offcanvas-overlap-left');
	}

	ApplicationContext.prototype.loadSettingsForms = function(machine){
		loadDriverSettings(machine);
	}

	ApplicationContext.prototype.showModalContainer = function(name){
		this.page.set("name",name);
		$('#modal_container').show();
	}

	ApplicationContext.prototype.hideModalContainer = function(){
		$('#modal_container').hide();
	}

	ApplicationContext.prototype.loadDriverSettings = function(machine){
		if(machine==null) {
			console.log("No machine selected");
		}
		else {
			machine.get_config(function(err,config){
				if(err){console.log(err);return;}
				var settings_fields = [];
				for(var propt in config.engine){
				    var setting_field = {};
					setting_field.setting_label = propt;
					setting_field.setting_value = config.engine[propt];
					setting_field.code = propt;
					setting_field.type="text";
					settings_fields.push(setting_field);
				}
				new this.views.SettingsFormView({collection : new this.models.SettingsForm(settings_fields), el : '#core_settings_form'});
			});
		}
	}

	ApplicationContext.prototype.refreshRemoteMachines = function(callback) {
		var machine_models = [];
		machine_model = new this.models.RemoteMachine({
			hostname : window.location.hostname,
			network : {'interface' : 'eth0', 'ip_address' : window.location.host },
			server_port : window.location.port
		});
		machine_models.push(machine_model);
		this.remoteMachines.reset(machine_models)
		if(typeof callback === 'function') callback(null, this.remoteMachines);
	};

	ApplicationContext.prototype.bindKeypad = function(ui){
		ui.forbidKeypad();
	};

	ApplicationContext.prototype.statusKeypad = function(ui){
		ui.statusKeypad();
	};

	ApplicationContext.prototype.launchApp = function(id) {
		current_app = this.getCurrentApp()
		if(current_app.id != id) {
			app = this.apps.get(id);
			if(app) {
				this.current_app_id = id;
				this.appClientView.setModel(app);
			} else {
				console.error("Couldn't launch app: " + id + ": No such app?");
				return
			}
			this.appMenuView.hide();
			this.appClientView.show();
			this.hideModalContainer();
		}
	};

	ApplicationContext.prototype.getCurrentApp = function() {
		return this.appClientView.model;
	};

	return new ApplicationContext();
});
