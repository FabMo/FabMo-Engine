define(function(require) {

	var models = require('./models.js');
	var Backbone = require('backbone');
	var auth = require('./auth.js');
	var _ = require('underscore');
	var views = {};

	views.Authentication = Backbone.View.extend({
		el : '#mainContent',
		template: _.template(require('text!./templates/authentication.html')),
		initialize : function (){
			this.render();
		},
		render : function() {
			$(this.el).html(this.template());
			return this;
		}
		
	});

	views.AppClientView = Backbone.View.extend({
		tagName : 'div',
		className : 'app',
		model : new models.App(),
		initialize : function(options) {
			this.is_visible = false;
			this.iframe = null;
			this.hard_refresh = false;
			_.bindAll(this, 'render');
		},
		render : function(hard_refresh, callback) {
			var url = this.model.get('app_url') || "about:blank";
			var client_container = jQuery(this.el);
			var src = '<iframe class="app-iframe" id="app-iframe" sandbox="allow-scripts allow-same-origin" allowfullscreen></iframe>'
			client_container.html(src);
			this.iframe = $(client_container.children()[0]);
			if(hard_refresh) {
				this.iframe.one('load', function() {
					this.hardRefresh(callback);
				}.bind(this));
			} else {
				this.iframe.one('load', callback);
			}
			this.iframe.attr('src', url);
		},
		hardRefresh : function(callback) {
			this.iframe.one('load', function() {
				callback();
			});
			this.iframe[0].contentWindow.location.reload(true);
 		},
		show : function() {
			$(this.el).css('visibility', 'visible');
			this.is_visible = true;

		},
		hide : function(arg) {
			$(this.el).css('visibility', 'hidden');
			this.is_visible = false;

		},
		setModel : function(model, hard_refresh, callback) {
			if(model) {
				this.hard_refresh = hard_refresh;
				this.model.set(model.toJSON());
			} else {
				this.model.clear();
			}
			this.render(hard_refresh, callback);
		}
	});

	return views;
});
