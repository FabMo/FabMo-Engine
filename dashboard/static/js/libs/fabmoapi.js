;(function (root, factory) {

  /* CommonJS */
  if (typeof module == 'object' && module.exports) module.exports = factory()

  /* AMD module */
  else if (typeof define == 'function' && define.amd) define(['socket.io'], factory)

  /* Browser global */
  else root.FabMoAPI = factory()
}(this, function (io) {
  "use strict"

console.log(io)
var FabMoAPI = function(base_url) {
	var url = base_url || '/';
	this.base_url = url.replace(/\/$/,'');
	this._initializeWebsocket();
	this.on('status', function(status) {
		console.log("Status message!")
		this.status = status;
	}.bind(this));
}

FabMoAPI.prototype._initializeWebsocket = function() {
	try {
		this.socket = io(this.base_url);
	} catch(e) {
		this.socket = null;
		console.error('connection to the engine via websocket failed : '+ e.message);		
	}

	if(this.socket) {
		this.socket.on('connect', function() {
			// Request a status once connected
			// Even though the server is really supposed to send one
			this.getStatus();
		});

		this.socket.on('message', function(message) {} );

		this.socket.on('disconnect', function() {
			// Maybe use a dashboard autorefresh thing here
		});
	}
}

FabMoAPI.prototype.on = function(message, func) {
	if(this.socket) {
		this.socket.on(message, func);
	}
}

// Configuration
FabMoAPI.prototype.getConfig = function(callback) {
	this._get('/config', callback, function(data) {
		callback(null, data.configuration);
	});
}

FabMoAPI.prototype.setConfig = function(cfg_data, callback) {
	this._post('/config', cfg_data, callback, function(data) {
		callback(null, data.configuration);
	});
}

// Status
FabMoAPI.prototype.getStatus = function(callback) {
	this._get('/status', callback, function(data) {
		callback(null, data.status);
	});
}

// Jobs
FabMoAPI.prototype.getJobHistory = function(callback) {
	this._get('/jobs/history', callback, function(data) {
		callback(null, data.jobs);
	});
}

FabMoAPI.prototype.getJobQueue = function(callback) {
	this._get('/jobs/queue', callback, function(data) {
		callback(null, data.jobs);
	});
}

FabMoAPI.prototype.getJob = function(id, callback) {
	this._get('/job/' + id, callback, function(data) {
		callback(null, data.job);
	});
}

FabMoAPI.prototype.resubmitJob = function(id, callback) {
	this._post('/job/' + id, {}, callback, function(data) {
		callback(null);
	});
}

// Direct commands
FabMoAPI.prototype.quit = function(callback) {
	this._post('/quit' + id, {}, callback, function(data) {
		callback(null);
	});
}

FabMoAPI.prototype.pause = function(callback) {
	this._post('/pause' + id, {}, callback, function(data) {
		callback(null);
	});
}

FabMoAPI.prototype.resume = function(callback) {
	this._post('/resume' + id, {}, callback, function(data) {
		callback(null);
	});
}

// Jobs
FabMoAPI.prototype.runNextJob = function(callback) {
	this._post('/queue/run' + id, {}, callback, function(data) {
		callback(null);
	});
}

FabMoAPI.prototype.getJobHistory = function(callback) {
	this._get('/jobs/history', callback, function(data) {
		callback(null, data.jobs);
	});
}

FabMoAPI.prototype.getJob = function(id, callback) {
	this._get('/job/' + id, callback, function(data) {
		callback(null, data.job);
	}); 
}

FabMoAPI.prototype.getJobs = function(callback) {
	this._get('/jobs', callback, function(data) {
		callback(null, data.jobs);
	});
}

FabMoAPI.prototype.cancelJob = function(id, callback) {
	this._del('/jobs/' + id, function(data) {
		callback(null, data.job);
	});
}

FabMoAPI.prototype.submitJob = function(obj, callback) {
	this._post('/job', makeFormData(obj), callback, function(data) {
		callback(null);
	});
}

FabMoAPI.prototype.clearJobQueue = function(id, callback) {
	this._del('/jobs/queue', function(data) {
		callback(null);
	});
}

// Apps
FabMoAPI.prototype.getApps = function(callback) {
	this._get('/apps', callback, function(data) {
		callback(null, data.apps);
	});
}

FabMoAPI.prototype.deleteApp = function(id, callback) {
	this._del('/apps/' + id, {}, callback, function(data) {
		callback(null);
	});
}

FabMoAPI.prototype.submitApp = function(app_file, callback) {
	this._post('/apps', makeFormData(app_file), callback, function(data) {
		callback(null);
	});
}

FabMoAPI.prototype.getAppConfig = function(app_id, callback) {
	this._get('/apps/' + id + '/config', callback, function(data) {
		callback(null, data.config);
	});
}

FabMoAPI.prototype.setAppConfig = function(cfg_data, callback) {
	this._post('/apps/' + id + '/config', cfg_data, callback, function(data) {
		callback(null, data.configuration);
	});
}

// Macros
FabMoAPI.prototype.getMacros = function(callback) {
	this._get('/macros', callback, function(data) {
		callback(null, data.macros);
	});
}

FabMoAPI.prototype.runMacro = function(id, callback) {
	this._post('/macros/' + id + '/run', {}, callback, function(data) {
		callback(null, data.macro);
	});
}

FabMoAPI.prototype.updateMacro = function(id, macro, callback) {
	this._get('/macros/' + id, macro, callback, function(data) {
		callback(null, data.macro);
	});
}

FabMoAPI.prototype.deleteMacro = function(id, callback) {
	this._del('/macros/' + id, {}, callback, function(data) {
		callback(null);
	});
}

FabMoAPI.prototype.runCode = function(runtime, code, callback) {
	var data = {'cmd' : data, 'runtime':runtime}
	this._post('/code', data, callback, function(data) {
		callback(null);
	});
}

FabMoAPI.prototype.gcode = function(code, callback) {
	this.runCode('gcode', code, callback);
}

FabMoAPI.prototype.sbp = function(code, callback) {
	this.runCode('sbp', code, callback);
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
		var filename = obj.config.filename || default_name;
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
	}
	return formData;
}

FabMoAPI.prototype._url = function(path) { return this.base_url + '/' + path.replace(/^\//,''); }

FabMoAPI.prototype._get = function(url, errback, callback) {
	var url = this._url(url);
	callback = callback || function() {}
	errback = errback || function() {}

	$.ajax({
		url: url,
		type: "GET",
		dataType : 'json', 
		success: function(result){
			console.log(result);
			if(result.status === "success") {
				callback(result.data);
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

FabMoAPI.prototype._post = function(url, data, errback, callback) {
	callback = callback || function() {};
	errback = errback || function() {};
	$.ajax({
		url: url,
		type: "POST",
		dataType : 'json',
		data : data, 
		success: function(result){
			if(data.status === "success") {
				callback(undefined,result.data);
			} else if(data.status==="fail") {
				errback(result.data);
			}	else {
				errback(result.data.message);
			}
		},
		error: function( data, err ){
			 errback(err);
		}
	});
}

FabMoAPI.prototype._del = function(url, data, errback, callback) {
	callback = callback || function() {};
	errback = errback || function() {};
	$.ajax({
		url: url,
		type: "DEL",
		dataType : 'json',
		data : data, 
		success: function(result){
			if(data.status === "success") {
				callback(undefined,result.data);
			} else if(data.status==="fail") {
				errback(result.data);
			}	else {
				errback(result.data.message);
			}
		},
		error: function( data, err ){
			 errback(err);
		}
	});
}

return FabMoAPI;
}));