/*
 * This is where the application context that we will expose to the "apps" will go
 * This will include the currently selected machine (if any) as well as functions to interact with the dashboard itself.
 * This is different than the context provided by context.js, which is the context for the entire dashboard, not just
 * the parts that we want the app to see.
 */

define(function(require) {

	Dashboard = function() {
		this.machine = null;
		this.ui = null;

		this.keyCommands();
		this.checkDashboardSettings();

		//Refresh of the tool status on the dashboard
		this.refresh = 500; // define the tool connection refresh time (ms)
		setInterval(this.updateStatus.bind(this),this.refresh);

		this.target = window;
		this.registerHandlers();
	};

	Dashboard.prototype.registerHandlers = function() {
		this.target.addEventListener('message', function (e) {
			var iframe = e.source;
			try {

				if(e.data.showDRO === true) {
					this.openRightMenu();
				 }

				 else if(e.data.showDRO === false) {
					this.closeRightMenu();
				 }

				 else if(e.data.job !== undefined) {
					this.machine.add_job(e.data.job, function(err, result) {
						if(err) {
							console.log(err);
						} else {
							this.jobManager();
						}
					}.bind(this));
				 }

				else if(e.data.getMachine === true) {
					msg = {'ip':this.machine.ip, 'port':this.machine.port};
					e.source.postMessage(msg,'*');
					}

			} catch (e) {
				throw e;
			}
		}.bind(this));
	}

	/*** Prototypes ***/
	Dashboard.prototype.updateStatus = function(){
		//if (this.ui.tool.status == )
		if(this.ui) {
			if(this.ui.tool.state) {
				console.log(this.ui.tool.state);
			}
		}
	};

	// Brings up the DRO (if separate from the keypad) in the dashboard
	Dashboard.prototype.DRO = function(callback){
		if(!callback) {
			return console.log("This function 'DRO' needs a callback to run");
		}
		else {
			that=this;
			that.notification('info','Move the tool if necessary, then hit "Enter');
			that.openRightMenu(); //Open the menu to let the user control the tool

			//Waiting keydown on "enter" key, before calling callback.
			var key=$(document).keydown(function(e){
				if ((e.which == 13)) {
					if(typeof callback === 'function') callback(key);
				}
			});
		}
		return;
	};

	//Open the right menu
	Dashboard.prototype.openRightMenu = function() {
		that=this;
		$("#main").addClass("offcanvas-overlap-left");
		if(that.machine) {
			that.ui.setMenuOpen();
		}
		resizedoc();
	}

	//Close the right menu
	Dashboard.prototype.closeRightMenu = function() {
		that=this;
		$("#main").removeClass("offcanvas-overlap-left");
		if(that.machine) {
			that.ui.setMenuClosed();
		}
		resizedoc();
	}

	// Open and close the right menu
	Dashboard.prototype.bindRightMenu = function(mouv) {
		that=this;
		if($("#main").hasClass("offcanvas-overlap-left")){
			if(mouv) {
				that.closeRightMenu();
			}
			else {
				that.ui.setMenuClosed();
			}
		}
		else {
			if(mouv){
				that.openRightMenu();
			}
			else {
				that.ui.setMenuOpen();
			}
		}
	}

	// React to keydown on "k" shortcute, show / hide right menu and show keypad if allowed
	Dashboard.prototype.keyCommands = function(){
		that=this;
		$(document).keydown(function(e){
			if (e.which == 75) {
				that.keypad(true,true);
			}

			//Development only : Run the DRO function with a callback, with "d" shortcode
			if (e.which == 68) {
				that.DRO(function(ev){
					that.closeRightMenu();
					that.notification("success","DRO Worked");
					ev=null;
				});
			}
		});

		$(".right-small").click( function() {
			that.keypad(true,false);
			resizedocclick();
		});
	};

	Dashboard.prototype.keypad = function(test,mouv) {
		that=this;
		if (that.machine) {
			if(that.ui.statusKeypad() && test) {
				that.bindRightMenu(mouv);
			}
			else that.notification("error","KeyPad Unvailable");
		}
		else that.notification("warning","Please Connect to a tool");
	};

	Dashboard.prototype.notification = function(type,message) {
		if(type=='info') 			toastr.info(message);
		else if (type=="success") 	toastr.success(message);
		else if (type=="warning") 	toastr.warning(message);
		else if (type=="error") 	toastr.error(message);
		else console.log("Unknown type of notification");
	}

	Dashboard.prototype.jobManager = function() {
		context = require('context');
		context.launchApp('job-manager');
	}

	Dashboard.prototype.checkDashboardSettings = function() {
		var that=this;
		 var s=JSON.parse(localStorage.getItem('dashboardSettings'));

        if (s == null) {
          console.log("No Settings Defined, Load defaults settings");
          //Load Default Settings into S variable
          s={
			"appName": {
				"name":"DashBoard Name",
				"value":"FabMo DashBoard",
				"type":"text"
			},
			"mainColor": {
				"name":"Main Color (top-bar...)",
				"value":"#313366",
				"type":"color",
				"colors": ["#54ba4c","#313366","#dd8728","#9c210c","#444"]
			},
			"secondColor": {
				"name":"Secondary color (menu...)",
				"value":"#444",
				"type":"color",
				"colors": ["#54ba4c","#313366","#dd8728","#9c210c","#444"]
			},
			"positionBackground": {
				"name":"Main Dashboard Color",
				"value":"#9c210c",
				"type":"color",
				"colors": ["#54ba4c","#313366","#dd8728","#9c210c","#111"]
			},
			"positionFront": {
				"name":"Main Dashboard Color",
				"value":"#9c210c",
				"type":"color",
				"colors": ["#54ba4c","#313366","#dd8728","#9c210c","#111"]
			},
			"keypadBackground": {
				"name":"Main Dashboard Color",
				"value":"#dd8728",
				"type":"color",
				"colors": ["#54ba4c","#313366","#dd8728","#9c210c","#111"]
			},
			"keypadFront": {
				"name":"Main Dashboard Color",
				"value":"#9c210c",
				"type":"color",
				"colors": ["#54ba4c","#313366","#dd8728","#9c210c","#111"]
			},
			"leftMenuDefaultColapsed": {
				"name":"Colapsed Left Menu",
				"value":true,
				"type":"checkbox"
			}
		};
        localStorage.setItem('dashboardSettings',JSON.stringify(s));
      }

      this.updateDashboardSettings();
	}

	Dashboard.prototype.updateDashboardSettings = function() {
		var s=JSON.parse(localStorage.getItem('dashboardSettings'));

        if (s != null) {
        	$("#dashboardName").html(s.appName.value);
        	$("title").html(s.appName.value);
        }
	};

	Dashboard.prototype.resetDashboardSettings = function() {
		localStorage.setItem('dashboardSettings',null);
		this.checkDashboardSettings();
	}

	// The dashboard is a singleton which we create here and make available as this module's export.
	var dashboard = new Dashboard();
	
	return dashboard

});