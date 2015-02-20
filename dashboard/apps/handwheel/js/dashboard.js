var FabMoDashboard = function() {
	this.target = window.parent;
	this.window = window
	this._id = 0;
	this._handlers = {};
	this._event_listeners = {
		'status' : []
	};
	this._setupMessageListener();
}

FabMoDashboard.prototype._call = function(name, data, callback) {
	message = {"call":name, "data":data}
	if(callback) {
		message.id = this._id++;
		this._handlers[message.id] = callback;
	}
	this.target.postMessage(message, '*');
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
				//console.log("Dashboard client got an event: " + JSON.stringify(message));
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

FabMoDashboard.prototype.on = function(name, callback) {
	this._on(name, callback);
}

FabMoDashboard.prototype.showDRO = function(callback) {
	this._call("showDRO", null, callback);
}

FabMoDashboard.prototype.hideDRO = function(callback) {
	this._call("hideDRO", null, callback);
}

FabMoDashboard.prototype.submitJob = function(data, config,  callback) {
	var message = {};

	// Pass a form to get a file that was browsed for
	if (data instanceof jQuery) {
		console.log("jquery")
		message.file = (data.find('input:file'))[0].files[0];
	}
	// Pass the FormData object if you're a real go-getter
	else if (data instanceof FormData) {
		console.log("formdata")
		message.file = data.file;
	} 
	// Just pass a plain old object that contains the data
	else {
		console.log("regulartimes")
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

FabMoDashboard.prototype.getJobsInQueue = function(callback) {
	this._call("getJobsInQueue",null, callback);
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

FabMoDashboard.prototype.nudge = function(direction, distance, callback) {
	this._call("nudge",{'dir':direction, 'dist':distance}, callback);
}

fabmoDashboard = new FabMoDashboard();