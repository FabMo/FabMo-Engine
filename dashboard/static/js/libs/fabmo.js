/**
 * @module fabmo.js
 */
(function (root, factory) {
   var body = document.getElementsByTagName('body');
    if (typeof define === 'function' && define.amd) {
        // AMD
        define([], factory);
    } else if (typeof exports === 'object') {
        // Node, CommonJS-like
        module.exports = factory();
    } else {
        // Browser globals (root is window)
        root.FabMoDashboard = factory();
    }
}(this, function () {

/**
 * The top-level object representing the dashboard.
 *
 * @class FabMoDashboard
 */
var FabMoDashboard = function(options) {
    this.version = '{{FABMO_VERSION}}';
	this.target = window.parent;
	this.window = window;
	this._setOptions(options);
	this._id = 0;
	this._handlers = {};
	this.status = {};
	this.isReady = false;
	this._event_listeners = {
		'status' : [],
		'job_start' : [],
		'job_end' : [],
		'change' : [],
		'disconnect' : [],
		'reconnect' : [],
    	'video_frame' : [],
      'upload_progress':[]
	};
	this._setupMessageListener();
    // listen for escape key press to quit the engine
    document.onkeydown = function (e) {
        if(e.keyCode === 27) {
            console.warn("ESC key pressed - quitting engine.");
            this.stop();
        } else if (e.keyCode === 75 && e.ctrlKey ) {
			this.manualEnter()
		}
	}.bind(this);
	
	function detectswipe(func) {
        swipe_det = new Object();
        swipe_det.sX = 0; swipe_det.sY = 0; swipe_det.eX = 0; swipe_det.eY = 0;
        var max_x = 80;  //max x difference for vertical swipe
        var min_y = 100;  //min y swipe for vertical swipe
		var swipe = true;
		var maxSwipeTime = 300;
		var direc = "";
		var swipeTime;
		ele = window.document;
		function startSwipeTime() {
			swipeTime = setTimeout(function(){
				swipe = false;
			}, maxSwipeTime);
		};
		
        ele.addEventListener('touchstart',function(e){
			startSwipeTime();
			var t = e.touches[0];
			swipe_det.sX = t.screenX; 
			swipe_det.sY = t.screenY;
        },false);
        ele.addEventListener('touchmove',function(e){
          var t = e.touches[0];
          swipe_det.eX = t.screenX; 
          swipe_det.eY = t.screenY;    
        },false);
        ele.addEventListener('touchend',function(e){
		  //vertical detection
          if ((((swipe_det.eY - min_y > swipe_det.sY) || (swipe_det.eY + min_y < swipe_det.sY)) && ((swipe_det.eX < swipe_det.sX + max_x) && (swipe_det.sX > swipe_det.eX - max_x) && (swipe_det.eY > 0) && swipe))) {
			clearTimeout(swipeTime);
			if(swipe_det.eY < swipe_det.sY) direc = "u";
			else direc = "d";
          }
      
          if (direc != "") {
            if(typeof func == 'function') func(direc);
          }
          direc = "";
		  swipe_det.sX = 0; swipe_det.sY = 0; swipe_det.eX = 0; swipe_det.eY = 0; swipe = true;

        },false);  
      }
      
	  myfunction = function (d) {
        if(d === "u") {
            this.manualEnter();
        }
      }.bind(this);

      detectswipe(myfunction);

    if(!this.options.defer) {
		this.ready();
	}
}

FabMoDashboard.prototype._setOptions = function(options) {
	options = options || {};
	this.options = {};
	this.options.defer = options.defer || false;
}

/**
 * @method isPresent
 * @return {boolean} True if running in the actual FabMo dashboard.  False otherwise.
 */
FabMoDashboard.prototype.isPresent = function() {
    try {
        return window.self !== window.top;
    } catch (e) {
        return true;
    }
}

FabMoDashboard.prototype._download = function(data, strFileName, strMimeType) {
	// https://github.com/rndme/download
	// data can be a string, Blob, File, or dataURL

	var self = window 						// this script is only for browsers anyway...
	var u = "application/octet-stream" 		// this default mime also triggers iframe downloads
	var m = strMimeType || u;
	var x = data;
	var D = document;
	var a = D.createElement("a");
	var z = function(a){return String(a);};
	var B = (self.Blob || self.MozBlob || self.WebKitBlob || z);
	var B=B.call ? B.bind(self) : Blob;
	var fn = strFileName || "download";
	var blob;
	var fr;

	blob = x instanceof B ? x : new B([x], {type: m}) ;

	function d2b(u) {
		var p= u.split(/[:;,]/),
		t= p[1],
		dec= p[2] == "base64" ? atob : decodeURIComponent,
		bin= dec(p.pop()),
		mx= bin.length,
		i= 0,
		uia= new Uint8Array(mx);
		for(i;i<mx;++i) { uia[i]=bin.charCodeAt(i); }
		return new B([uia], {type: t});
	 }

	function saver(url, winMode){

		if ('download' in a) { //html5 A[download]
			a.href = url;
			a.setAttribute("download", fn);
			a.innerHTML = "downloading...";
			D.body.appendChild(a);
			setTimeout(function() {
				a.click();
				D.body.removeChild(a);
				if(winMode===true){setTimeout(function(){ self.URL.revokeObjectURL(a.href);}, 250 );}
			}, 66);
			return true;
		}

		if(typeof safari !=="undefined" ){ // handle non-a[download] safari as best we can:
			url="data:"+url.replace(/^data:([\w\/\-\+]+)/, u);
			if(!window.open(url)){ // popup blocked, offer direct download:
				if(confirm("Displaying New Document\n\nUse Save As... to download, then click back to return to this page.")){ location.href=url; }
			}
			return true;
		}

		//do iframe dataURL download (old ch+FF):
		var f = D.createElement("iframe");
		D.body.appendChild(f);

		if(!winMode){ // force a mime that will download:
			url="data:"+url.replace(/^data:([\w\/\-\+]+)/, u);
		}
		f.src=url;
		setTimeout(function(){ D.body.removeChild(f); }, 333);

	}//end saver

	if (navigator.msSaveBlob) { // IE10+ : (has Blob, but not a[download] or URL)
		return navigator.msSaveBlob(blob, fn);
	}

	if(self.URL){ // simple fast and modern way using Blob and URL:
		saver(self.URL.createObjectURL(blob), true);
	}else{
		// handle non-Blob()+non-URL browsers:
		if(typeof blob === "string" || blob.constructor===z ){
			try{
				return saver( "data:" +  m   + ";base64,"  +  self.btoa(blob)  );
			}catch(y){
				return saver( "data:" +  m   + "," + encodeURIComponent(blob)  );
			}
		}

		// Blob but not URL:
		fr=new FileReader();
		fr.onload=function(e){
			saver(this.result);
		};
		fr.readAsDataURL(blob);
	}
	return true;
} // _download

FabMoDashboard.prototype._call = function(name, data, callback) {

	if(this.isPresent()) {
		message = {"call":name, "data":data}
		if(callback) {
			message.id = this._id++;
			this._handlers[message.id] = callback;
		}
		this.target.postMessage(message, '*');
	} else {
		this._simulateCall(name, data, callback);
	}
}

FabMoDashboard.prototype._simulateCall = function(name, data, callback) {
    toaster();
    var toast = document.getElementById('alert-toaster');
    var text = document.getElementById('alert-text');
	switch(name) {

		case "submitJob":
			var files = [];
			data.jobs.forEach(function(job) {
				var name = job.filename || job.file.name;
				this._download(job.file, name, "text/plain");
				files.push(name);
			}.bind(this));

			// Data.length
			if(data.jobs.length === 1) {
				var msg = "Job Submitted: " + data.jobs[0].filename
			} else {
				var msg = data.jobs.length + " Jobs Submitted: " + files.join(',');
			}
			text.textContent = msg;
			showToaster(toast);
			callback(null, {})
		break;

		case "runGCode":
			text.textContent = "GCode sent to tool: " + data;
		    showToaster(toast);
		break;

		case "runSBP":
			text.textContent = "OpenSBP sent to tool: " + data;
			showToaster(toast);
		break;

		default:
			text.textContent = name + " called.";
			showToaster(toast);
		break;
	}
}

FabMoDashboard.prototype._on = function(name, callback) {

	var message = {"on":name}
	if(callback) {
		this._event_listeners[name].push(callback);
	}
	this.target.postMessage(message, '*');
}

/**
 * Bind a callback to the specified event.
 *
 * @method on
 * @param {String} name Event name
 * @param {function} callback Event handler
 */
FabMoDashboard.prototype.on = function(name, callback) {
	this._on(name, callback);
}

FabMoDashboard.prototype.off = function(name, callback) {
	var listeners = this._event_listeners[name] || [];
	if(!callback) {
		this._event_listeners[name] = [];
	} else {
 		var idx = listeners.indexOf(5);
		if (idx > -1) {
    		this._event_listeners[name].splice(index, 1);
		}
	}
}

FabMoDashboard.prototype._setupMessageListener = function() {
	this.window.addEventListener('message', function (evt) {
		var message = evt.data;
		switch(message.type) {
			case 'cb':
				if('id' in message) {
		 			if(message.id in this._handlers) {
		 				cb = this._handlers[message.id]
		 				if(message.status === "success") {
		 					cb(null, message.data);
		 				} else {
		 					cb(message.message, null);
		 				}
		 			}
		 		}
		 		break;

			case 'evt':
				if('id' in message) {
					if(message.id in this._event_listeners) {
						listeners = this._event_listeners[message.id]
						for(i in listeners) {
							listeners[i](message.data);
						}
					}
				}
				break;
			}
	}.bind(this));
}

/**
 * Indicate that the app is loaded and ready to go!
 * @method ready
 */
FabMoDashboard.prototype.ready = function() {
	this._call('ready');
	this.isReady = true;
}

/**
 * Set the message to display while an app is loading.  You can call this any time before
 * calling the `ready()` function, to indicate loading or setup progress.
 * @method setBusy
 * @param {String} The message to display.
 */
FabMoDashboard.prototype.setBusyMessage = function(message) {
	this._call('setBusyMessage', {'message' : message});
}

/**
 * If this app was invoked from another app, get the arguments (if any) that were passed on invocation.
 *
 * @method getAppArgs
 * @callback {Object} The arguments passed to this app, or undefined.
 */
FabMoDashboard.prototype.getAppArgs = function(callback) {
	this._call("getAppArgs", null, callback);
}

/**
 * Get the information for this app.
 *
 * @method getAppInfo
 * @param {function} callback
 * @param {Error} callback.err Error object if there was an error.
 * @param {Object} callback.info App information
 * @param {String} callback.info.name The name of the App
 */
FabMoDashboard.prototype.getAppInfo = function(callback) {
	this._call("getAppInfo", null, callback);
}

/**
 * Launch the specified app by app ID, with optional arguments.
 *
 * @method launchApp
 * @param {String} id The id of the app to launch.
 * @param {Object} args Arguments object to pass to the app.
 * @param {function} callback
 * @param {Error} callback.err Error object if there was an error
 * @param {Object} callback.app App info for the launched app if launch was successful
 */
FabMoDashboard.prototype.launchApp = function(id, args, callback) {
	this._call("launchApp", {'id': id, 'args':args}, callback);
}


//Modal Functions
FabMoDashboard.prototype.showModal = function(options, callback) {
	var callbacks = {
		"ok" : options.ok,
		"cancel" : options.cancel
	}
	var showModalCallback = function(err, buttonPressed) {
		if(err) {
			callback(err);
		}
		var f = callbacks[buttonPressed]();
		if(f) {
			f();
		} else {
			if(callback) {
				callback();
			}
		}
 	}
 	options.ok = options.ok ? true : false;
 	options.cancel = options.cancel ? true : false;

    this._call("openModal", options, showModalCallback);
}

FabMoDashboard.prototype.hideModal = function(options, callback) {
    this._call("closeModal", null, callback);
}

// Footer Functions
// FabMoDashboard.prototype.showFooter = function(callback) {
// 	this._call("showFooter", null, callback);
// }

/**
 * Show a notification on the dashboard.  Notifications typically show up as toaster message somewhere on the dashboard,
 * but the dashboard reserves the right to format or even suppress these messages as suits its needs.
 *
 * @method notify
 * @param {String} type Type of message, which can be one of `info`,`warn`,`error`, or `success`
 * @param {String} message The text to be displayed in the notification.
 * @param {function} callback Called once the message has been displayed
 * @param {Error} callback.err Error object if there was an error.
 */
FabMoDashboard.prototype.notify = function(type, message, callback) {
	this._call("notify", {'type':type, 'message':message}, callback);
}

FabMoDashboard.prototype.hideFooter = function(callback) {
	this._call("hideFooter", null, callback);
}

// Notification functions
FabMoDashboard.prototype.notification = function(type,message,callback) {
	this._call("notification", {'type':type,'message':message}, callback);
}
FabMoDashboard.prototype.notify = FabMoDashboard.prototype.notification;

function _makeFile(obj) {
	if(window.jQuery && obj instanceof jQuery) {
		if(obj.is('input:file')) {
			obj = obj[0];
		} else {
			obj = obj.find('input:file')[0];
		}
		file = obj.files[0];
	} else if(obj instanceof HTMLInputElement) {
		file = obj.files[0];
	} else if(obj instanceof File || obj instanceof Blob) {
		file = obj;
	} else if(typeof obj === "string") {
		file = new Blob([obj], {'type' : 'text/plain'});
	} else {
		throw new Error('Cannot make File object out of ' + obj);
	}
	return file;
}

function _makeApp(obj) {
	return {file : _makeFile(obj)};
}

function _makeJob(obj) {
	var file = null;

	try {
		file = _makeFile(obj);
	} catch(e) {}

	if(file) {
		return {file : file};
	} else {
		var job = {};
		for (var key in obj) {
  			if (obj.hasOwnProperty(key)) {
  				if(key === 'file') {
  					job['file'] = _makeFile(obj.file);
  				} else {
  					job[key] = obj[key];
  				}
  			}
		}
		return job;
	}
}

/**
 * Submit one or more jobs to the dashboard.
 * @param {Array|Object|jQuery} jobs A single job object, an array containing multiple job objects, or a jQuery object that points to a file type form input, or a form containing a file type input.
 * @param {Object} [options] Options for job submission. Currently only accepts one option: `stayHere` which if true, will prevent the dashboard from jumping to the job manager when the job has been submitted.
 *
 */
FabMoDashboard.prototype.submitJob = function(jobs, options, callback) {
	var args = {jobs : []};

	if(window.jQuery && jobs instanceof jQuery) {
		if(jobs.is('input:file')) {
			jobs = obj[0];
		} else {
			jobs = jobs.find('input:file')[0];
		}
		var files = jobs.files;
		if(files.length) {
			jobs = [];
			for(var i=0; i<files.length; i++) {
				jobs.push(files[i]);
			}
		}
	} else {
		if(!jobs.length) {
			jobs = [jobs];
		}
	}

	for(var i=0; i<jobs.length; i++) {
		args.jobs.push(_makeJob(jobs[i]));
	}

	if(typeof options === 'function') {
		callback = options;
		options = {};
	}

	args.options = options || {};
	this._call("submitJob", args, callback)
}
FabMoDashboard.prototype.submitJobs = FabMoDashboard.prototype.submitJob;

FabMoDashboard.prototype.updateOrder = function(data, callback) {
	this._call("updateOrder", data, callback);
}

/**
 * Resubmit a job by its ID.  Resubmitted jobs come in at the back of the job queue.
 *
 * @method resubmitJob
 * @param {Number} id The ID of the job to resubmit
 * @param {Object} options Job submission options
 * @param {Object} options Job submission options
 * @param {function} callback
 * @param {Error} callback.err Error object if there was an error.
 */
FabMoDashboard.prototype.resubmitJob = function(id, options, callback) {
  if(typeof options === 'function') {
    callback = options;
    options = {};
  }
  var args = {
    id : id,
    options : options || {}
  }
	this._call("resubmitJob", args, callback)
}

/**
 * Delete a job (cancels if running, sends to trash otherwise.)
 *
 * @method deleteJob
 * @param {Number} id The ID of the job to delete
 * @param {function} callback
 * @param {Error} callback.err Error object if there was an error.
 */
FabMoDashboard.prototype.deleteJob = function(id, callback) {
	this._call("deleteJob", id, callback)
}

FabMoDashboard.prototype.cancelJob = FabMoDashboard.prototype.cancelJob;

/**
 * Get information about a job.  This works for jobs that are pending, currently running, or in the history.
 *
 * @method getJobInfo
 * @param {Number} id The ID of the job to cancel
 * @param {function} callback
 * @param {Error} callback.err Error object if there was an error.
 * @param {Object} callback.job Information about the requested job.
 * @param {String} callback.job.name Job name
 * @param {String} callback.job.description Job description
 * @param {Number} callback.job.created_at Job creation time (UTC datetime)
 * @param {Number} callback.job.started_at Job start time (UTC datetime)
 * @param {Number} callback.job.finished_at Job completion time (UTC datetime)
 * @param {String} callback.job.state Current state of the job.  One of `pending`,`running`,`finished`,`cancelled` or `failed`
 */
FabMoDashboard.prototype.getJobInfo = function(id, callback) {
	this._call("getJobInfo", id, callback)
}

/**
 * Get a list of jobs that are currently pending and running.
 *
 * @method getJobsInQueue
 * @param {function} callback
 * @param {Error} callback.err Error object if there was an error.
 * @param {Object} callback.jobs Object containing both the pending and running jobs
 * @param {Array} callback.jobs.pending List of pending jobs.  May be empty.
 * @param {Array} callback.jobs.running List of running jobs.  May be empty.
 */
FabMoDashboard.prototype.getJobsInQueue = function(callback) {
	this._call("getJobsInQueue",null, callback);
}

/**
 * Remove all pending jobs from the queue.
 *
 * @method clearJobQueue
 * @param {function} callback
 * @param {Error} callback.err Error object if there was an error.
 */
FabMoDashboard.prototype.clearJobQueue = function(callback) {
	this._call("clearJobQueue",null, callback);
}

/**
 * Get a list of jobs in the history.
 *
 * @method getJobHistory
 * @param {Object} options
 * @param {Number} options.start The location in the results to start
 * @param {Number} options.count The number of jobs to return
 * @param {function} callback
 * @param {Error} callback.err Error object if there was an error.
 * @param {Object[]} callback.jobs Array of jobs in the history
 */
FabMoDashboard.prototype.getJobHistory = function(options, callback) {
	this._call("getJobHistory",options, callback);
}

/**
 * Run the next job in the job queue.
 *
 * @method runNext
 * @param {Object} options
 * @param {function} callback
 * @param {Error} callback.err Error object if there was an error.
 */
FabMoDashboard.prototype.runNext = function(callback) {
	this._call("runNext",null, callback);
}

/**
 * Pause the execution of the current job or operation.  Operation can be resumed.
 *
 * @method pause
 * @param {Object} options
 * @param {function} callback
 * @param {Error} callback.err Error object if there was an error.
 */
FabMoDashboard.prototype.pause = function(callback) {
	this._call("pause",null, callback);
}

/**
 * Stop execution of the current job or operation.  Operation cannot be resumed.
 *
 * @method stop
 * @param {Object} options
 * @param {function} callback
 * @param {Error} callback.err Error object if there was an error.
 */
FabMoDashboard.prototype.stop = function(callback) {
	this._call("stop",null, callback);
}

/**
 * Resume the current operation of the system is paused.
 *
 * @method resume
 * @param {Object} options
 * @param {function} callback
 * @param {Error} callback.err Error object if there was an error.
 */
FabMoDashboard.prototype.resume = function(callback) {
	this._call("resume",null, callback);
}

/**
 * Perform a fixed manual move in a single axis.  (Sometimes called a nudge)
 *
 * @method manualMoveFixed
 * @param {String} axis One of `x`,`y`,`z`,`a`,`b`,`c`
 * @param {Number} speed Speed in current tool units
 * @param {distance} distance The distance to move in current units
 * @param {function} callback
 * @param {Error} callback.err Error object if there was an error.
 */
FabMoDashboard.prototype.manualMoveFixed = function(axis, speed, distance, callback) {
	this._call("manualMoveFixed",{"axis":axis, "speed": speed, "dist":distance}, callback);
}

/**
 * Stream a raw gcode
 * Tool must be in 'raw' manual mode for this to work.
 */
FabMoDashboard.prototype.manualRunGCode = function(code, callback) {
	this._call("manualRunGCode",{"code": code}, callback);
}

/**
 * Start performing a manual move of the specified axis at the specified speed.
 *
 * @method manualStart
 * @param {Number} axis One of `x`,`y`,`z`,`a`,`b`,`c`
 * @param {Number} speed Speed in current tool units.  Negative to move in the negative direction.
 */
FabMoDashboard.prototype.manualStart = function(axis, speed, second_axis, second_speed) {
	this._call("manualStart",{"axis":axis, "speed":speed, "second_axis":second_axis, "second_speed":second_speed }, callback);
}


FabMoDashboard.prototype.manualEnter = function(options, callback) {
	this._call("manualEnter",options, callback);
}

FabMoDashboard.prototype.manualExit = function(axis, speed, callback) {
	this._call("manualExit", callback);
}

/**
 * Send a "heartbeat" to the system, authorizing continued manual movement.  Manual moves must be continually
 * refreshed with this heartbeat function, or the tool will stop moving.
 *
 * @method manualHeartbeat
 */
FabMoDashboard.prototype.manualHeartbeat = function() {
	this._call("manualHeartbeat",{}, callback);
}

/**
 * Stop the tool immediately.
 *
 * @method manualStop
 */
FabMoDashboard.prototype.manualStop = function() {
	this._call("manualStop",{}, callback);
}

/**
 * Get the list of all the installed apps.
 * @method getApps
 * @param {function} callback
 * @param {Error} callback.err Error object if there was an error.
 * @param {Object} callback.apps List of app objects representing all installed apps.
 */
FabMoDashboard.prototype.getApps = function(callback) {
	this._call("getApps",null,callback);
}


FabMoDashboard.prototype.submitApp = function(apps, options, callback) {
	var args = {apps : []};

	if(window.jQuery && apps instanceof jQuery) {
		if(apps.is('input:file')) {
			apps = apps[0];
		} else {
			apps = apps.find('input:file')[0];
		}
		var files = apps.files;
		if(files.length) {
			apps = [];
			for(var i=0; i<files.length; i++) {
				apps.push(files[i]);
			}
		}
	} else {
		if(!apps.length) {
			apps = [apps];
		}
	}

	for(var i=0; i<apps.length; i++) {
		args.apps.push(_makeApp(apps[i]));
	}

	if(typeof options === 'function') {
		callback = options;
		options = {};
	}

	args.options = options || {};
	this._call("submitApp", args, callback)
}
FabMoDashboard.prototype.getUpdaterConfig = function(callback) {
	this._call("getUpdaterConfig", null, callback);
}

FabMoDashboard.prototype.setUpdaterConfig = function(data, callback) {
	this._call("setUpdaterConfig", data, callback);
}

FabMoDashboard.prototype.getInfo = function(callback) {
	this._call("getInfo", null, callback);
}

FabMoDashboard.prototype.getConfig = function(callback) {
	this._call("getConfig", null, callback);
}

FabMoDashboard.prototype.setConfig = function(data, callback) {
	this._call("setConfig", data, callback);
}

FabMoDashboard.prototype.deleteApp = function(id, callback) {
	this._call("deleteApp",id,callback);
}

FabMoDashboard.prototype.runGCode = function(text, callback) {
	this._call("runGCode", text, callback);
}

FabMoDashboard.prototype.runSBP = function(text, callback) {
	this._call("runSBP", text, callback);
}

FabMoDashboard.prototype.connectToWifi = function(ssid, key, callback) {
	this._call("connectToWifi", {'ssid':ssid, 'key':key}, callback);
}

FabMoDashboard.prototype.disconnectFromWifi = function(callback) {
	this._call("disconnectFromWifi", null, callback);
}

FabMoDashboard.prototype.forgetWifi = function(ssid, key, callback) {
	this._call("forgetWifi", {'ssid':ssid}, callback);
}

FabMoDashboard.prototype.enableWifi = function(callback) {
	this._call("enableWifi", null, callback);
}

FabMoDashboard.prototype.disableWifi = function(callback) {
	this._call("disableWifi", null, callback);
}

FabMoDashboard.prototype.enableWifiHotspot = function(callback) {
	this._call("enableWifiHotspot", null, callback);
}

FabMoDashboard.prototype.disableWifiHotspot = function(callback) {
	this._call("disableWifiHotspot", null, callback);
}

FabMoDashboard.prototype.getWifiNetworks = function(callback) {
	this._call("getWifiNetworks", null, callback);
}

FabMoDashboard.prototype.getWifiNetworkHistory = function(callback) {
	this._call("getWifiNetworkHistory", null, callback);
}

FabMoDashboard.prototype.getNetworkIdentity = function(callback) {
	this._call("getNetworkIdentity", null, callback);
}

FabMoDashboard.prototype.setNetworkIdentity = function(identity, callback) {
	this._call("setNetworkIdentity", identity, callback);
}

FabMoDashboard.prototype.isOnline = function(callback) {
	this._call("isOnline", null, callback);
}

/**
 * Get a list of all the macros installed on the tool.
 *
 * @method getMacros
 * @param callback
 * @param {Error} callback.err Error object if there was an error.
 * @param {Object} callback.macros List of macro objects currently installed.
 */
FabMoDashboard.prototype.getMacros = function(callback) {
	this._call("getMacros", null, callback);
}

/**
 * Run the specified macro immediately.  Macro does not appear in the job history.
 *
 * @method runMacro
 * @param {Number} id The id of the macro to run.
 * @param callback
 * @param {Error} callback.err Error object if there was an error.
 */
FabMoDashboard.prototype.runMacro = function(id, callback) {
	this._call("runMacro", id, callback);
}

FabMoDashboard.prototype.updateMacro = function(id, macro, callback) {
	this._call("updateMacro", {'id':id, 'macro':macro}, callback);
}

/**
 * Request a status report from the system.  The status object is returned in the callback to this function, as well as posted
 * with the status event.  To recieve updates to system status as it changes, you should bind a handler to the status event,
 * and _not_ poll using `requestStatus`.
 *
 * @method requestStatus
 * @param {function} callback
 * @param {Object} callback.status The status report object
 * @param {String} callback.status.state The system state, one of `idle`,`running`,`paused`,`stopped`,`manual` or `dead`
 * @param {Number} callback.status.posx The current x-axis position
 * @param {Number} callback.status.posy The current y-axis position
 * @param {Number} callback.status.posz The current z-axis position
 * @param {Number} callback.status.posa The current a-axis position
 * @param {Number} callback.status.posb The current b-axis position
 * @param {Number} callback.status.posc The current c-axis position
 * @param {Number} callback.status.in1 The current state of input 1 (`0` or `1`)
 * @param {Number} callback.status.in1 The current state of input 2 (`0` or `1`)
 * @param {Number} callback.status.in1 The current state of input 3 (`0` or `1`)
 * @param {Number} callback.status.in1 The current state of input 4 (`0` or `1`)
 * @param {Number} callback.status.in1 The current state of input 5 (`0` or `1`)
 * @param {Number} callback.status.in1 The current state of input 6 (`0` or `1`)
 * @param {Number} callback.status.in1 The current state of input 7 (`0` or `1`)
 * @param {Number} callback.status.in1 The current state of input 8 (`0` or `1`)
 * @param {String} callback.status.unit The current tool units (either `in` or `mm`)
 * @param {Number} callback.status.line The line number in the currently running file (if a file is running)
 * @param {Number} callback.status.nb_lines The total number of lines in the currently running file (if a file is running)
 * @param {boolean} callback.status.auth True if the tool is currently authorized for movement
 * @param {Object} callback.status.current_file Object describing the currently running file (or null if not running a file)
 * @param {Object} callback.status.job Object describing the currently running job (or null if not running a job)
 */
FabMoDashboard.prototype.requestStatus = function(callback) {
	this._call("requestStatus", null, callback);
}

/**
 * Start a connection to the video streaming service on your fabmo device.
 * A video_frame event will be triggered each time a new frame is send to the browser.
 *
 * @method startVideoStreaming
 * @param {function} callback
 * @param {Object} callback.err Error object if there was an error.
 */
FabMoDashboard.prototype.startVideoStreaming = function(callback) {
	this._call("startVideoStreaming", null, callback);
}


/**
 * Add a listener to the video frame event.
 * This will return an Image object, ready to be displayed on a canvas
 * @method startVideoStreaming
 * @param {function} callback
 * @param {Object} callback.err Error object if there was an error.
 */
FabMoDashboard.prototype.onVideoFrame = function (callback) {
  this.on('video_frame',function(data){
    imageObj = new Image();
    imageObj.src = "data:image/jpeg;base64,"+data;
    imageObj.onload = function(){
      callback(imageObj);
    }
  })
};

FabMoDashboard.prototype.deleteMacro = function(id, callback) {
	this._call("deleteMacro", id, callback);
}

/**
 * Get the configuration object for the currently running app.  The configuration object is a JSON object
 * of no specific description that is saved with each app.  It can be used to store app-specific configuration data.
 *
 * @method getAppConfig
 * @param {function} callback
 * @param {Error} callback.err Error object if there was an error.
 * @param {Object} callback.config Configuration object or {} if no configuration has been saved in the app.
 */
FabMoDashboard.prototype.getAppConfig = function(callback) {
	this._call("getAppConfig", null, callback);
}

/**
 * Set the app configuration to the provided option.
 *
 * @method setAppConfig
 * @param {Object} config The configuration object to set.
 * @param {function} callback
 * @param {Error} callback.err Error object if there was an error.
 * @param {Object} callback.config Configuration object or {} if no configuration has been saved in the app.
 */
FabMoDashboard.prototype.setAppConfig = function(config, callback) {
	this._call("setAppConfig", config, callback);
}

/**
 * Get the current FabMo version
 *
 * @method getVersion
 * @param {fuction} callback
 * @param {Error} callback.err Error object if there was an error.
 * @param {Object} callback.version Object describing the fabmo software version.
 * @param {String} callback.version.hash The git hash of the currently running FabMo software
 * @param {String} callback.version.number The user-friendly release version number (or empty string if not a released version
 * @param {boolean} callback.version.debug True if FabMo is running in "debug mode"
 * @param {String} callback.version.type The type of FabMo software build.  `dev` for development or `release` for released build.
 */
FabMoDashboard.prototype.getVersion = function(callback) {
	this._call("getVersion", null, callback);
}

/**
 * Control top level navigation for the dashboard.  Usually this is used to open another browser/tab window with a link from within an app,
 * or more rarely, to navigate away from the dashboard.
 * @method navigate
 * @param {String} url The URL to open
 * @param {Object} options Options for top-level navigation.
 * @param {String} options.target The link target (same as the target argument of `window.open`)
 */
FabMoDashboard.prototype.navigate = function(url, options, callback) {
	var loc = window.location.href;
	this._call("navigate", {'path' : loc.substr(0, loc.lastIndexOf('/')) + '/', 'url' : url, 'options' : options || {}}, callback);
}

FabMoDashboard.prototype.getCurrentUser = function(callback){
  this._call("getCurrentUser",null,callback);
}
FabMoDashboard.prototype.addUser = function(user_info,callback){
  this._call("addUser",user_info,callback);
}
FabMoDashboard.prototype.modifyUser = function(user,callback){
  this._call("modifyUser",user,callback);
}
FabMoDashboard.prototype.deleteUser = function(user,callback){
  this._call("deleteUser",user,callback);
}
FabMoDashboard.prototype.getUsers = function(callback){
  this._call("getUsers",null,callback);
}

FabMoDashboard.prototype.getUpdaterStatus = function(callback){
  this._call("getUpdaterStatus",null,callback);
}


var toaster = function () {
	var el = document.createElement('div');
    el.setAttribute('id', 'alert-toaster');
    el.style.cssText = 'position:fixed; visibility:hidden; margin: auto; top: 20px; right: 20px; width: 250px; height: 60px; background-color: #F3F3F3; border-radius: 3px; z-index: 1005; box-shadow: 4px 4px 7px -2px rgba(0,0,0,0.75);';
    el.innerHTML = "<span id='alert-text' style= 'position:absolute; margin: auto; top: 0; right: 0; bottom: 0; left: 0; height: 20px; width: 250px; text-align: center;'></span>";
	document.body.appendChild(el);
}
var showToaster = function (toaster) {
    toaster.style.visibility = 'visible';
    setTimeout(function(){document.body.removeChild(toaster)}, 1000);
}
return FabMoDashboard;

}));
