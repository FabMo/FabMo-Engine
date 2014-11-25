define(function(require) {

	models = {}

	// Model for a single app instance
	models.App = Backbone.Model.extend({
		defaults:{
			name : null,
			icon_path : null,
			icon_background_color : null,
			icon_display:null,
			app_path : null,
			app_url : null,
			id : null
		},
		sync: function(method, model, options) {
			if (method === 'read') {
				Backbone.sync(method, model, options);
			} else {
				console.error('You can not ' + method + ' the App model');
			}
		}
	});

	// A collection of (all) apps
	models.Apps = Backbone.Collection.extend({
		model : models.App,
		url : '/apps'
	});

	//Model for the page content (settings / jobLists...)
	models.Page = Backbone.Model.extend({
		defaults:{
			name : 'page' //Tiny Model, need a view just for displaying the name
		},
		sync : function(method, model, option) {} // Override sync because this is a local model
	});

	// Model for a widget container (div structure wich display the name of the widget, and create an area to receive the content of the widget)
	models.Widget = Backbone.Model.extend({
		defaults:{
			name : '', //Name of the widget
			id : '', //Id of the widget, will be the ID-container wich will hold the content of the widget
			host_id : '', //ID of the area that host the widget
			position : 1, //Position of the widget in the area
			active : true, //Widget is currently used in the app
		},
		sync : function(method, model, option) {} // Override sync because this is a local model
	});

	models.Widgets = Backbone.Collection.extend({
		model : models.Widget
	});

	// Model for a remote machine, elligible to be connected to
	models.RemoteMachine = Backbone.Model.extend({
		defaults:{
			//Add a listener when the state changes
			hostname:'<unknown>',
			network: [],
			server_port: 8080,
			current:'',
			state: '' //state = status : ''=green=OK : 'err'=red=Trying to connect, or error to connec : 'disc'=grey=Not connected
		},
		sync : function(method, model, option) {} // Override sync because this is a local model	
	});

	// Collection of (all) remote machines
	models.RemoteMachines = Backbone.Collection.extend({
		model : models.RemoteMachine,
	});

	// TODO: File and Job models need to be reconciled
	models.File = Backbone.Model.extend({
		defaults:{
			id: null,
			status : 'pending',
			url:''
		},
		sync : function(method, model, option) {} // Override sync because this is a local model	
		
	});

	models.Files = Backbone.Collection.extend({
		model : models.Files,
	});

	models.Job = Backbone.Model.extend({
		defaults:{
			id: null,
			files : new models.Files(),
			status:'pending'
		},
		sync : function(method, model, option) {} // Override sync because this is a local model	
	});

	// TODO: A form is not a good candidate for a model, this should be a view
	models.SettingFormLine = Backbone.Model.extend({
		defaults:{
			setting_label:null,
			setting_value:null,
			type:"text",
			code:null,
			id : null
		},
		sync : function(method, model, option) {} // Override sync because this is a local model
	});

	models.SettingsForm = Backbone.Collection.extend({
		model : models.SettingFormLine
	});

	return models;
});