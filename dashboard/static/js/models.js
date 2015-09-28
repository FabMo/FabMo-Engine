define(function(require) {
	var Backbone = require('backbone');
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
		url : '/apps',
		parse : function(response) {
			apps = response.data.apps;
			return apps
		},
	});

	return models;
});