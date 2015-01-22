define(function(require) {
	var ace = require('ace/ace');

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
				//var d = null;
			}
			iframe.src = url;
			
			$('.app-iframe').load(function() {
				iframe.contentWindow.dashboard = d;
			});

		},
		show : function() {
			$(".main-section").show();
			$(this.el).show();
		},
		hide : function(arg) {
			$(".main-section").hide();
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
				var singleRemoteMachine;
				if(item.get("current")=="current") {
					cpt++; console.log(cpt);
					jQuery('.tools-current').empty();
					singleRemoteMachine = new views.SingleMachineView({ model: item,el:'.tools-current'});
				}
				singleRemoteMachine = new views.SingleMachineView({ model: item,el:'.tools-other'});
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
				}
			}
	});

	views.AppStudioFileView = Backbone.View.extend({
		tagName : 'div',
		className : 'app-studio-files',
		model : new models.App(),
		initialize : function() {
			_.bindAll(this, 'render');
			if(this.model) {
				this.model.bind('change', this.render);
			}
			this.$el.on('changed.jstree', function (e, data) {
				file = data.instance.get_node(data.selected[0])
				if(file.original.type === 'file') {
					context = require('context');
					console.log("Selected: " + file)
					console.log(file.original.url)
					model = new models.AppFile({'location':file.original.url});
					console.log(model)
					context.appStudioEditorView.setModel(new models.AppFile({url:file.original.url}))
				}
			});
		},
		show : function() {
			$(".main-section").show();
			this.$el.show();
		},
		hide : function() {
			$(".main-section").hide();
			this.$el.hide();
		},
		render : function() {
			console.log("Rendering file tree view")
			if(this.model) {
				$.getJSON('/apps/' + this.model.id + '/files', function(data) {
					console.log(data);
					this.$el.jstree({'core' : {'data' : data, 'check_callback':true}});
				}.bind(this))
			};
			return this;
		},
		setModel : function(model) {
			if(model) {
				this.model.set(model.toJSON());
			} else {
				this.model.set(null);
			}
		}
	});

	views.AppStudioEditorView = Backbone.View.extend({
		tagName : 'div',
		className : 'app-studio-editor',
		model : new models.AppFile(),
		initialize : function() {
			_.bindAll(this, 'render');
			if(this.model) {
				this.model.bind('change', this.render);
			}
		},
		show : function() {
			$(".main-section").show();
			this.$el.show();
		},
		hide : function() {
			$(".main-section").hide();
			this.$el.hide();
		},
		render : function() {
			console.log("Rendering editor view")
			var editor = ace.edit("app-studio-editor-widget");
			editor.setTheme("ace/theme/xcode");
			editor.setOptions({
				maxLines:1000,
				vScrollBarAlwaysVisible:true,
				autoScrollEditorIntoView: true
			});
			console.log(this.model.get('location'));
			$.get( this.model.get('location'), function( data ) {
				console.log(data);
				editor.setValue(data, -1)
			});
			return this;
		},
		setModel : function(model) {
			if(model) {
				this.model.set(model.toJSON());
			} else {
				this.model.set(null);
			}
		}
	});

	return views;
});