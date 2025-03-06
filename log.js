/*
 * log.js
 * 
 * Logging module. It provides basic colorized logging using named loggers with selectable log levels.  
 * Written basically to provide only the logging functionality needed without needing to buy
 * into an elaborate logging system.
 */
var process = require('process');
try { var colors = require('colors'); } catch(e) {var colors = false;}
var fs = require('fs');
var path = require('path');
var jsesc = require('jsesc');
var _suppress = false;
var log_buffer = [];
var LOG_BUFFER_SIZE = 5000;
var PERSISTENT_LOG_COUNT = 20;
var flightRecorder = null;
var tickTime = null;

// String versions of the allowable log levels
LEVELS = {
	'g2' : 0,
	'debug' : 1,
	'info' : 2,
	'warn' : 3,
	'error' : 4,
};

// Default log levels for loggers with specific names. LIST EACH specific name for filtering to work.
LOG_LEVELS = {
	'g2' : 'debug',
	'gcode' : 'debug',
	'sbp' : 'debug',
	'machine' : 'debug',
	'manual' : 'debug',
	'api' : 'debug',
	'detection' :'debug',
	'config' : 'debug',
	'config_loader' : 'debug',
	'settings' : 'debug',
	'log':'debug',
	'config-routes':'info',
	'routes':'info',
	'g2config':'info',
	'engine':'info',
	'profiles':'info',
	'websocket':'info',
	'app_manager':'info',
	'opensbp':'info'
};

/*
 * The flight recorder records the timestamp and content of every message sent to 
 * or recieved from G2.  It is memory intensive and degrades system performance.
 * The advantage of using is that you can take the JSON file it produces and
 * "replay" a session into a G2 instance later.  This is invaluable for catching bugs
 * that depend on timing to reproduce.  The replayer honors the timestamp values stored in
 * the flight recording, so that the actual times of all messages are reproduced as closely as possible.
 *
 * The flight replayer can be found here, and has documentation of its own:
 * https://github.com/FabMo/g2-flight-replayer
 */
var FlightRecorder = function() {
  this.records = []
  this.firstTime = 0
  this.info = {
    'startTime' : new Date().toISOString(),
    'arch' : process.arch,
    'platform' : process.platform
  }
}

// Record the provided data at the current time
// channel - Just a name - mainly for older systems with multiple serial channels.
// dir - 'out' (host->g2) or 'in' (g2->host)
// data - The actual data sent or received
FlightRecorder.prototype.record = function(channel, dir, data) {
  // Get the current time
  var t = new Date().getTime();

  // Add the current message to the record
  this.records.push({
    'time' : t,
    'data' : data,
		'dir' : dir,
    'channel' : channel
  })
}

// Return the most recently recorded record.
FlightRecorder.prototype.getLatest = function() {
	if(this.records.length === 0) { return null; }
	return this.records[this.records.length-1];
}

// Return a flight log which includes the list of recorded messages, plus some summary information.
FlightRecorder.prototype.getFlightLog = function() {
var newRecords = []
	if(this.records.length > 0) {
		var startTime = this.records[0].time;
		this.records.forEach(function(record) {
			newRecords.push({
				't' : record.time-startTime,
				'ch' : record.channel,
				'dir' : record.dir,
				'data' : record.data, /*new Buffer(record.data).toString('base64')*/
			});
		}.bind(this));
	}
  this.info.endTime = new Date().toISOString();
	var flight = {
		records : newRecords,
	    info : this.info
    }
    return flight;
}

// Save this flight recording to a JSON file
FlightRecorder.prototype.save = function(filename, callback) {
  fs.writeFile(filename, JSON.stringify(this.getFlightLog(), null, 2), callback);
}

// Set the global logging level to the provided value.  This supersedes the default log level for individual loggers.
// lvl - can be a name such as g2,debug,etc or can be a numeric level
function setGlobalLevel(lvl){
	if (lvl) {
		if (lvl >= 0 && lvl <= 3) {
			// assign the log level to the string equivalent of the integer
			Object.keys(LOG_LEVELS).forEach(function(key) {
	  			LOG_LEVELS[key] = Object.keys(LEVELS).filter(function(key) {return (LEVELS[key] === lvl);})[0];
	  		});
		}
		else if (Object.keys(LEVELS).indexOf(lvl) >= 0) {
			//  assign the log level to the string that is given
			Object.keys(LOG_LEVELS).forEach(function(key) {
	  			LOG_LEVELS[key] = lvl;
	  		});
		}
		else if (lvl === "none") {
			return;
		}
		else {
			logger('log').warn('Invalid log level: ' + lvl);
		}
		////## Flight recorder disabled for now
		//       - not being used (same info in normal log and debug stream)
		//       - exclusive focus on g2 channel no longer as important as it once was
		// if(lvl === "g2") {
		// 	_log.info("Creating flight recorder...")
		// 	flightRecorder = new FlightRecorder();
		// } else {
		// 	if(flightRecorder) {
		// 		_log.info("Destroying flight recorder...")				
		// 	}
		flightRecorder = null;
		// }
	}
}

// The Logger object is what is created and used by modules to log to the console.
var Logger = function(name) {
	this.name = name;
};

// Index of all the Logger objects that have been created.
var logs = {};

// These are convenience methods for timing operations.
// Call tick() before starting a task and then tock() after finishing. 
// The elapsed time will be printed to the console.
// You can call tock repeatedly, and it will tell you the time since the last tock.
Logger.prototype.tick = function() { 
	tickTime = new Date().getTime()
	this.debug('TICK');
}
Logger.prototype.tock = function(name) { 
	var d = tickTime ? new Date().getTime() - tickTime  + 'ms' : 'no tick!';
	var name = name ? ' (' + name + ') ' : '';
	this.debug('TOCK' + name + d)
	tickTime = new Date().getTime()
}

// Output the provided message with colorized output (if available) and the logger name
Logger.prototype.write = function(level, msg) {
	if(_suppress) { return; }

	// TODO - I've read that the modules that overload the builtin string object to provide functionality
	//        (as seen below) are falling out of favor because of weirdo side effects they have.  Might want
	//        to re-think how colorization is done here.
	my_level = LOG_LEVELS[this.name] || 'debug';
	if((LEVELS[level] || 0) >= (LEVELS[my_level] || 0)) {
		buffer_msg = level + ': ' + msg + ' ['+this.name+']';
		if(colors) {
			switch(level) {
				case 'g2':
					console.log((level + ': ').magenta + msg + ' ['+this.name+']');
					break;
				case 'debug':
					console.log((level + ': ').blue + msg+' ['+this.name+']');
					break;
				case 'info':
					console.log((level + ': ').green + msg+' ['+this.name+']');
					break;
				case 'warn':
					console.log((level + ': ').yellow + msg+' ['+this.name+']');
					break;
				case 'error':
					console.log((level + ': ').red + msg+' ['+this.name+']');
					break;
			}
		} else {
			console.log(level + ': ' + msg+' ['+this.name+']');
		}

		// Circular log buffer that maintains the last LOG_BUFFER_SIZE messages
		log_buffer.push(buffer_msg);
		while(log_buffer.length > LOG_BUFFER_SIZE) {
			log_buffer.shift();
		}
	}
};

// These functions provide a shorthand alternative to specifying the log level every time
Logger.prototype.debug = function(msg) { this.write('debug', msg);};
Logger.prototype.info = function(msg) { this.write('info', msg);};
Logger.prototype.warn = function(msg) { this.write('warn', msg);};

// error() is a little special - if you call it with an actual error object that has a stack
// it will print out the stack as well, for debugging.
Logger.prototype.error = function(msg) {
	if(msg && msg.stack) {
		this.write('error', msg.stack);
	} else {
		this.write('error', msg);
	}
};

// stack() prints out a backtrace wherever it is called. It prints at the 'debug' log level
Logger.prototype.stack = function(msg) {
	var stackTrace = new Error().stack;
	stackTrace = stackTrace.split('\n');
	stackTrace = stackTrace.slice(2).join('\n');
	this.write('debug', 'Stack Trace:\n' + stackTrace);
}

// This function is for data sent to and from the serial channel ONLY.  Calling it with any other
// input can lead to trouble if you're trying to debug.  This log level prints special output that
// includes timestamps and escaped special characters so it's easy to diagnose communication issues
Logger.prototype.g2 = function(channel, dir, o) {
  var msg = {}
	if(flightRecorder) {
		flightRecorder.record(channel, dir, o);
		msg = flightRecorder.getLatest();
	} else {
		msg.channel = channel;
		msg.data = o;
		msg.time = new Date().getTime();
	}
	switch(dir) {
		case 'out':
			this.write('g2', '--' + msg.channel + '-' + msg.time + '----> ' + jsesc(msg.data.trim()));
			break;
		case 'in':
			this.write('g2', '<-' + msg.channel + '-' + msg.time + '----- ' + jsesc(msg.data.trim()));
			break;
	}
};

// Printout for uncaught exceptions.
// This is nice for debugging, but in production, handling an otherwise uncaught exception and allowing the
// program to continue execution is almost always a bad idea.
Logger.prototype.uncaught = function(err) {
	if(colors) {
		console.log("UNCAUGHT EXCEPTION".red.underline);
		console.log(('' + err.stack).red)
	} else {
		console.log("UNCAUGHT EXCEPTION");
		console.log(err.stack);
	}
	log_buffer.push("UNCAUGHT EXCEPTION");
	log_buffer.push(err.stack);
}

Logger.prototype.startProfile
// Factory function for producing a new, named logger object
var logger = function(name) {
	if(name in logs) {
		return logs[name];
	} else {
		l = new Logger(name);
		logs[name] = l;
		return l;
	}
};

// Logging internal to the logging module - the logger log logger log
//
// .... log log logger log.
var _log = logger('log');

// Cleanup operations that happen on program exit.
// TODO are we really ever getting a program exit with typical power off of RPi's? Mabye do cleanup on starts?
// Mainly:
//  - Write to the current log file so we don't miss anything if the engine crashed
//  - Write out the contents of the current flight recording
//  - Rotate the logs
// 
// options:
//    exit - If true: exit, instead of simply intercepting the handler
// savelog - If true: save and rotate logs/flight data.  Don't if false or unspecified.
function exitHandler(options, err) {
    options = options || {};
    if (err) {
    	_log.uncaught(err);
    }
    var dir = require('./config').getDataDir('log')
    var fn = 'fabmo-' + Date.now() + '-log.txt'
    var flight_fn = path.join(dir, 'g2-flight-log.json');

    filename = path.join(dir, fn)
    if(options.savelog) {
    	_log.info("Saving log...")
    	try {
	    	saveLogBuffer(filename);
	    	_log.info("Log saved to " + filename);
		if(flightRecorder) {
			flightRecorder.save(flight_fn, function(err, data) {
			rotateLogs(PERSISTENT_LOG_COUNT, function() {
				if(options.exit) {
					_log.info("Exiting via process.exit()...");
					process.exit();
				}
			});
			});
		} else {
			if(options.exit) {
				_log.info("Exiting via process.exit()...");
				process.exit();
			}
		}
	    	return;
    	} catch(e) {
	    	_log.error("Could not save log to " + filename);
	    	_log.error(e);
    	}
	    if (options.exit) {
		_log.info("Exiting via process.exit()...");
	    	process.exit();
	    }
	}
}

// Bind handlers for the badtimes (tm)
// See documentation on the process module (nodejs docs) for information about these events
process.on('exit', exitHandler.bind(null));
process.on('SIGINT', exitHandler.bind(null, {savelog:true, exit:true}));
process.on('uncaughtException', exitHandler.bind(null, {savelog:true, exit:false}));

// TODO - why do these have an argument?  They don't use it.
var suppress = function(v) {_suppress = true;};
var unsuppress = function(v) {_suppress = false;};

// Return the circular log buffer as a big string
var getLogBuffer = function() {
	return log_buffer.join('\n');
};

var clearLogBuffer = function() {
	log_buffer = [];
}

// Save the current contents of the log buffer to a file. SYNCHRONOUS.
// filename - The filename to write to
var saveLogBuffer = function(filename) {
	fs.writeFileSync(filename, getLogBuffer());
}

var getFlightLog = function() {
	if(flightRecorder) {
		return flightRecorder.getFlightLog();
	} else {
		throw new Error("No available flight recording.")
	}
}

// Rotate the log files
// count - The number of log files to keep.  If there are 10 logfiles in the log directory, and 
//         this function is called with count=5, the 5 oldest ones are deleted.
// 
var rotateLogs = function(count,callback) {
	var logdir = require('./config').getDataDir('log');
	callback = callback || function() {};
	try {
		fs.readdir(logdir, function(err, files) {
			files.sort();
			if(files.length <= count) {
				return callback();
			}
			var filesToDelete = files.slice(0, files.length-count);
			async.each(
				filesToDelete,
				function(file, callback) {
					fs.unlink(path.join(logdir, file), callback)
				},
				function(err) {
					if(err) {
						_log.error(err);
					} else {
			    		_log.info(filesToDelete.length + " old logfile removed.");
					}
					callback(null)
				});
			});
	} catch(e) {
		_log.error(e);
		callback(e);
	}
}

exports.getFlightLog = getFlightLog;
exports.FlightRecorder = FlightRecorder;
exports.suppress = suppress;
exports.logger = logger;
exports.setGlobalLevel = setGlobalLevel;
exports.getLogBuffer = getLogBuffer;
exports.clearLogBuffer = clearLogBuffer;
exports.rotateLogs = rotateLogs;

