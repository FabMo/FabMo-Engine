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
				dashboard.browseForFiles(function(evt) {
					var files = [];
					for(var i=0; i<evt.target.files.length; i++) {
						files.push({file:evt.target.files[i]});
					}
					dashboard.engine.submitApp(files, {}, function(err, data) {
						if(err) {
							dashboard.notification('error', err.message);
						} else {
							dashboard.notification('success', data.length + " app" + ((data.length > 1) ? 's' : '') + " installed successfully.");
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
			this.iframe = null;
			this.hard_refresh = false;
			_.bindAll(this, 'render');
		},
		render : function(hard_refresh, callback) {
			if(this.model) {
				url = this.model.get('app_url');
			} else {
				url = "about:blank";
			}
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
			$(".main-section").show();
			$(this.el).css('visibility', 'visible');
			/*var el = $(this.el);
			el.css('position', 'static');
			el.css('width', '100%');
			el.css('height', '100%');
			el.css('top', 'auto');
			el.css('left', 'auto');*/
			this.is_visible = true;

		},
		hide : function(arg) {
			$(this.el).css('visibility', 'hidden');
			/*var el = $(this.el);
			el.css('position', 'absolute');
			el.css('width', 100);
			el.css('height', 100);
			el.css('top', 300);
			el.css('left', 300);*/
			this.is_visible = false;

		},
		setModel : function(model, hard_refresh, callback) {
			if(model) {
				this.hard_refresh = hard_refresh;
				this.model.set(model.toJSON());
			} else {
				this.model.set(null);
			}
			this.render(hard_refresh, callback);
		}
	});

	return views;
});
