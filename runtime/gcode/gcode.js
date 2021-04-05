var fs = require('fs');
var stream = require('stream');
var log = require('../../log').logger('gcode');
var config = require('../../config');
var countLineNumbers = require('../../util').countLineNumbers
var LineNumberer = require('../../util').LineNumberer


function GCodeRuntime() {
	this.machine = null;
	this.driver = null;
	this.ok_to_disconnect = true;
	this.completeCallback = null;
    this.inFeedHold = false;
    this._file_or_stream_in_progress = false;
}

GCodeRuntime.prototype.toString = function() {
	return "[GCodeRuntime]";
}
//Check if move requires auth
GCodeRuntime.prototype.needsAuth = function(s) {
	//all needs auth (check) so just return true
	return true;
}
GCodeRuntime.prototype.connect = function(machine) {
	this.machine = machine;
	this.driver = machine.driver;
	this.status_handler =  this._onDriverStatus.bind(this);
	this.status_report = {};
	this.driver.on('status',this.status_handler);
	log.info("Connected G-Code Runtime");
};

GCodeRuntime.prototype.disconnect = function() {
	if(this.ok_to_disconnect) {
		this.driver.removeListener('status', this.status_handler);
		log.info("Disconnected G-Code Runtime");
	} else {
		throw new Error("Cannot disconnect GCode Runtime")
	}
};

GCodeRuntime.prototype.pause = function() {
	this.driver.feedHold();
    this.inFeedHold = true;
}

GCodeRuntime.prototype.quit = function() {
	this.driver.quit();
}

GCodeRuntime.prototype.resume = function() {
	this.driver.resume();
    this.inFeedHold = false;
}

GCodeRuntime.prototype._changeState = function(newstate) {
	log.debug("Changing state to " + newstate)
	if(newstate != "idle") {
		this.ok_to_disconnect = false;
	}
	this.machine.setState(this, newstate);
};

GCodeRuntime.prototype._limit = function() {
	var er = this.driver.getLastException();
	if(er && er.st == 203) {
		var msg = er.msg.replace(/\[[^\[\]]*\]/,'');
		this.driver.clearLastException();
		this._fail(msg);
		return true;
	}
	return false;
}

GCodeRuntime.prototype._onDriverStatus = function(status) {
	// Update the machine copy of g2 status variables
	for (var key in this.machine.status) {
		if(key in status) {
			this.machine.status[key] = status[key];
		}
	}
	// Update the machine copy of g2 status variables
	for (key in status) {
		this.status_report[key] = status[key];
	}

	this.machine.emit('status',this.machine.status);
};


GCodeRuntime.prototype._die = function() {
	this.machine.status.current_file = null;
	this.machine.status.line=null;
	this.machine.status.nb_lines=null;
 	try {
 		this.machine.status.job.fail();
 	} catch(e) {}
 	finally {
		this.machine.status.job=null;
 		this.machine.setState(this, 'dead', {error : 'A G2 exception has occurred. You must reboot your tool.'});
 	}
}

GCodeRuntime.prototype._fail = function(message) {
	this.machine.status.current_file = null;
	this.machine.status.line=null;
	this.machine.status.nb_lines=null;
 	try {
 		this.machine.status.job.fail();
 	} catch(e) {}
 	finally {
		this.machine.status.job=null;
 		this.machine.setState(this, 'stopped', {error : message});
 	}
}

GCodeRuntime.prototype._idle = function() {
	this.machine.status.current_file = null;
	this.machine.status.line=null;
	this.machine.status.nb_lines=null;
	var job = this.machine.status.job;
	// Set the machine state to idle and return the units to their default configuration
	var finishUp = function() {
		this.driver.setUnits(config.machine.get('units'), function() {
			var callback = this.completeCallback || function() {};
			this.ok_to_disconnect = true;
			this.completeCallback = null;
			this.machine.setState(this, 'idle');
			callback();
		}.bind(this))
	}.bind(this);

	if(job) {
		if(job.pending_cancel) {
			this.machine.status.job.cancel(function(err, job) {
				this.machine.status.job=null;
				finishUp();
			}.bind(this));
		} else {
			this.machine.status.job.finish(function(err, job) {
				this.machine.status.job=null;
				finishUp();
			}.bind(this));
		}
	} else {
		finishUp();
	}
};

// Run the provided string
// callback runs only when execution is complete.
GCodeRuntime.prototype.runString = function(string, callback) {
	if(callback) { log.error("CALLBACK PASSED TO RUNSTRING")}

	if(this.machine.status.state === 'idle' || this.machine.status.state === 'armed') {
		// Add line numbers to Gcode string.
		var lines =  string.split('\n');
		this.machine.status.nb_lines = lines.length;
		for (i=0;i<lines.length;i++){
			if (lines[i][0]!==undefined && lines[i][0].toUpperCase() !== 'N' ){
				lines[i]= 'N'+ (i+1) + lines[i];
			}
		}
		// // Set absolute or incremental per config.
		// var mode = config.driver.get('gdi') ? 'G91': 'G90';
		// lines.unshift(mode);
		this.completeCallback = callback;
		this._changeState("running");
		var stringStream = new stream.Readable();
		// Push lines to stream.
		for(var i=0; i<lines.length; i++) {
			stringStream.push(lines[i] + "\n");
		}
		stringStream.push(null);
		return this.driver.runStream(stringStream)
		.on('stat', this._handleStateChange.bind(this))
		.then(this._handleStop.bind(this));
	}
};

GCodeRuntime.prototype._handleStop = function() {
	this._idle();
}

GCodeRuntime.prototype._handleStateChange = function(stat) {
	switch(stat) {
		case this.driver.STAT_HOLDING:
			this._changeState('paused');
			break;
		case this.driver.STAT_RUNNING:
			this._changeState('running');
			break;
        case this.driver.STAT_STOP:
            // This that the g2core is in stat:3, meaning it has processed all available gcode
            // so we need to tell it to move to stat:4 by sending an end of job "M30"
            // There may have been an M30 in the file but the g2core will have ignored it, this
            // may change someday in the future on the g2core end, so we may end up revisiting this.
            // OTOH, an extra M30 should not cause a problem.
            if (this._file_or_stream_in_progress) {
                this.driver.sendM30();
                this._file_or_stream_in_progress = false;
            }

		default:
			break;
	}
}

// Run a file given the filename
GCodeRuntime.prototype.runFile = function(filename, callback) {
    this._file_or_stream_in_progress = true;
	countLineNumbers(filename, function(err, lines) {
		this.machine.status.nb_lines = lines;
		var st = fs.createReadStream(filename);
		var ln = new LineNumberer();
		return this.driver.runStream(st.pipe(ln))
			.on('stat', this._handleStateChange.bind(this))
			.then(this._handleStop.bind(this));
	}.bind(this));
}

// Run the given string as gcode
GCodeRuntime.prototype.executeCode = function(string, callback) {
	this._file_or_stream_in_progress = true;
	return this.runString(string);
}

exports.GCodeRuntime = GCodeRuntime;