;(function (root, factory) {

  /* CommonJS */
  if (typeof module == 'object' && module.exports) module.exports = factory()

  /* AMD module */
  else if (typeof define == 'function' && define.amd) define(['socket.io'], factory)

  /* Browser global */
  else root.FabMoAPI = factory()
}(this, function (io) {
  "use strict"

var PING_TIMEOUT = 1000;

var makePostData = function(obj, options) {
	console.log("making post data")
	var file = null;
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
		file = Blob(obj, {'type' : 'text/plain'});
	}

	if(!file) {
		var msg = 'Cannot make job from ' + JSON.stringify(obj);
		console.error(msg);
		throw new Error(msg);
	}
	
	var job = {}
	var options = options || {};
	for(var key in options) {
		job[key] = options[key];
	}
	job.file = file;
	console.log("POST DATA: ")
	console.log(job);
	return job;
}


var FabMoAPI = function(base_url) {
	this.events = {
		'status' : [],
		'disconnect' : [],
		'connect' : [],
		'job_start' : [],
		'job_end' : []
	};
	var url = window.location.origin;
	this.base_url = url.replace(/\/$/,'');

	this.status = {};
	this.config = {};
	this._initializeWebsocket();
}

FabMoAPI.prototype._initializeWebsocket = function() {
	localStorage.debug = false
	try {
		this.socket = io(this.base_url);
	} catch(e) {
		this.socket = null;
		console.error('connection to the engine via websocket failed : '+ e.message);		
	}

	if(this.socket) {
		this.socket.on('status', function(status) {
			this._setStatus(status);
			this.emit('status', status);
		}.bind(this));

		this.socket.on('connect', function() {
			console.info("Websocket connected");
			this.emit('connect');
			this.requestStatus();
		}.bind(this));

		this.socket.on('message', function(message) {console.info("Websocket message: " + JSON.stringify(message))} );

		this.socket.on('disconnect', function() {
			this.emit('disconnect');
			console.info("Websocket disconnected");
		}.bind(this));

		this.socket.on('connect_error', function() {
			this.emit('disconnect');
			console.info("Websocket disconnected (connection error)");
		}.bind(this));

	}
}

FabMoAPI.prototype.emit = function(evt, data) {
	var handlers = this.events[evt];
	if(handlers) {
		for(var i=0; i<handlers.length; i++) {
			handlers[i](data);
		}
	}
}

FabMoAPI.prototype.on = function(message, func) {
	if(message in this.events) {
		this.events[message].push(func);
	}
}

FabMoAPI.prototype._setStatus = function(status) {
	var old_status = this.status;
	this.status = status;
	if(old_status.job && !status.job) {
		this.emit('job_end', old_status.job);
	}
	if(!old_status.job && status.job) {
		this.emit('job_start', status.job);
	}

}

FabMoAPI.prototype.ping = function(callback) {
	if(this.socket) {
		var start = Date.now();

		var fail = setTimeout(function() {
			callback(new Error('Timeout waiting for ping response.'), null);
		}, PING_TIMEOUT);

		this.socket.once('pong', function() {
			clearTimeout(fail);
			callback(null, Date.now()-start);
		});
		this.socket.emit('ping');
	}
}

// Configuration
FabMoAPI.prototype.getConfig = function(callback) {
	var callback = callback || function() {};
	this._get('/config', callback, function(err, data) {
		this.config = data;
		callback(err, data);
	}.bind(this), 'configuration');
}

FabMoAPI.prototype.setConfig = function(cfg_data, callback) {
	this._post('/config', cfg_data, callback, function(data) {
		callback = callback || function() {};
		callback(null, data.configuration);
	});
}

// Status
FabMoAPI.prototype.getStatus = function(callback) {
	this._get('/status', callback, callback, 'status');
}

FabMoAPI.prototype.requestStatus = function() {
	this.socket.emit('status');
}

// Jobs
FabMoAPI.prototype.getJobHistory = function(callback) {
	this._get('/jobs/history', callback, callback, 'jobs');
}

FabMoAPI.prototype.getJobQueue = function(callback) {
	this._get('/jobs/queue', callback, callback, 'jobs');
}

FabMoAPI.prototype.getJob = function(id, callback) {
	this._get('/job/' + id, callback, callback, 'job');
}

FabMoAPI.prototype.getJobInfo = FabMoAPI.prototype.getJob;

FabMoAPI.prototype.resubmitJob = function(id, callback) {
	this._post('/job/' + id, {}, callback, callback);
}

// Direct commands
FabMoAPI.prototype.quit = function(callback) {
	this.command('quit');
}

FabMoAPI.prototype.pause = function(callback) {
	this.command('pause');
}

FabMoAPI.prototype.resume = function(callback) {
	this.command('resume');
}

// Jobs
FabMoAPI.prototype.runNextJob = function(callback) {
	this._post('/jobs/queue/run', {}, callback, callback);
}

FabMoAPI.prototype.getJobHistory = function(callback) {
	this._get('/jobs/history', callback, callback, 'jobs');
}

FabMoAPI.prototype.getJob = function(id, callback) {
	this._get('/job/' + id, callback, callback, 'job');
}

FabMoAPI.prototype.getJobs = function(callback) {
	this._get('/jobs', callback, callback, 'jobs');
}

FabMoAPI.prototype.cancelJob = function(id, callback) {
	this._del('/job/' + id, {}, callback, callback, 'job');
}


FabMoAPI.prototype.clearJobQueue = function(id, callback) {
	this._del('/jobs/queue', callback, callback);
}

FabMoAPI.prototype.getJobsInQueue = function(callback) {
	this._get('/jobs/queue', callback, callback, 'jobs');
}

// Apps
FabMoAPI.prototype.getApps = function(callback) {
	this._get('/apps', callback, callback, 'apps');
}

FabMoAPI.prototype.deleteApp = function(id, callback) {
	this._del('/apps/' + id, {}, callback, callback);
}

FabMoAPI.prototype.submitApp = function(app_file, callback) {
	var postData = makePostData(app_file);
	this._postUpload('/apps', postData, callback, callback);
}

FabMoAPI.prototype.getAppConfig = function(app_id, callback) {
	this._get('/apps/' + id + '/config', callback, callback, 'config');
}

FabMoAPI.prototype.setAppConfig = function(id, cfg_data, callback) {
	this._post('/apps/' + id + '/config', {'config': cfg_data}, callback, callback, 'config');
}

// Macros
FabMoAPI.prototype.getMacros = function(callback) {
	this._get('/macros', callback, callback, 'macros');
}

FabMoAPI.prototype.runMacro = function(id, callback) {
	this._post('/macros/' + id + '/run', {}, callback, callback, 'macro');
}

FabMoAPI.prototype.updateMacro = function(id, macro, callback) {
	this._post('/macros/' + id, macro, callback, callback, 'macro');
}

FabMoAPI.prototype.deleteMacro = function(id, callback) {
	this._del('/macros/' + id, {}, callback, callback);
}

FabMoAPI.prototype.runCode = function(runtime, code, callback) {
	var data = {'cmd' : code, 'runtime':runtime}
	this._post('/code', data, callback, callback);
}

FabMoAPI.prototype.gcode = function(code, callback) {
	this.runCode('gcode', code, callback);
}

FabMoAPI.prototype.sbp = function(code, callback) {
	this.runCode('sbp', code, callback);
}

FabMoAPI.prototype.executeRuntimeCode = function(runtime, code, callback) {
	this.socket.emit('code', {'rt' : runtime, 'data' : code})
}

FabMoAPI.prototype.manualStart = function(axis, speed) {
	this.executeRuntimeCode('manual', {'cmd': 'start', 'axis' : axis, 'speed' : speed});
}

FabMoAPI.prototype.manualHeartbeat = function() {
	this.executeRuntimeCode('manual', {'cmd': 'maint'});
}

FabMoAPI.prototype.manualStop = function() {
	this.executeRuntimeCode('manual', {'cmd': 'stop'});
}

FabMoAPI.prototype.manualMoveFixed = function(axis, speed, distance) {
	this.executeRuntimeCode('manual', {'cmd': 'fixed', 'axis' : axis, 'speed' : speed, 'dist' : distance});	
}

FabMoAPI.prototype.connectToWifi = function(ssid, key, callback) {
	var data = {'ssid' : ssid, 'key' : key};
	this._post('/network/wifi/connect', data, callback, callback);
}

FabMoAPI.prototype.disconnectFromWifi = function(callback) {
	this._post('/network/wifi/disconnect', {}, callback, callback);
}

FabMoAPI.prototype.forgetWifi = function(callback) {
	this._post('/network/wifi/forget', {}, callback, callback);
}

FabMoAPI.prototype.enableWifi = function(callback) {
	var data = {'enabled' : true};
	this._post('/network/wifi/state', data, callback, callback);
}

FabMoAPI.prototype.disableWifi = function(callback) {
	var data = {'enabled' : false};
	this._post('/network/wifi/state', data, callback, callback);
}

FabMoAPI.prototype.enableHotspot = function(callback) {
	var data = {'enabled' : true};
	this._post('/network/hotspot/state', data, callback, callback);
}

FabMoAPI.prototype.disableHotspot = function(callback) {
	var data = {'enabled' : false};
	this._post('/network/hotspot/state', data, callback, callback);
}

FabMoAPI.prototype.submitJob = function(job, options, callback) {
	this._postUpload('/job', job, {}, callback, callback);
}
FabMoAPI.prototype.submitJobs = FabMoAPI.prototype.submitJob;

FabMoAPI.prototype.command = function(name, args) {
	this.socket.emit('cmd', {'name':name, 'args':args||{} } );
}

FabMoAPI.prototype._url = function(path) { return this.base_url + '/' + path.replace(/^\//,''); }

FabMoAPI.prototype._get = function(url, errback, callback, key) {
	var url = this._url(url);
	var callback = callback || function() {}
	var errback = errback || function() {}

	$.ajax({
		url: url,
		type: "GET",
		dataType : 'json', 
		success: function(result){
			if(result.status === "success") {
				if(key) {
					callback(null, result.data[key]);					
				} else {
					callback(null, result.data);										
				}
			} else if(result.status==="fail") {
				errback(result.data);
			}	else {
				errback(result.message);
			}
		},
		error: function( data, err ){
			 errback(err);
		}
	});
}

FabMoAPI.prototype._postUpload = function(url, data, metadata, errback, callback, key) {
	//var url = this._url(url);
	var callback = callback || function() {};
	var errback = errback || function() {};

	// The POST Upload is done in two pieces.  First is a metadata post which transmits
	// an array of json objects that describe the files in question.
	// Following the metadata is a multipart request for each uploaded file.
	// So for N files, you have N+1 requests, the first for the metadata, and then N remaining for the files themselves.
	if(!Array.isArray(data)) {
		data = [data];
	}
	var meta = {
		files : [],
		meta : metadata
	}

	var files = [];
	data.forEach(function(item) {
		files.push(item.file);
		delete item.file;
		meta.files.push(item);
	});

	console.log(meta);
	var onMetaDataUploadComplete = function(err, k) {
		if(err) {
			return errback(err);
		}
		var requests = [];
		files.forEach(function(file, index) {
			var fd = new FormData();
			fd.append('key', k);
			fd.append('index', index);
			fd.append('file', file);
			var onFileUploadComplete = function(err, data) {
				if(err) {
					// Bail out here too - fail on any one file upload failure
					requests.forEach(function(req) {
						req.abort();
					});
					return errback(err);
				}
				if(data.status && data.status === 'complete') {
					console.log('Finished uploading');
					if(key) {
						callback(null, data.data[key]);						
					} else {
						callback(null, data.data);
					}
				}
			}.bind(this);
			var request = this._post(url, fd, onFileUploadComplete, onFileUploadComplete);
			requests.push(request);
		}.bind(this));
	}.bind(this);
	this._post(url, meta, onMetaDataUploadComplete, onMetaDataUploadComplete, 'key');
}

FabMoAPI.prototype._post = function(url, data, errback, callback, key) {
	var url = this._url(url);
	var callback = callback || function() {};
	var errback = errback || function() {};

	var xhr = new XMLHttpRequest();
	xhr.open('POST', url);

	if(!(data instanceof FormData)) {
		xhr.setRequestHeader('Content-Type', 'application/json');
		data = JSON.stringify(data);
	}

	xhr.onload = function() {
		switch(xhr.status) {
			case 200:
				var response = JSON.parse(xhr.responseText);
				switch(response.status) {
					case 'success':
						console.log(response)
						if(key) {
							callback(null, response.data[key]);
						} else {
							callback(null, response.data);
						}
						break;

					case 'fail':
						if(key) {
							errback(response.data[key]);
						} else {
							errback(response.data);
						}
						break;
					default:
						errback(response.message);
						break;
				}
			break;
			default:
				console.error("Got a bad response from server: " + xhr.status);
				break;
		}
    }
	xhr.send(data);
	return xhr;
}

FabMoAPI.prototype._del = function(url, data, errback, callback, key) {
	var url = this._url(url);
	var callback = callback || function() {};
	var errback = errback || function() {};
	$.ajax({
		url: url,
		type: "DELETE",
		dataType : 'json',
		'data' : data, 
		success: function(result){
			if(data.status === "success") {
				if(key) {
					callback(null, result.data.key);
				} else {
					callback(null,result.data);					
				}
			} else if(data.status==="fail") {
				errback(result.data);
			} else {
				errback(result.message);
			}
		},
		error: function( data, err ){
			 errback(err);
		}
	});
}

return FabMoAPI;
}));
