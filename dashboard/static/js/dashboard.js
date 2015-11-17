/*
 * This is where the application context that we will expose to the "apps" will go
 * This will include the currently selected machine (if any) as well as functions to interact with the dashboard itself.
 * This is different than the context provided by context.js, which is the context for the entire dashboard, not just
 * the parts that we want the app to see.
 */
define(function(require) {
	var events = require ('events');
	var toastr = require('toastr');
	
	var Dashboard = function(target) {
		this.engine = null;
		this.socket = null;
		this.ui = null;

		this.target = target || window;
		this.handlers = {};
		this.events = {
			'status' : []
		};
		this._registerHandlers();
		this._setupMessageListener();
	};

	Dashboard.prototype.setEngine = function(engine) {
		this.engine = engine;
		this.engine.on('status', function(data) {
			this.updateStatus(data);
		}.bind(this));
	}

	// Register a handler function for the provided message type
	Dashboard.prototype._registerHandler = function(name, handler) {
		if('message' in this.handlers) {
			throw ('Already registered a handler for the "' + name + '" message.')
		}
		this.handlers[name] = handler;
	}

	// Register a handler assuming that the message type is concurrent with a method name in the dashboard object (as is common)
	Dashboard.prototype._registerHandlerByName = function(name) {
		var proto = Object.getPrototypeOf(this);
		if(name in proto) {
			this.handlers[name] = proto[name];
		}
	}

	// The events member is a mapping of event type to sources and ids which map back to functions in the client dashboard
	Dashboard.prototype._registerEventListener = function(name, source) {
		if(name in this.events) {
			listeners = this.events[name];
			for(var i in listeners) {
				if(listeners[i] == source) { return; }
			}
			this.events[name].push(source);
		}
	}

	Dashboard.prototype._fireEvent = function(name, data) {
		if(name in this.events) {
			listeners = this.events[name];
			for(var i in listeners) {
				var source = listeners[i];
				var msg = {"status" : "success", "type" : "evt", "id" : name, "data" : data};
				source.postMessage(msg, "*");
			}
		}
	}

	Dashboard.prototype._setupMessageListener = function() {
		this.target.addEventListener('message', function(evt) {
			var source = evt.source;
			if('call' in evt.data) {
				var func = evt.data.call;
				if(func in this.handlers) {
					var handler = this.handlers[func];
					var data = evt.data.data;
					var id = evt.data.id >= 0 ? evt.data.id : -1;
					var msg;
					try {
						handler(data, function(err, data) {
							var msg;
							if(err) {
								msg = {"status" : "error", "type" : "cb", "message" : JSON.stringify(err) , "id" : id}
							} else {
								msg = {	"status" : "success", 
										"type" : "cb", 
										"data" : data, 
										"id" : id }
							}
							source.postMessage(msg, evt.origin);
						});
					} catch(e) {
						var msg = {"status" : "error", "type" : "cb", "message" : JSON.stringify(e) , "id" : id}
						source.postMessage(JSON.stringify(msg), evt.origin);
					}
				}
			} else if('on' in evt.data) {
				var name = evt.data.on;
				var source = evt.source;
				this._registerEventListener(name, source);
			}
		}.bind(this));
	}

	Dashboard.prototype._registerHandlers = function() {
		
		// Show the DRO
		this._registerHandler('showDRO', function(data, callback) { 
			this.openRightMenu();
			callback(null);
		}.bind(this));

		// Hide the DRO
		this._registerHandler('hideDRO', function() { 
			this.closeRightMenu() 
			callback(null)
		}.bind(this));
		
				// Show the footer
		this._registerHandler('showFooter', function(data, callback) { 
			this.openFooter();
			callback(null);
		}.bind(this));

		// Hide the footer
		this._registerHandler('hideFooter', function() { 
			this.closeFooter() 
			callback(null)
		}.bind(this));

		// Show a notification
		this._registerHandler('notification', function(data,callback) { 
			this.notification(data.type, data.message); 
			callback(null);
		}.bind(this))

		// Submit a job
		this._registerHandler('submitJob', function(data, callback) { 
			if('file' in data) {
				formdata = new FormData();
				formdata.append('file', data.file, data.file.name);
				
				this.engine.submitJob(formdata, function(err, result) {
					if(err) {
						callback(err);
					} else {
						this.launchApp('job-manager', {}, callback);
					}
				}.bind(this));
			} else if ('data' in data) {
				this.engine.submitJob(data, function(err, result) {
					if(err) {
						callback(err);
					} else {
						this.launchApp('job-manager', {}, callback);
					}
				}.bind(this));				
			}
		}.bind(this));

		this._registerHandler('resubmitJob', function(id, callback) { 
			this.engine.resubmitJob(id, function(err, result) {
				if(err) {
					callback(err);
				} else {
					this.launchApp('job-manager', {}, callback);
				}
			}.bind(this));
		}.bind(this));

		this._registerHandler('cancelJob', function(id, callback) { 
			this.engine.cancelJob(id, function(err, result) {
				if(err) {
					callback(err);
				} else {
					callback(err, result);
					//this.launchApp('job-manager', {}, callback);
				}
			}.bind(this));
		}.bind(this));


		// Get the list of jobs in the queue
		this._registerHandler('getJobsInQueue', function(data, callback) {
			this.engine.getJobsInQueue(function(err, jobs) {
				if(err) {
					callback(err);
				} else {
					callback(null, jobs);
				}
			})
		}.bind(this));

		this._registerHandler('getJobHistory', function(data, callback) {
			this.engine.getJobHistory(function(err, jobs) {
				if(err) {
					callback(err);
				} else {
					callback(null, jobs);
				}
			})
		}.bind(this));

		this._registerHandler('clearJobQueue', function(data, callback) {
			this.engine.clearJobQueue(function(err) {
				if(err) {
					callback(err);
				} else {
					callback(null);
				}
			})
		}.bind(this));

		this._registerHandler('runNext', function(data, callback) {
			this.engine.runNextJob(function(err, result) {
				if(err) { callback(err); }
				else { callback(null); }
			});
		}.bind(this));

		this._registerHandler('pause', function(data, callback) {
			this.engine.pause(function(err, result) {
				if(err) { callback(err); }
				else { callback(null); }
			});
		}.bind(this));

		this._registerHandler('stop', function(data, callback) {
			this.engine.quit(function(err, result) {
				if(err) { callback(err); }
				else { callback(null); }
			});
		}.bind(this));

		this._registerHandler('resume', function(data, callback) {
			this.engine.resume(function(err, result) {
				if(err) { callback(err); }
				else { callback(null); }
			});
		}.bind(this));

		this._registerHandler('nudge', function(data, callback) {
			this.engine.fixed_move(data.dir, data.dist, function(err, result) {
				if(err) { callback(err); }
				else { callback(null); }
			});
		}.bind(this));

		this._registerHandler('getApps', function(data, callback) {
			this.engine.getApps(function(err, result) {
				if(err) { callback(err); }
				else { callback(null, result); }
			});
		}.bind(this));

		// Submit an app
		this._registerHandler('submitApp', function(data, callback) { 
			if('file' in data) {
				var formdata = new FormData();
				formdata.append('file', data.file, data.file.name);
				this.engine.submitApp(formdata, function(err, result) {
					this.refreshApps();
					if(err) {
						callback(err);
					} else {
						callback(null, result);
					}
				}.bind(this));
			} else if ('data' in data) {
				this.engine.submitApp(data, function(err, result) {
					if(err) {
						callback(err);
					} else {
						callback(null);
					}
				}.bind(this));
			}
		}.bind(this));

		this._registerHandler('deleteApp', function(id, callback) {
			this.engine.deleteApp(id, function(err, result) {
				this.refreshApps();
				if(err) { callback(err); }
				else { callback(null, result); }
			}.bind(this));
		}.bind(this));

		this._registerHandler('runGCode', function(text, callback) {
			this.engine.gcode(text, function(err, result) {
				if(err) { callback(err); }
				else { callback(null, result); }
			}.bind(this));
		}.bind(this));

		this._registerHandler('runSBP', function(text, callback) {
			this.engine.sbp(text, function(err, result) {
				if(err) { callback(err); }
				else { callback(null, result); }
			}.bind(this));
		}.bind(this));

		this._registerHandler('getConfig', function(data, callback) {
			this.engine.getConfig(function(err, result) {
				if(err) { callback(err); }
				else { callback(null, result); }
			}.bind(this));
		}.bind(this));

		this._registerHandler('setConfig', function(data, callback) {
			this.engine.setConfig(data, function(err, result) {
				if(err) { callback(err); }
				else { callback(null, result); }
			}.bind(this));
		}.bind(this));

		///
		/// NETWORK MANAGEMENT
		///
		this._registerHandler('connectToWifi', function(data, callback) {
			this.engine.connect_to_wifi(data.ssid, data.key, function(err, result) {
				if(err) { callback(err); }
				else { callback(null, result); }
			}.bind(this));
		}.bind(this));

		this._registerHandler('disconnectFromWifi', function(data, callback) {
			this.engine.disconnect_from_wifi(function(err, result) {
				if(err) { callback(err); }
				else { callback(null, result); }
			}.bind(this));
		}.bind(this));

		this._registerHandler('forgetWifi', function(data, callback) {
			this.engine.forget_wifi(data.ssid, function(err, result) {
				if(err) { callback(err); }
				else { callback(null, result); }
			}.bind(this));
		}.bind(this));

		this._registerHandler('enableWifi', function(data, callback) {
			this.engine.enable_wifi(function(err, result) {
				if(err) { callback(err); }
				else { callback(null, result); }
			}.bind(this));
		}.bind(this));

		this._registerHandler('disableWifi', function(data, callback) {
			this.engine.disable_wifi(function(err, result) {
				if(err) { callback(err); }
				else { callback(null, result); }
			}.bind(this));
		}.bind(this));

		this._registerHandler('enableWifiHotspot', function(data, callback) {
			this.engine.enable_hotspot(function(err, result) {
				if(err) { callback(err); }
				else { callback(null, result); }
			}.bind(this));
		}.bind(this));

		this._registerHandler('disableWifiHotspot', function(data, callback) {
			this.engine.disable_hotspot(function(err, result) {
				if(err) { callback(err); }
				else { callback(null, result); }
			}.bind(this));
		}.bind(this));


		this._registerHandler('getMacros', function(data, callback) {
			this.engine.getMacros(function(err, result) {
				if(err) { callback(err); }
				else { callback(null, result); }
			}.bind(this));
		}.bind(this));

		this._registerHandler('runMacro', function(data, callback) {
			this.engine.runMacro(data, function(err, result) {
				if(err) { callback(err); }
				else { callback(null, result); }
			}.bind(this));
		}.bind(this));

		this._registerHandler('updateMacro', function(data, callback) {
			this.engine.updateMacro(data.id, data.macro, function(err, result) {
				if(err) { callback(err); }
				else { callback(null, result); }
			}.bind(this));
		}.bind(this));

		this._registerHandler('deleteMacro', function(data, callback) {
			this.engine.deleteMacro(data, function(err, result) {
				if(err) { callback(err); }
				else { callback(null, result); }
			}.bind(this));
		}.bind(this));


		this._registerHandler('launchApp', function(data, callback) {
			id = data.id;
			args = data.args || {};
			this.launchApp(id, args, callback);
		}.bind(this));

		this._registerHandler('getAppArgs', function(data, callback) {
			context = require('context');
			callback(null, context.current_app_args || {});
		}.bind(this));

		this._registerHandler('getAppInfo', function(data, callback) {
			context = require('context');
			callback(null, context.current_app_info || {});
		}.bind(this));

		this._registerHandler('getAppConfig', function(data, callback) {
			context = require('context');
			this.engine.getAppConfig(context.current_app_id, callback);
		}.bind(this));

		this._registerHandler('setAppConfig', function(data, callback) {
			context = require('context');
			this.engine.set_app_config(context.current_app_id, data, callback);
		}.bind(this));

		this._registerHandler('requestStatus', function(data, callback) {
			this.engine.getStatus(function(err,  status) {
				if(err) {
					callback(err);
				} else {
					this.updateStatus(status);
					callback(null, status);
				}
			}.bind(this));
		}.bind(this));

		this._registerHandler('notify', function(data, callback) {
			if(data.message) {
				this.notification(data.type || 'info', data.message);
				callback(null);
			} else {
				callback('Must provide a message to notify.');
			}
		}.bind(this));
	}

	Dashboard.prototype.updateStatus = function(status){
		this._fireEvent("status", status);
	};

	// Brings up the DRO (if separate from the keypad) in the dashboard
	Dashboard.prototype.DRO = function(callback){
		this.notification('info','Move the tool if necessary, then hit "Enter');
		this.openRightMenu(); //Open the menu to let the user control the tool

		//Waiting keydown on "enter" key, before calling callback.
		var key=$(document).keydown(function(e){
			if ((e.which == 13)) {
				if(typeof callback === 'function') callback(key);
			}
		});
		return;
	};

	//Open the right menu
	Dashboard.prototype.openRightMenu = function() {
		if ($(window).width() < 900) {
			events.openDROover();
		} else {
			events.openDROPush();
		}
	}

	//Close the right menu
	Dashboard.prototype.closeRightMenu = function() {
		if ($(window).width() < 900) {
			events.closeDROover();
		} else {
			events.closeDROPush();
		}
	}

	//Open Footer
	Dashboard.prototype.openFooter = function() {
		$('.footBar').css('height', '50px');
	}
	
	//Close Footer
	Dashboard.prototype.closeFooter = function() {
		$('.footBar').css('height', '0px');
	}

	// Open and close the right menu
	Dashboard.prototype.bindRightMenu = function(mouv) {
		if($("#main").hasClass("offcanvas-overlap-left")){
			if(mouv) {
				this.closeRightMenu();
			}
			else {
				this.ui.setMenuClosed();
			}
		}
		else {
			if(mouv){
				this.openRightMenu();
			}
			else {
				this.ui.setMenuOpen();
			}
		}
	}

	Dashboard.prototype.notification = function(type,message) {
		switch(type) {
			case 'info': toastr.info(message); break;
			case 'success': toastr.success(message); break;
			case 'warning': toastr.warning(message); break;
			case 'error': toastr.error(message); break;
			default:
				console.error("Unknown type of notification: " + type);
				break;
		}
	}

	Dashboard.prototype.launchApp = function(id, args, callback) {
		context = require('context');
		context.launchApp(id, args, callback);
	}

	Dashboard.prototype.refreshApps = function() {
		context = require('context');
		context.apps.fetch();
	}

	// The dashboard is a singleton which we create here and make available as this module's export.
	var dashboard = new Dashboard();
	
	return dashboard;

});