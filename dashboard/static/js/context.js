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

define(function(require) {

 	var Lockr = require('./libs/lockr.min.js');

	ApplicationContext = function() {
		// Model/View/Router Prototypes
		this.models = require('./models.js');
		this.views = require('./views.js');
		this.Router = require('./routers.js');

		this.engine = null;
		// View Instances
		//this.Menu = new this.views.Menu();
		this.Authentication = new this.views.Authentication();
		this.appClientView = new this.views.AppClientView({el : "#app-client-container"});
		this.current_app_id = null;
		this.reload_on_demand = false;
		this.app_reload_index = {};
		this.menuShown = true;
	};
	$('#mainContent').hide();
	ApplicationContext.prototype.markAppForRefresh = function(id) {
		if(id in this.app_reload_index) {
			this.app_reload_index[id] = true;
		}
		Lockr.set('fabmo_app_reload_index', this.app_reload_index);
	}

	ApplicationContext.prototype.setEngineVersion = function(version) {
		this.engineVersion = version;
		this.app_reload_index = Lockr.get('fabmo_app_reload_index') || {};
	}

	ApplicationContext.prototype.showModalContainer = function(name){
		this.page.set("name",name);
		$('#modal_container').show();
	}

	ApplicationContext.prototype.hideModalContainer = function(){
		$('#modal_container').hide();
	}

	ApplicationContext.prototype.closeApp = function(callback) {
		this.appClientView.setModel(null, false, callback);
	}

	ApplicationContext.prototype.launchApp = function(id, args, callback) {
		var hard_refresh = false;
		var hash = this.app_reload_index[id];

		try {
			if(hash && hash != this.engineVersion.hash) {
				console.info("Hard refresh of app " + id + " because hash " + hash + " doesn't match " + this.engineVersion.hash);
				hard_refresh = true;
			}

		} catch(e) {
			console.warn(e);
		}

		try {
			if(this.engineVersion.debug) {
				hard_refresh = true;
				console.info("Hard refresh of app " + id + " because debug mode.");
			}
		} catch(e) {
			console.warn(e);
		}

		this.app_reload_index[id] = this.engineVersion.hash;
		Lockr.set('fabmo_app_reload_index', this.app_reload_index);

		current_app = this.getCurrentApp();
		if(current_app.id != id) {
			app = this.apps.get(id);
			if(app) {
				this.current_app_args = args || {};
				this.current_app_id = id;
				this.current_app_info = app;
				this.appMenuView.hide();
				$('#waiting_container').show();
				this.menuShown = false;
				this.appClientView.setModel(app, hard_refresh, function() {
					if(!this.menuShown) {
						$('#waiting_container').hide();
						this.hideModalContainer();
						this.appClientView.show();
					}
					callback(null);
				}.bind(this));
			} else {
				if(this.apps) {
					callback("Couldn't launch app: " + id + ": Apps list not available yet.");
				} else {
					callback("Couldn't launch app: " + id + ": No such app?");
				}
			}
		} else {
			this.menuShown = false;
			this.appMenuView.hide();
			$('#waiting_container').hide();
			this.hideModalContainer();
			this.appClientView.show();

		}
	};

	ApplicationContext.prototype.getCurrentApp = function() {
		return this.appClientView.model;
	};

	return new ApplicationContext();

});