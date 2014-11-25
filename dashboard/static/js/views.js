define(function(require) {
	models = require('models');
	views = {}

	// VIEWS
	views.NavbarView = Backbone.View.extend({
		initialize : function() {
			this.render();
		},
		render : function() {
			//var template = _.template($("#navbar-template").html(), {});
			//this.$el.html(template);

	        //Fetching the template contents
	        $.get('template/navbar.html', function (data) {
	            template = _.template(data, {});//Option to pass any dynamic values to template
	            this.$el.html(template);//adding the template content to the main template.
	        }, 'html');
		}
	});

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
			return this;
		},
		show : function() {
			$(this.el).show();
		},
		hide : function() {
			$(this.el).hide();
		}
	});

	views.AppClientView = Backbone.View.extend({
		tagName : 'div',
		className : 'app',
		model : new models.App(),
		initialize : function(options) {
			_.bindAll(this, 'render');
		},
		render : function() {
			element = jQuery(this.el);
			var iframe = element.find('.app-iframe')[0];
			if(this.model) {
				url = this.model.get('app_url');
				var d = require('dashboard');
			} else {
				url = "about:blank";
				var d = null;
			}
			// TODO: Look at order of execution here? (is it ok to change src before binding the dashboard?)
			console.log("BINDING DASHBOARD")
			iframe.onload = function() {
				console.log(iframe);
				console.log(d);
				iframe.contentWindow.dashboard = d;
			}
			iframe.src = url;
			//iframe.parent.dashboard = d;
			//console.log(iframe.parent)
			//console.log(iframe.contentDocument)
			//console.log(iframe.contentWindow)
			//iwin = iframe.contentDocument.parentWindow;
			//iwin.parent 

		},
		show : function() {
			$(this.el).show();
		},
		hide : function(arg) {
			$(this.el).hide();
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

	views.PageView = Backbone.View.extend({
		collection:null,
		template:_.template(require('text!templates/page.html')),
		initialize : function() {
			_.bindAll(this, 'render');
			this.model.bind('change', this.render);
		},
		render : function() {
			this.$el.html(this.template(this.model.toJSON()));
			return this;
		}
	});

	views.WidgetView = Backbone.View.extend({
		template : _.template(require('text!templates/widget.html')),
		initialize : function() {
			_.bindAll(this, 'render');
			this.render();
		},
		render : function() {
			this.setElement('#'+this.model.get('host_id'));
			this.$el.append(this.template(this.model.toJSON()));
			return this;
		}
	});

	views.SingleMachineView = Backbone.View.extend({
		template : _.template(require('text!templates/single-machine-view.html')),
		initialize : function() {
			_.bindAll(this, 'render');
			this.render();
		},
		render : function() {
			this.model.set("id",this.model.cid);
			this.$el.append(this.template(this.model.toJSON()));
			return this;
		}
	});

	views.RemoteMachineMenuView = Backbone.View.extend({
		tagName : 'ul',
		className : 'off-canvas-list',
		collection : null,
		initialize : function(options) {
			this.collection = options.collection;
			this.collection.bind('reset', this.render, this);
			this.collection.bind('add', this.render, this);
			this.collection.bind('remove', this.render, this);
			this.collection.bind('change', this.render, this);
			_.bindAll(this, 'render');
		},
		render : function() {
			jQuery('.tools-other').empty();
			jQuery('.tools-current').html('<li><a href="#">Refresh</a></li>');
			var cpt=0;
			this.collection.forEach(function(item) {
				if(item.get("current")=="current") {
					cpt++; console.log(cpt);
					jQuery('.tools-current').empty();
					var singleRemoteMachine = new views.SingleMachineView({ model: item,el:'.tools-current'});
				}
				var singleRemoteMachine = new views.SingleMachineView({ model: item,el:'.tools-other'});
			}.bind(this));

			return this;
		},
		
		// hack for the "non-reload on same url" problem with backbone.js
		// more explanation on http://movableapp.com/2012/06/how-to-refresh-router-action-backbonejs-tutorial/
	    events: {
	        'click .tool > a' 	: 'onClick',
	        'click li.tool'		: 'showHideTools'
	    },
	    
	    onClick: function( e ) {
	        router.navigate('/');
	    },

	    //Move this on view, wich will concert 1 tool, and not all the tools
	    showHideTools: function ( e ) {
	    	var o = this.$el.children();
	    	var c = o.length;
			if (c > 1)
				if( o.last().is(":hidden") ) {
					o.slice(1).slideDown("fast");
				}
				else {
					o.slice(1).slideUp("fast");
					/*
					if($(this).parent()[0]!=$( "#remote-machine-menu > li:last" )[0]) {
		              $("#remote-machine-menu > li:first-child").removeClass('current');
		              $(this).parent().addClass('current');
		              $(this).parent().insertBefore($("#remote-machine-menu > li:first-child"));
		              $( "#remote-machine-menu > li").slice(1).slideUp( "fast" );
		            }
	            	*/
				}
	    	}
	});


	views.JobView = Backbone.View.extend({
		tagName : 'div',
		className : 'job',
		template : _.template(require('text!templates/job.html')),
		initialize : function() {
			_.bindAll(this, 'render');
			this.model.bind('change', this.render);
		},
		render : function() {
			this.$el.html(this.template(this.model.toJSON()));
			return this;
		}
	});

	views.JobListView = Backbone.View.extend({
		tagName : 'div',
		className : 'jobs_list',
		collection : null,
		initialize : function(options) {
			_.bindAll(this, 'render');
			this.collection = options.collection;
			this.collection.bind('reset', this.render);
			this.collection.bind('add', this.render);
			this.collection.bind('remove', this.render);
			this.render();
		},
		render : function() {
			var element = jQuery(this.el);
			element.empty();
			this.collection.forEach(function(item) {
				var appIconView = new views.JobView({ model: item });
				element.append(JobView.render().el);
			});
			return this;
		},
		show : function() {
			$(this.el).show();
		},
		hide : function() {
			$(this.el).hide();
		}
	});


	views.SettingsFormLineView = Backbone.View.extend({
		tagName : 'div',
		className : 'settings-form-line',
		template : _.template(require('text!templates/settings-form-line.html')),
		initialize : function() {
			_.bindAll(this, 'render');
			this.model.bind('change', this.render);
		},
		render : function() {
			this.$el.html(this.template(this.model.toJSON()));
			return this;
		}
	});

	views.SettingsFormView = Backbone.View.extend({
		tagName : 'div',
		className : 'settings-form',
		collection : null,
		initialize : function(options) {
			_.bindAll(this, 'render');
			this.collection = options.collection;
			this.collection.bind('reset', this.render);
			this.collection.bind('add', this.render);
			this.collection.bind('remove', this.render);
			this.render();
		},
		render : function() {
			var element = jQuery(this.el);
			element.empty();
			this.collection.forEach(function(item) {
				var settingsFormLineView = new views.SettingsFormLineView({ model: item });
				element.append(settingsFormLineView.render().el);
			});
			return this;
		},
		show : function() {
			$(this.el).show();
		},
		hide : function() {
			$(this.el).hide();
		}
	});

	return views;
});