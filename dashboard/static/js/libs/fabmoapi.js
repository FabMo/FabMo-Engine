var FabMoAPI = function(base_url) {
	url = base_url || '/';
	this.base_url = url.replace(/\/$/,'');
}

FabMoAPI.prototype._initializeWebsocket = function() {
	this.socket = io(this.base_url);
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

// Apps
FabMoAPI.prototype.getApps = function(callback) {
	this._get('/apps', callback, function(data) {
		callback(null, data.apps);
	});
}

// Macros
FabMoAPI.prototype.getMacros = function(callback) {
	this._get('/macros', callback, function(data) {
		callback(null, data.macros);
	});
}



FabMoAPI.prototype._url = function(path) { return this.base_url + '/' + path.replace(/^\//,''); }

FabMoAPI.prototype._get = function(url, errback, callback) {
	url = this._url(url);
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

