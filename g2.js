var SerialPort = require("serialport");
var fs = require("fs");
var events = require('events');
var async = require('async');
var util = require('util');
var Queue = require('./util').Queue;
var Watchdog = require('./util').Watchdog;
var log = require('./log').logger('g2');
var process = require('process');
var jsesc = require('jsesc');
var stream = require('stream');
var Q = require('q');
var LineNumberer = require('./util').LineNumberer

// Values of the **stat** field that is returned from G2 status reports
var STAT_INIT = 0;
var STAT_READY = 1;
var STAT_ALARM = 2;
var STAT_STOP = 3;
var STAT_END = 4;
var STAT_RUNNING = 5;
var STAT_HOLDING = 6;
var STAT_PROBE = 7;
var STAT_CYCLING = 8;
var STAT_HOMING = 9;
var STAT_INTERLOCK = 11;
var STAT_SHUTDOWN = 12;
var STAT_PANIC = 13;

// Should take no longer than CMD_TIMEOUT to do a get or a set operation
var CMD_TIMEOUT = 10000;
var EXPECT_TIMEOUT = 300000;

var _promiseCounter = 1;
var resumePending = false;
var THRESH = 1

var pat = /s*(G(28|38)\.\d|G2(0|1))/g

// Error codes defined by G2
// See https://github.com/synthetos/g2/blob/edge/TinyG2/tinyg2.h for the latest error codes and messages
try {
	var G2_ERRORS = JSON.parse(fs.readFileSync('./data/g2_errors.json','utf8'));
} catch(e) {
	var G2_ERRORS = {};
}

// A cycle context is created when you run a stream, and is a way to access driver events in the context of the current run
// It is a sort of token that you can recieve events from while the machining cycle is active, 
// and that will resolve like a promise when the machining cycle is done.
function CycleContext(driver, st, promise) {
		this.done = false;
		this._firmed = false;
		this._driver = driver;
		this._stream = st;
		this._paused = false;
		this._promise = promise.then(function(value) {
			this.firm(); // Firm the tool
			this.finish();
		}.bind(this));
		this.eventHandlers = {}; // eventname -> [listener]
		this.eventQueue = {}; // eventname -> {f : listener, data : data to pass to listener}
}

// A cycle context is "firmed" when it has turned over itself as a promise through the then() call, or when the
// run finishes, whichever comes first.
CycleContext.prototype.firm = function() {
		if(this.firmed) { return; }
		log.debug("Firming the cycle context.")
		try {
			for(var event in this.eventQueue) {
				var handlers = this.eventQueue[event];
				for(var i=0; i<handlers.length; i++) {
					handlers[i].f(handlers[i].data);
				}
			}
			this.firmed = true;
		} catch(e) {
			delete this.eventQueue;
			throw e;
		}
		delete this.eventQueue;
}

// Bind the listener to the provided event name.
// Events bound in this way are queued, so if any have occurred between the beginning of the run and when
// the binding occurs, they will be triggered when the cycle is firmed
CycleContext.prototype.on = function(event, f) {
	log.debug("Binding to the " + event + " event in the cycle context: " + f);
	if(event in this.eventHandlers) {
		this.eventHandlers[event].push(f);
	} else {
		this.eventHandlers[event] = [f];
	}
	return this;
}

// Return a promise that resolves when the cycle is complete (Q Promises)
CycleContext.prototype.then = function(f) {
	this.firm();
	return this._promise.then(function() {
		return f();
	});
}

// Sort of a do-nothing, for now
CycleContext.prototype.finish = function() {
	log.debug("Finishing up the cycle context.")
}

// Emit the provided data to all the listeners to the subscribed event
CycleContext.prototype.emit = function(event, data) {
		var handlers = this.eventHandlers[event];

		if(handlers) {
			for(var i=0; i<handlers.length; i++) {
				handlers[i](data);
			}
		}
}

// Pause the run by pausing the stream that is piping data into this context
CycleContext.prototype.pause = function() {
	this._paused = true;
	this._stream.pause();
}

// Resume the run by resuming the stream that is piping data into this context
CycleContext.prototype.resume = function() {
	this._paused = false;
	this._stream.resume();
}

// The G2 object represents the connection to the driver, which happens as serial over USB
function G2() {
	this._currentData = [];
	this._currentGCodeData = [];
	this.g2_status = {'stat':null, 'posx':0, 'posy':0, 'posz':0};
	this.status = {'stat':'idle', 'posx':0, 'posy':0, 'posz':0};
	this._seen_ready = false;
	this.gcode_queue = new Queue();
	this.command_queue = new Queue();

	this.pause_flag = false;
	this.connected = false;

	// Feedhold/flush
	this.quit_pending = false;
	this.stat = null;
	this.hold = null;

	// Readers and callbacks
	this.expectations = [];
	this.readers = {};

	// Members related to streaming
	this.qtotal = 0;
	this.flooded = false;
	this.send_rate = 1;
	this.lines_sent = 0;

	this.context = null;

	// Event emitter inheritance and behavior setup
	events.EventEmitter.call(this);
	this.setMaxListeners(50);
	this.lines_to_send = 4;
	this._ignored_responses = 0;
	this._primed = false;
	this._streamDone = false;

	this.lineBuffer = [];
}

util.inherits(G2, events.EventEmitter);

// Creates a cycle context, which has a pass-through stream into which data can be piped
G2.prototype._createCycleContext = function() {
	if(this.context) {
        throw new Error("Cannot create a new cycle context.  One already exists.");
	}
	// Create and setup the pass-through stream
	var st = new stream.PassThrough();
	st.setEncoding('utf8');
	this._streamDone = false;
	this.lineBuffer = []

	// TODO factor this out
	// Inject a couple of G-Codes which are needed for everyone to play nice
	st.write('G90\n')
	st.write('M100 ({out4:1})\n') // hack to get the "permissive relay" behavior while in-cycle
	
	// Handle data coming in on the stream
	st.on('data', function(chunk) {
		// Stream data comes in "chunks" which are often multiple lines
		chunk = chunk.toString();
		var newLines = false;
		// Repartition incoming "chunked" data as lines
		for(var i=0; i<chunk.length; i++) {
			ch = chunk[i];
			this.lineBuffer.push(ch);
			if(ch === '\n') {
				newLines = true;
				var s = this.lineBuffer.join('').trim();

				// Enqueue individual lines in the g-code queue
				this.gcode_queue.enqueue(s);

				// The G2 sender doesn't actually start sending until it is "primed"
				// Priming happens either when the number of lines to send reaches a certain threshold
				// or the prime() function is called manually.
				// TODO:  Factor out 10 (magic number) and put it at the top of the file so it can be changed easily.
				if(this.gcode_queue.getLength() >= 10) {
					this._primed = true;
				}
				this.lineBuffer = [];
			}
		}
		// If new lines were enqueued as a part of the re-chunkification process, send them.
		if(newLines) {
			this.sendMore();
		}
	}.bind(this));

	// Handle a stream finishing or disconnecting.
	st.on('end', function() {
		// Send whatever is left in the queue.  (There may be stuff unsent even after the stream is over)
		this._primed = true;
		this._streamDone = true;
		// TODO factor this out
		if(!this.quit_pending) {
			this.gcode_queue.enqueue('M100 ({out4:0})')
			this.gcode_queue.enqueue('M30');
		}
		this.sendMore();
		log.debug("Stream END event.")
	}.bind(this));

	// Handle a stream being piped into this context (currently do nothing)
	st.on('pipe', function() {
		log.debug("Stream PIPE event");
	})

	// Create the promise that resolves when the machining cycle ends.
	var promise = this._createStatePromise([STAT_END]).then(function() {
		this.context = null;
		this._primed = false;
		return this;
	}.bind(this))

	// Actually create and return the context built from these configured entities 
	var ctx  = new CycleContext(this, st, promise);

	// The G2 instance keeps track of its current (singleton) cycle context.
 	this.context = ctx;
}

// Actually open the serial port and configure G2 based on stored settings
G2.prototype.connect = function(path, callback) {

	// Store paths for safe keeping
	this._serialPath = path;

	// Open the serial port.  This used to be two ports, but now is only the one.
	log.info('Opening G2 port: ' + this._serialPath);
	this._serialPort = new SerialPort(this._serialPath, {flowcontrol: ['RTSCTS'], autoOpen:false});
	this._serialToken = 'S';

	// Handle errors
	this._serialPort.on('error', this.onSerialError.bind(this));
	this._serialPort.on('close', this.onSerialClose.bind(this));

	// The control port is the only one to truly handle incoming data
	this._serialPort.on('data', this.onData.bind(this));

	// Flush and get status once the "ready" message has been received from the controller.
	// G2 reports a "SYSTEM READY" message on connect that indicates that the system is prepared to
	// recieve g-codes and JSON commands.  We don't want to do anything until we get that.
	this.once('ready', function() {
		this.connected = true;
		this._write('\x04\n', function() {
			this.requestStatusReport(function() {
				callback(null, this);
			}.bind(this));
		}.bind(this));
	}.bind(this));

	// Actually perform the connect, and wait for the 'ready' event. 
	// We give 3 seconds for the ready event to materialize, which is plenty of time.  Typical
	// times to ready the system are on the order of tens or hundreds of milliseconds.
	this._serialPort.open(function(error) {
		if(error) {
			log.error("ERROR OPENING CONTROL PORT " + error );
			return callback(error);
		} else {
			log.info("G2 Port Opened.")
			setTimeout(function checkConnected() {
				if(!this.connected) {
					return callback(new Error('Never got the SYSTEM READY from g2.'));
				}
			}.bind(this), 3000);
		}
	}.bind(this));
};

// Close the serial port - important for shutting down the application and not letting resources "dangle"
G2.prototype.disconnect = function(callback) {
		this._serialPort.close(callback);
};

// Log serial errors.  Most of these are exit-able offenses, though.
G2.prototype.onSerialError = function(data) {
	log.error(new Error('There was a serial error'))
  log.error(data)
};

G2.prototype.onSerialClose = function(data) {
	this.connected= false;
	log.error('G2 Core serial link was lost.')
	process.exit(14);
};

G2.prototype._write = function(s, callback) {
	log.g2(this._serialToken,'out',s);
	this._serialPort.write(s, function () {
		if(callback) {
			this._serialPort.drain(callback);
		}
	}.bind(this));
}

G2.prototype.clearAlarm = function() {
	this.command({"clear":null});
};

G2.prototype.setUnits = function(units, callback) {
	this.command({gun:(units === 0 || units == 'in') ? 0 : 1});
	this.requestStatusReport(function(stat) { callback()});
}

G2.prototype.requestStatusReport = function(callback) {
	// Register the callback to be called when the next status report comes in
	typeof callback === 'function' && this.once('status', callback);
	this.command({'sr':null});
};

G2.prototype.requestQueueReport = function() { this.command({'qr':null}); };

G2.prototype.onWAT = function(data) {
	var s = data.toString('ascii');
	var len = s.length;
	for(var i=0; i<len; i++) {
		c = s[i];
		if(c === '\n') {
			string = this._currentGCodeData.join('');
			t = new Date().getTime();
			log.g2('D','in',string);
			//log.g2('<-G--' + t + '---- ' + string);
			this._currentGCodeData = [];
		} else {
			this._currentGCodeData.push(c);
		}
	}

};
// Called for every chunk of data returned from G2
G2.prototype.onData = function(data) {
	t = new Date().getTime();
	this.emit('raw_data',data);
	var s = data.toString('ascii');
	var len = s.length;
	for(var i=0; i<len; i++) {
		c = s[i];
		if(c === '\n') {
			var json_string = this._currentData.join('');
			t = new Date().getTime();
			log.g2('S','in',json_string);
			try {
				var obj = JSON.parse(json_string);
				this.onMessage(obj);
			}catch(e){
				throw e
				this.emit('error', [-1, 'JSON_PARSE_ERROR', "Could not parse response: '" + jsesc(json_string) + "' (" + e.toString() + ")"]);
			}
			this._currentData = [];
		} else {
			this._currentData.push(c);
		}
	}
};

G2.prototype.handleQueueReport = function(r) {
	var qo = r.qo || 0;
	// Pass
};

G2.prototype.handleFooter = function(response) {
	if(response.f) {
		if(response.f[1] !== 0) {
			var err_code = response.f[1];
			var err_msg = G2_ERRORS[err_code] || ['ERR_UNKNOWN', 'Unknown Error'];
			// TODO we'll have to go back and clean up alarms later
			// For now, let's not emit a bunch of errors into the log that don't mean anything to us
			this.emit('error', [err_code, err_msg[0], err_msg[1]]);
			return new Error(err_msg[1]);
		}
	}
};

G2.prototype.handleExceptionReport = function(response) {
	if(response.er) {
		this._lastExceptionReport = response.er;
		var stat = response.er.st;
		if((stat === 207) && this.quit_pending) {
		//	this.quit_pending = false;
			//this._write("{clr:n}\n");
			//this.command("M30");
		}
		log.error("Response with an exception report:")
		log.error(JSON.stringify(response))
	}
};

G2.prototype.getLastException = function() {
	return this._lastExceptionReport || null;
}

G2.prototype.clearLastException = function() {
	this._lastExceptionReport = null;
}

/*
0	machine is initializing
1	machine is ready for use
2	machine is in alarm state (shut down)
3	program stop or no more blocks (M0, M1, M60)
4	program end via M2, M30
5	motion is running
6	motion is holding
7	probe cycle active
8	machine is running (cycling)
9	machine is homing
*/
G2.prototype.handleStatusReport = function(response) {

	if(response.sr) {
		// Update our copy of the system status
		for (var key in response.sr) {
			value = response.sr[key];
			if(key === 'unit') {
				value = value === 0 ? 'in' : 'mm';
			}
			this.status[key] = value;
		}

		// Send more g-codes if warranted
		if('line' in response.sr) {
			line = response.sr.line;
			lines_left = this.lines_sent - line;
		}

		if('stat' in response.sr) {
			switch(response.sr.stat) {
				case STAT_STOP:
					if(this.flushcallback) {
						this.flushcallback(null);
						this.flushcallback = null;
					}
					break;
				case STAT_END:
					this.status.line = null;
					break;
				case STAT_PANIC:
					log.error('Panicked Response:')
					log.error(JSON.stringify(response))
					break
			}

			if(this.quit_pending) {
				switch(response.sr.stat) {
					case STAT_STOP:
					case STAT_HOLDING:
						log.info("Issuing the job kill command.")
						setTimeout(function() {
							this._write('\x04\n', function() {});
						}.bind(this), 50)
						break;
					case STAT_END:
						log.info("Clearing the quit pending state.")
						this.lines_to_send = 4
						this.quit_pending = false;
						this.pause_flag = false;
						break;
				}
			} else {
				switch(response.sr.stat) {
					case STAT_HOLDING:
						this.pause_flag = true;
						if(this.context) {
							this.context.pause()
						}
						break;
					default:
						this.pause_flag = false;
						if(this.context) {
							this.context.resume();
						}
						break;
				}
			}

			if(this.expectations.length > 0) {
				var expectation = this.expectations.pop();
				var stat = states[this.status.stat];
				if(stat in expectation) {
					if(expectation[stat] === null) {
						this.expectations.push(expectation);
					} else {
						expectation[stat](this);
					}
				} else if(null in expectation) {
					expectation[null](this);
				}
			}
		}

		this.stat = this.status.stat !== undefined ? this.status.stat : this.stat;
		this.hold = this.status.hold !== undefined ? this.status.hold : this.hold;

		if(this.context) {
			this.context.emit('status', this.status);
		}

		// Emit status no matter what
		if('stat' in response.sr) {
			this.emit('stat', response.sr.stat)
			if(this.context) {
				this.context.emit('stat', response.sr.stat);
			}
		}
		this.emit('status', this.status);
	}
};

// Called once a proper JSON response is decoded from the chunks of data that come back from G2
G2.prototype.onMessage = function(response) {
	// TODO more elegant way of dealing with "response" data.

	if(response.r) {
		if(!this._seen_ready) {
			// Special message type for initial system ready message
			if(response.r.msg && (response.r.msg === "SYSTEM READY")) {
				this.emit('ready', this);
				return;
			}
		}
		if(this._ignored_responses > 0) {
			this._ignored_responses--;
		} else {
			this.lines_to_send += 1;
			this.sendMore();
		}
		r = response.r;
		this.emit('response', false, response.r);
	} else {
		r = response;
	}

	// Deal with G2 status (top priority)
	this.handleStatusReport(r);

	// Deal with exceptions
	this.handleExceptionReport(r);

	// Deal with streaming (if response contains a queue report)
	// this.handleQueueReport(r);

	// Deal with footer
	var err = this.handleFooter(response);

	// Emitted everytime a message is received, regardless of content
	this.emit('message', response);

	for(var key in r) {
		if(key in this.readers) {
			if(typeof this.readers[key][this.readers[key].length-1] === 'function') {
				//if(r[key] !== null) {
					callback = this.readers[key].shift();
					if(err) {
						callback(err);
					} else {
						callback(null, r[key]);
					}
				//}
			}
		}
	}

};

G2.prototype.feedHold = function(callback) {
	this.pause_flag = true;
	this.flooded = false;
	typeof callback === 'function' && this.once('state', callback);
	if(this.status.stat === this.STAT_PROBE) {
        return this.quit()
    }
    log.debug("Sending a feedhold");
	if(this.context) {
		this.context.pause();
	}
	this._write('!\n', function() {
		log.debug("Drained.");
	});
};

G2.prototype.queueFlush = function(callback) {
	log.debug('Clearing the queue.');
	this.flushcallback = callback;
	this.lines_to_send = 4;
	this.gcode_queue.clear();
	this.command({'clr':null});
	this._write('\%');
};

G2.prototype.resume = function() {
	var thisPromise = _promiseCounter;
	if(resumePending){
		return;
	}
	log.info("Creating promise " + thisPromise);
	_promiseCounter += 1;
	resumePending = true;
	var deferred = Q.defer();
	var that = this;
	var onStat = function(stat) {
		if(stat !== STAT_RUNNING) {
			if(this.quit_pending && stat === STAT_HOLDING) {
				return;
			}
			that.removeListener('stat', onStat);
			log.info("Resolving promise (resume): " + thisPromise);
			resumePending = false;
			deferred.resolve(stat);
		}
	}

	this.on('stat', onStat);
	this._write('~'); //cycle start command character

	if(this.context) {
		this.context.resume();
	}
	this.requestStatusReport(function(sr) {
		this.pause_flag = false;

	}.bind(this));
	return deferred.promise;
};


G2.prototype.quit = function() {
	if(this.quit_pending) {
		log.warn("Not quitting because a quit is already pending.");
		return;
	}

	switch(this.status.stat) {
		//case STAT_END:
		//	return;
		//	break;

		default:
			this.quit_pending = true;

			if(this.stream) {
				this.stream.end()
			}
			this.gcode_queue.clear();
			this._write('\x04\n');
			break;
	}
}

G2.prototype.get = function(key, callback) {
	var keys;
	if(key instanceof Array) {
		keys = key;
		is_array = true;
	} else {
		is_array = false;
		keys = [key];
	}
	async.map(keys,

		// Function called for each item in the keys array
		function(k, cb) {
			cb = cb.bind(this);
			cmd = {};
			cmd[k] = null;

			if(k in this.readers) {
				this.readers[k].push(cb);
			} else {
				this.readers[k] = [cb];
			}

			// Ensure that an errback is called if the data isn't read out
			setTimeout(function() {
				if(k in this.readers) {
						callbacks = this.readers[k];
						stored_cb = callbacks[callbacks.length-1];
						if(cb == stored_cb) {
							if(typeof cb == 'function') {
								this.readers[k].shift();
								cb(new Error("Timeout"), null);
							}
						}
					}
			}.bind(this), CMD_TIMEOUT);

			this.command(cmd);
		}.bind(this),

		// Function to call with the list of results
		function(err, result) {
			if(err) {
				return callback(err, result);
			} else {
				// If given an array, return one.  Else, return a single item.
				if(is_array) {
					return callback(err, result);
				} else {
					return callback(err, result[0]);
				}
			}
		}
	);
};

G2.prototype.setMany = function(obj, callback) {
	var keys = Object.keys(obj);
	async.map(keys,
		// Function called for each item in the keys array
		function(k, cb) {
			cmd = {};
			cmd[k] = obj[k];
			if(k in this.readers) {
				this.readers[k].push(cb.bind(this));
			} else {
				this.readers[k] = [cb.bind(this)];
			}
			this.command(cmd);
		}.bind(this),

		// Function to call with the list of results
		function(err, result) {
			if(err) {
				return callback(err, result);
			} else {
				var retval = {};
				try {
					for(i=0; i<keys.length; i++) {
						retval[keys[i]] = result[i];
					}
				} catch(e) {
					callback(e, null);
				}
				return callback(null, retval);
			}
		}
	);
};

G2.prototype.set = function(key, value, callback) {
	if(value === undefined) {
		return callback(new Error("Undefined value passed to G2"));
	}
	cmd = {};
	cmd[key] = value;
	if (key in this.readers) {
		this.readers[key].push(callback);
	} else {
		this.readers[key] = [callback];
	}

	// Ensure that an errback is called if the data isn't read out
	setTimeout(function() {
		if(key in this.readers) {
			callbacks = this.readers[key];
			stored_cb = callbacks[callbacks.length-1];
			if(callback == stored_cb) {
				if(typeof callback == 'function') {
					this.readers[key].shift();
					callback(new Error("Timeout"), null);
				}
			}
		}
	}.bind(this), CMD_TIMEOUT);

	this.command(cmd);
};

// Send a command to G2 (can be string or JSON)
G2.prototype.command = function(obj) {
	var cmd;
	if((typeof obj) == 'string') {
		cmd = obj.trim();
		this.gcode_queue.enqueue(cmd);
	} else {
		cmd = JSON.stringify(obj);
		cmd = cmd.replace(/(:\s*)(true)(\s*[},])/g, "$1t$3")
		cmd = cmd.replace(/(:\s*)(false)(\s*[},])/g, "$1f$3")
		//cmd = cmd.replace(/"/g, '');
		this.command_queue.enqueue(cmd);
	}
	this.sendMore();
};

// Send a (possibly multi-line) string
G2.prototype.runString = function(data, callback) {
	var stringStream = new stream.Readable();
	stringStream.push(data + "\n");
	//stringStream.push("M30\n"); 
	//stringStream.end()
	stringStream.push(null);
	return this.runStream(stringStream);
};

G2.prototype.runList = function(l, callback) {
	var stringStream = new stream.Readable();
	for(var i=0; i<l.length; i++) {
		stringStream.push(l[i] + "\n");
	}
	//stringStream.push("M30\n");
	stringStream.push(null);
	//stringStream.end()
	return this.runStream(stringStream);
}

G2.prototype._createStatePromise = function(states) {
	// Track the promise created (debug)
	var thisPromise = _promiseCounter;
	log.info("Creating promise " + thisPromise);
	_promiseCounter += 1;
	var deferred = Q.defer();
	var that = this;
	var onStat = function(stat) {
		for(var i=0; i<states.length; i++) {
			if(stat === states[i]) {
				that.removeListener('stat', onStat);
				log.info("Resolving promise " + thisPromise + " because of state " + stat + " which is one of " + states)
				deferred.resolve(stat);
			}
		}
	}
	this.on('stat', onStat);
	return deferred.promise;
}
G2.prototype.waitForState = function(states) {
	if(!states.length) {
		states = [states]
	}
	return this._createStatePromise(states);
}

G2.prototype.runStream = function(s) {
		this._createCycleContext();
		s.pipe(this.context._stream);
		return this.context;
}

G2.prototype.runFile = function(filename) {
	var st = fs.createReadStream(filename);
	var ln = new LineNumberer();
	//return this.runStream(st);
	return this.runStream(st.pipe(ln));
}

G2.prototype.runImmediate = function(data) {
	return this.runString(data);
}

G2.prototype.prime = function() {
	log.info("Priming driver (manually)");
	this._primed = true;
	this.sendMore();
}

G2.prototype.getInfo = function() {
	return "G2: primed:" + 
			(this._primed ? '1' : '0') +
			" l2s:" + 
			this.lines_to_send + 
			" gcq:" + this.gcode_queue.getLength()
}
G2.prototype.sendMore = function() {
	//log.info("sendMore:   Lines to send: " + this.lines_to_send);
	//log.info("           Lines in queue: " + this.gcode_queue.getLength());

  if(this.pause_flag) {
	return;
  }
	var count = this.command_queue.getLength();
	if(count) {
		var to_send = count;
		var codes = this.command_queue.multiDequeue(count)
		codes.push("");
		this._ignored_responses+=to_send;
		this._write(codes.join('\n'), function() {});
	} else {
	}

	if(this._primed) {
		var count = this.gcode_queue.getLength();
		if(this.lines_to_send >= THRESH) {
				if(count >= THRESH || this._streamDone) {
				var to_send = Math.min(this.lines_to_send, count);
				var codes = this.gcode_queue.multiDequeue(to_send);
				codes.push("");
				if(codes.length > 1) {
					this.lines_to_send -= to_send/*-offset*/;
					this._write(codes.join('\n'), function() { });
				} else {
				}
			} else {
			}
		}
		else {
            		//log.debug("Not writing to gcode due to lapse in responses")
		}
	} else {
		if(this.gcode_queue.getLength() > 0) {
			//log.debug("Not sending because not primed.");
		}
	}
};

G2.prototype.setMachinePosition = function(position, callback) {
	var axes = ['x','y','z','a','b','c','u','v','w']
	var gcodes = ['G21']
	axes.forEach(function(axis) {
		if(position[axis] != undefined) {
			gcodes.push('G28.3 ' + axis + position[axis].toFixed(5));
		}
	});

	gcodes.push(this.status.unit === 'in' ? 'G20' : 'G21');
	this.runList(gcodes).then(function() {callback && callback()})
}

// Function works like "once()" for a state change
// callbacks is an associative array mapping states to callbacks
// If the *next* state change matches a state in the associative array, the callback it maps to is called.
// If null is specified in the array, this callback is used for any state that is unspecified
//
// eg:
// this.expectStateChange {
//                          STAT_END : end_callback,
//                          STAT_PAUSE : pause_callback,
//                          null : other_callback};
//
// In the above example, when the next change of state happens, the appropriate callback is called in the case
// that the new state is either STAT_END or STAT_PAUSE.  If the new state is neither, other_callback is called.

G2.prototype.expectStateChange = function(callbacks) {
	if("timeout" in callbacks) {
		var fn = callbacks.timeout;
		setTimeout(function() {
			if(this.expectations.length > 0) {
				callbacks = this.expectations[this.expectations.length-1];
				if(callbacks.timeout === fn) {
					log.debug("Calling timeout function");
					this.expectations.pop();
					fn(this);
				}
			}
		}.bind(this), EXPECT_TIMEOUT);
	}
	this.expectations.push(callbacks);
};

states = {
	0 : "init",
	1 : "ready",
	2 : "alarm",
	3 : "stop",
	4 : "end" ,
	5 : "running",
	6 : "holding",
	7 : "probe",
	8 : "cycling",
	9 : "homing",
	11 : "interlock",
	12 : "shutdown",
	13 : "panic"
};

var state = function(s) {
	return states[s];
};

// export the class
exports.G2 = G2;

exports.STAT_INIT = STAT_INIT;
exports.STAT_READY = STAT_READY;
exports.STAT_ALARM = STAT_ALARM;
exports.STAT_STOP = STAT_STOP;
exports.STAT_END = STAT_END;
exports.STAT_RUNNING = STAT_RUNNING;
exports.STAT_HOLDING = STAT_HOLDING;
exports.STAT_PROBE = STAT_PROBE;
exports.STAT_CYCLING = STAT_CYCLING;
exports.STAT_HOMING = STAT_HOMING;
exports.STAT_INTERLOCK = STAT_INTERLOCK;
exports.STAT_SHUTDOWN = STAT_SHUTDOWN;
exports.STAT_PANIC = STAT_PANIC;

G2.prototype.STAT_INIT = STAT_INIT;
G2.prototype.STAT_READY = STAT_READY;
G2.prototype.STAT_ALARM = STAT_ALARM;
G2.prototype.STAT_STOP = STAT_STOP;
G2.prototype.STAT_END = STAT_END;
G2.prototype.STAT_RUNNING = STAT_RUNNING;
G2.prototype.STAT_HOLDING = STAT_HOLDING;
G2.prototype.STAT_PROBE = STAT_PROBE;
G2.prototype.STAT_CYCLING = STAT_CYCLING;
G2.prototype.STAT_HOMING = STAT_HOMING;
G2.prototype.STAT_INTERLOCK = STAT_INTERLOCK;
G2.prototype.STAT_SHUTDOWN = STAT_SHUTDOWN;
G2.prototype.STAT_PANIC = STAT_PANIC;
