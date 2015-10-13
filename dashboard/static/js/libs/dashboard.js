
var FabMoDashboard = function() {
	this.target = window.parent;
	this.window = window;
	this._id = 0;
	this._handlers = {};
	this.status = {};
	this._event_listeners = {
		'status' : []
	};
	this._setupMessageListener();
}

FabMoDashboard.prototype.isPresent = function() {
    try {
        return window.self !== window.top;
    } catch (e) {
        return true;
    }
}

// https://github.com/rndme/download
// data can be a string, Blob, File, or dataURL
FabMoDashboard.prototype._download = function(data, strFileName, strMimeType) {
	
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
	switch(name) {
		case "submitJob":
			alert("Job Submitted: " + data.config.filename);
			this._download(data.data, data.config.filename, "text/plain");
		break;

		case "runGCode":
			alert("GCode sent to tool: " + data)
		break;

		case "runSBP":
			alert("OpenSBP sent to tool: " + data)
		break;

		case "showDRO":
			alert("DRO Shown.");
		break;

		case "hideDRO":
			alert("DRO Hidden.");
		break;
		
		default:
			alert(name + " called.");
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

FabMoDashboard.prototype.getAppArgs = function(callback) {
	this._call("getAppArgs", null, callback);
}

FabMoDashboard.prototype.launchApp = function(id, args, callback) {
	this._call("launchApp", {'id': id, 'args':args}, callback);
}

FabMoDashboard.prototype.on = function(name, callback) {
	this._on(name, callback);
}

FabMoDashboard.prototype.showDRO = function(callback) {
	this._call("showDRO", null, callback);
}

FabMoDashboard.prototype.hideDRO = function(callback) {
	this._call("hideDRO", null, callback);
}

FabMoDashboard.prototype.showFooter = function(callback) {
	this._call("showFooter", null, callback);
}

FabMoDashboard.prototype.hideFooter = function(callback) {
	this._call("hideFooter", null, callback);
}

FabMoDashboard.prototype.notification = function(type,message,callback) {
	this._call("notification", {'type':type,'message':message}, callback);
}

FabMoDashboard.prototype.submitJob = function(data, config, callback) {
	var message = {};

	// Pass a form to get a file that was browsed for
	if (data instanceof jQuery) {
		message.file = (data.find('input:file'))[0].files[0];
	}
	// Pass the FormData object if you're a real go-getter
	else if (data instanceof FormData) {
		message.file = data.file;
	} 
	// Just pass an object that contains the data
	else {
		message.data = data;
		message.config = {};
		message.config.filename = config.filename || 'job.nc';
		message.config.name = config.name || message.config.filename;
		message.config.description = config.description || 'No description'
	}
	this._call("submitJob", message, callback)
}

FabMoDashboard.prototype.resubmitJob = function(id, callback) {
	this._call("resubmitJob", id, callback)
}

FabMoDashboard.prototype.cancelJob = function(id, callback) {
	this._call("cancelJob", id, callback)
}

FabMoDashboard.prototype.getJobsInQueue = function(callback) {
	this._call("getJobsInQueue",null, callback);
}

FabMoDashboard.prototype.clearJobQueue = function(callback) {
	this._call("clearJobQueue",null, callback);
}

FabMoDashboard.prototype.getJobHistory = function(callback) {
	this._call("getJobHistory",null, callback);
}

FabMoDashboard.prototype.runNext = function(callback) {
	this._call("runNext",null, callback);
}

FabMoDashboard.prototype.pause = function(callback) {
	this._call("pause",null, callback);
}

FabMoDashboard.prototype.stop = function(callback) {
	this._call("stop",null, callback);
}

FabMoDashboard.prototype.resume = function(callback) {
	this._call("resume",null, callback);
}

FabMoDashboard.prototype.nudge = function(dir, distance, callback) {
	this._call("nudge",{"dir":dir, "dist":distance}, callback);
}

FabMoDashboard.prototype.getApps = function(callback) {
	this._call("getApps",null,callback);
}

FabMoDashboard.prototype.submitApp = function(data, config,  callback) {
	var message = {};

	// Pass a form to get a file that was browsed for
	if (data instanceof jQuery) {
		message.file = (data.find('input:file'))[0].files[0];
	}
	// Pass the FormData object if you're a real go-getter
	else if (data instanceof FormData) {
		message.file = data.file;
	} 
	// Just pass a plain old object that contains the data
	else {
		message.data = data;
		message.config = {};
	}
	this._call("submitApp", message, callback)
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

fabmoDashboard = new FabMoDashboard();
