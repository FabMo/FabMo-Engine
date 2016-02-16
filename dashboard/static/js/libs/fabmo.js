(function (root, factory) {
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

var FabMoDashboard = function() {
	this.target = window.parent;
	this.window = window;
	this._id = 0;
	this._handlers = {};
	this.status = {};
	this._event_listeners = {
		'status' : [],
		'job_start' : [],
		'job_end' : [],
		'change' : []
	};
	this._setupMessageListener();
    // listen for escape key press to quit the engine
    $(document).on('keyup', function(e) {
        if(e.keyCode == 27) {
            console.log("ESC key pressed - quitting engine.");
            this.stop();
        }
    }.bind(this));
}

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
		//console.debug("Calling " + name + " with " + JSON.stringify(data));
		message = {"call":name, "data":data}
		if(callback) {
			message.id = this._id++;
			this._handlers[message.id] = callback;
		}
		this.target.postMessage(message, '*');
	} else {
		//console.debug("Simulating " + name + " with " + JSON.stringify(data));		
		this._simulateCall(name, data, callback);
	}
}

FabMoDashboard.prototype._simulateCall = function(name, data, callback) {
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
			toaster();
			$('.alert-text').text(msg);
			$('.alert-toaster').slideDown(null, function (){
				setTimeout(function(){$('.alert-toaster').remove(); }, 1000);
			})				

		break;

		case "runGCode":
			toaster();
			$('.alert-text').text("GCode sent to tool: " + data);
			$('.alert-toaster').slideDown(null, function (){
				setTimeout(function(){$('.alert-toaster').remove(); }, 1000);
			})
		break;

		case "runSBP":
			toaster();
			$('.alert-text').text("OpenSBP sent to tool: " + data)
			$('.alert-toaster').slideDown(null, function (){
				setTimeout(function(){$('.alert-toaster').remove(); }, 1000);
			})
		break;

		case "showDRO":
			toaster();
			$('.alert-text').text("DRO Shown.");
			$('.alert-toaster').slideDown(null, function (){
				setTimeout(function(){$('.alert-toaster').remove()}, 1000);
			})
		break;

		case "hideDRO":
			toaster();
			$('.alert-text').text("DRO Hidden.");
			$('.alert-toaster').slideDown(null, function (){
				setTimeout(function(){$('.alert-toaster').remove(); }, 1000);
			})
		break;
		
		default:
			toaster();
			$('.alert-text').text(name + " called.");
			$('.alert-toaster').slideDown(null, function (){
				setTimeout(function(){$('.alert-toaster').remove(); }, 1000);
			})
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

FabMoDashboard.prototype.on = function(name, callback) {
	this._on(name, callback);
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

// App Functions
FabMoDashboard.prototype.getAppArgs = function(callback) {
	this._call("getAppArgs", null, callback);
}

FabMoDashboard.prototype.getAppInfo = function(callback) {
	this._call("getAppInfo", null, callback);
}

FabMoDashboard.prototype.launchApp = function(id, args, callback) {
	this._call("launchApp", {'id': id, 'args':args}, callback);
}

// DRO Functions
FabMoDashboard.prototype.showDRO = function(callback) {
	this._call("showDRO", null, callback);
}

FabMoDashboard.prototype.hideDRO = function(callback) {
	this._call("hideDRO", null, callback);
}

// Footer Functions
FabMoDashboard.prototype.showFooter = function(callback) {
	this._call("showFooter", null, callback);
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
	if(obj instanceof jQuery) {
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
/*
 * Job Submission
 * @param jobs: array containing job objects
 * @param options: sumission options (applies to all jobs)
 * job object must have a 'file' member that's either a string or a file or a blob
 */
// Job and Queue Functions
FabMoDashboard.prototype.submitJob = function(jobs, options, callback) {
	var args = {jobs : []};

	if(jobs instanceof jQuery) {
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

FabMoDashboard.prototype.resubmitJob = function(id, callback) {
	this._call("resubmitJob", id, callback)
}

FabMoDashboard.prototype.cancelJob = function(id, callback) {
	this._call("cancelJob", id, callback)
}

FabMoDashboard.prototype.getJobInfo = function(id, callback) {
	this._call("getJobInfo", id, callback)
}

FabMoDashboard.prototype.getJobsInQueue = function(callback) {
	this._call("getJobsInQueue",null, callback);
}

FabMoDashboard.prototype.clearJobQueue = function(callback) {
	this._call("clearJobQueue",null, callback);
}

FabMoDashboard.prototype.getJobHistory = function(options, callback) {
	this._call("getJobHistory",options, callback);
}

FabMoDashboard.prototype.runNext = function(callback) {
	this._call("runNext",null, callback);
}

// Direct Control Functions
FabMoDashboard.prototype.pause = function(callback) {
	this._call("pause",null, callback);
}

FabMoDashboard.prototype.stop = function(callback) {
	this._call("stop",null, callback);
}

FabMoDashboard.prototype.resume = function(callback) {
	this._call("resume",null, callback);
}

// Manual Drive Functions
FabMoDashboard.prototype.manualMoveFixed = function(axis, speed, distance, callback) {
	this._call("manualMoveFixed",{"axis":axis, "speed": speed, "dist":distance}, callback);
}

FabMoDashboard.prototype.manualStart = function(axis, speed) {
	this._call("manualStart",{"axis":axis, "speed":speed}, callback);
}

FabMoDashboard.prototype.manualHeartbeat = function() {
	this._call("manualHeartbeat",{}, callback);
}

FabMoDashboard.prototype.manualStop = function() {
	this._call("manualStop",{}, callback);
}

FabMoDashboard.prototype.getApps = function(callback) {
	this._call("getApps",null,callback);
}

FabMoDashboard.prototype.submitApp = function(apps, options, callback) {
	var args = {apps : []};

	if(apps instanceof jQuery) {
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

FabMoDashboard.prototype.getMacros = function(callback) {
	this._call("getMacros", null, callback);
}

FabMoDashboard.prototype.runMacro = function(id, callback) {
	this._call("runMacro", id, callback);
}

FabMoDashboard.prototype.updateMacro = function(id, macro, callback) {
	this._call("updateMacro", {'id':id, 'macro':macro}, callback);
}

FabMoDashboard.prototype.requestStatus = function(callback) {
	this._call("requestStatus", null, callback);
}

FabMoDashboard.prototype.notify = function(type, message, callback) {
	this._call("notify", {'type':type, 'message':message}, callback);
}

FabMoDashboard.prototype.deleteMacro = function(id, callback) {
	this._call("deleteMacro", id, callback);
}

FabMoDashboard.prototype.getAppConfig = function(callback) {
	this._call("getAppConfig", null, callback);
}

FabMoDashboard.prototype.getVersion = function(callback) {
	this._call("getVersion", null, callback);
}

FabMoDashboard.prototype.navigate = function(url, options, callback) {
	this._call("navigate", {'url' : url, 'options' : options}, callback);
}

FabMoDashboard.prototype.setAppConfig = function(config, callback) {
	this._call("setAppConfig", config, callback);
}

var toaster = function () {
	$('body').append("<div class='alert-toaster' style='position:fixed; margin: auto; top: 20px; right: 20px; width: 250px; height: 60px; background-color: #F3F3F3; border-radius: 3px; z-index: 1005; box-shadow: 4px 4px 7px -2px rgba(0,0,0,0.75); display: none'><span class='alert-text' style= 'position:absolute; margin: auto; top: 0; right: 0; bottom: 0; left: 0; height: 20px; width: 250px; text-align: center;'></span><div>");
}

return FabMoDashboard;

}));
