define(function(require) {

	var models = require('models');
	var views = {};

	views.AppIconView = Backbone.View.extend({
		tagName : 'li',
		className : 'app-icon',
		attributes : function () {
			return {
				display : this.model.get('icon_display')
			};
		},
		template : _.template(require('text!templates/app-icon.html')),
		initialize : function() {
			_.bindAll(this, 'render');
			this.model.bind('change', this.render);
		},
		render : function() {
			this.$el.html(this.template(this.model.toJSON()));
			return this;
		}
	});

	views.AddAppView = Backbone.View.extend({
		tagName : 'li',
		className : 'app-icon',
		template : _.template(require('text!templates/app-icon-add.html')),
		initialize : function() {
			_.bindAll(this, 'render');
		},
		render : function() {
			this.$el.html(this.template({}));
			this.$el.on('click', function(evt) {
				var dashboard = require('dashboard');
				dashboard.browseForFile(function(evt) {
					dashboard.engine.submitApp({file:evt.target.files[0]}, {}, function(err, data) {
						if(err) {
							dashboard.notify('error', err.message);
						}
						var context = require('context');
						context.apps.fetch();
					});
				});
			});
			return this;
		}
	});


	views.AppMenuView = Backbone.View.extend({
		tagName : 'div',
		className : 'app-menu',
		collection : null,
		initialize : function(options) {
			_.bindAll(this, 'render');
			this.collection = options.collection;
			this.collection.bind('reset', this.render);
			this.collection.bind('add', this.render);
			this.collection.bind('remove', this.render);
			this.is_visible = true;
			this.render();
		},
		render : function() {
			var element = jQuery(this.el);
			var count = 0;
			element.empty();
			this.collection.forEach(function(item) {
				var appIconView = new views.AppIconView({ model: item });
				element.append(appIconView.render().el);
			});				
			element.append(new views.AddAppView().render().el);				
			return this;
		},
		show : function() {
			this.is_visible = true
			$(this.el).show();
		},
		hide : function() {
			this.is_visible = false
			$(this.el).hide();
		}
	});

	views.AppClientView = Backbone.View.extend({
		tagName : 'div',
		className : 'app',
		model : new models.App(),
		initialize : function(options) {
			this.is_visible = false;
			_.bindAll(this, 'render');
		},
		render : function() {
			if(this.model) {
				url = this.model.get('app_url');
			} else {
				url = "about:blank";
			}

			var client_container = jQuery(this.el);
			var src = '<iframe class="app-iframe" id="app-iframe" sandbox="allow-scripts allow-same-origin" src="' + url + '" allowfullscreen></iframe>'
			client_container.html(src);
			iframe = client_container.children();
		},
		show : function() {
			$(".main-section").show();
			$(this.el).show();
			this.is_visible = true;
		},
		hide : function(arg) {
			$(".main-section").hide();
			$(this.el).hide();
			this.is_visible = false;
		},
		setModel : function(model) {
			if(model) {
				this.model.set(model.toJSON());
			} else {
				this.model.set(null);
			}
			this.render();
		}
	});

	return views;
});
