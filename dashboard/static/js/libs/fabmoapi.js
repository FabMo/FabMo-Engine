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

var FabMoAPI = function(base_url) {
	this.events = {
		'status' : [],
		'disconnect' : [],
		'connect' : []
	};
	var url = window.location.origin;
	this.base_url = url.replace(/\/$/,'');

	this.status = {};
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
			this.getStatus();
		}.bind(this));

		this.socket.on('message', function(message) {console.info("Websocket message: " + JSON.stringify(message))} );

		this.socket.on('disconnect', function() {
			this.emit('disconnect');
			console.info("Websocket disconnected");
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
	this.status = status;
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
	this._get('/config', callback, callback, 'configuration');
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
	this._post('/quit', {}, callback, callback);
}

FabMoAPI.prototype.pause = function(callback) {
	this._post('/pause', {}, callback, callback);
}

FabMoAPI.prototype.resume = function(callback) {
	this._post('/resume', {}, callback, callback);
}

// Jobs
FabMoAPI.prototype.runNextJob = function(callback) {
	try {
		this._post('/jobs/queue/run', {}, callback, callback);
	} catch(e) {
		console.error(e);
	}
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

FabMoAPI.prototype.submitJob = function(obj, callback) {
	this._post('/job', makeFormData(obj, null, 'text/plain'), callback, callback);
}

FabMoAPI.prototype.clearJobQueue = function(id, callback) {
	this._del('/jobs/queue', callback, callback);
}

// Apps
FabMoAPI.prototype.getApps = function(callback) {
	this._get('/apps', callback, callback, 'apps');
}

FabMoAPI.prototype.deleteApp = function(id, callback) {
	this._del('/apps/' + id, {}, callback, callback);
}

FabMoAPI.prototype.submitApp = function(app_file, callback) {
	var formdata = makeFormData(app_file, null, 'application/zip')
	this._post('/apps', formdata, callback, callback);
}

FabMoAPI.prototype.getAppConfig = function(app_id, callback) {
	this._get('/apps/' + id + '/config', callback, callback, 'config');
}

FabMoAPI.prototype.setAppConfig = function(cfg_data, callback) {
	this._post('/apps/' + id + '/config', cfg_data, callback, callback, 'configuration');
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


function makeFormData(obj, default_name, default_type) {
	if (obj instanceof jQuery){ //if it's a form
		var file = (obj.find('input:file'))[0].files[0];
		// Create a new FormData object.
		var formData = new FormData();
		formData.append('file', file, file.name);
	}
	else if (obj instanceof FormData) {
		var formData = obj;
	} 
	else {
		var content = obj.data || '';
		var description = obj.config.description || 'No Description'
		var filename = obj.config.filename;
		var name = obj.config.name || filename
		var formData = new FormData();
		var type = default_type || null;
		if(!filename) {
			throw new Error('No filename specified');
		}
		if(!type) {
			throw new Error('No MIME type specified')
		}
		var file = new Blob([content], {'type' : type});
		formData.append('file', file, filename);
		formData.append('name', name || filename);
		formData.append('description', description);
	}
	return formData;
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

FabMoAPI.prototype._post = function(url, data, errback, callback, key) {
	var url = this._url(url);
	var callback = callback || function() {};
	var errback = errback || function() {};
	var processData = true;
	var contentType = true;

	if(data instanceof FormData) {
		processData = false;
		contentType = false;
	} else {
		contentType = 'application/x-www-form-urlencoded; charset=UTF-8'
		processData = true;
	}

	$.ajax({
		url: url,
		type: "POST",
		processData : processData,
		contentType : contentType,
		dataType : 'json',
		'data' : data, 
		success: function(result){
			if(data.status === "success") {
				if(key) {
					callback(null,result.data[key]);					
				} else {
					callback(null,result.data);										
				}
			} else if(data.status==="fail") {
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
