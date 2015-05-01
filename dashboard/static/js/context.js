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
		this.appClientView = new this.views.AppClientView({el : "#app-client-container"});

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

	ApplicationContext.prototype.launchApp = function(id) {
		current_app = this.getCurrentApp()
		if(current_app.id != id) {
			app = this.apps.get(id);
			if(app) {
				this.current_app_id = id;
				this.appClientView.setModel(app);
			} else {
				if(this.apps) {
					console.error("Couldn't launch app: " + id + ": Apps list not available yet.")
				} else {
					console.error("Couldn't launch app: " + id + ": No such app?");
				}
				return
			}
		}
		this.appMenuView.hide();
		this.appClientView.show();
		this.hideModalContainer();
	};

	ApplicationContext.prototype.getCurrentApp = function() {
		return this.appClientView.model;
	};

	return new ApplicationContext();
});
