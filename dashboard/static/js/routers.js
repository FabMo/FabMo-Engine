/*
 * routers.js defines the application routers which map URLs to application functions.
 */
define(function(require) {

	var dashboard = require('dashboard');

	var Router = Backbone.Router.extend({
		routes: {
			"app/:id"     		: "launch_app",
			"menu"        		: "show_menu",
			"refresh_machines" 	: "refresh_machines",
			"set_machine/:id" 	: "set_machine",
			"page/:name"		: "show_page"
		},
		launch_app: function(id) {
			app = this.context.apps.get(id);
			console.log(JSON.stringify(app))
			this.context.appClientView.setModel(app);
			this.context.appMenuView.hide();
			this.context.appClientView.show();
			this.context.hideModalContainer();
		},
		show_menu: function() {
			this.context.appClientView.hide();
			this.context.appMenuView.show();
			this.context.hideModalContainer();
		},
		show_page: function(page) {
			this.context.appClientView.hide();
			this.context.appMenuView.hide();
			this.context.showModalContainer(page);
			if(page =='settings') {
				this.context.loadDriverSettings(dashboard.machine);
				$('#modal_container').foundation('tab', 'init');
			}
		},
		set_machine: function(id) {
			machine = this.context.remoteMachines.get(id);
			console.log("SETTING MACHINE");
			console.log(machine.attributes);
			ChooseBestWayToConnect(machine.attributes, function(ip, port) {
				delete dashboard.machine;
				dashboard.machine = null;
				delete dashboard.ui;
				dashboard.ui = null;
				dashboard.machine = new FabMo(ip, port);
				dashboard.ui= new FabMoUI(dashboard.machine);
				this.context.bindKeypad(dashboard.ui);
				this.context.remoteMachines.forEach(function(item) {
					item.set("current","");
				});
				this.context.remoteMachines.get(id).set("current","current");
			}.bind(this));
		},
		refresh_machines: function() {
			this.context.refreshRemoteMachines(function(err,remoteMachines){
				if(this.context.remoteMachines.models.length === 0)
				{
					console.log('no machine detected');
				}
				else if(this.context.remoteMachines.models.length >= 1)
				{
					ChooseBestWayToConnect(this.context.remoteMachines.models[0].attributes,function(ip,port){
						delete dashboard.machine;
						dashboard.machine = null;
						delete dashboard.ui;
						dashboard.ui = null;
						dashboard.machine = new FabMo(ip, port);
						dashboard.ui= new FabMoUI(dashboard.machine);
						this.context.bindKeypad(dashboard.ui);
						this.context.remoteMachines.models[0].set("current","current");
					}.bind(this));
				}
			}.bind(this));
		},
		setContext: function(context) {
			this.context = context;
		}
	});

	return Router;
});