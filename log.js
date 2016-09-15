/**
 * log.js is a "Poor man's" logging module.  It provides basic colorized logging using named
 * loggers with selectable log levels.
 */
var process = require('process');
try { var colors = require('colors'); } catch(e) {var colors = false;}
var fs = require('fs');
var path = require('path');
var _suppress = false;
var log_buffer = [];
var LOG_BUFFER_SIZE = 5000;
var PERSISTENT_LOG_COUNT = 20;

// String versions of the allowable log levels
LEVELS = {
	'g2' : 0,
	'debug' : 1,
	'info' : 2,
	'warn' : 3,
	'error' : 4,
};

// Default log levels for loggers with specific names.
LOG_LEVELS = {
	'g2' : 'debug',
	'gcode' : 'debug',
	'sbp' : 'debug',
	'machine' : 'debug',
	'manual' : 'debug',
	'api' : 'debug',
	'detection' :'debug',
	'config_loader' : 'debug',
	'settings' : 'debug',
	'log':'debug'
};

function setGlobalLevel(lvl){
	if (lvl)
	{
		if (lvl >= 0 && lvl <= 3)
		{
			// assign the log level to the string equivalent of the integer
			Object.keys(LOG_LEVELS).forEach(function(key) {
	  			LOG_LEVELS[key] = Object.keys(LEVELS).filter(function(key) {return (LEVELS[key] === lvl);})[0];
	  		});
		}
		else if (Object.keys(LEVELS).indexOf(lvl) >= 0) // if a string
		{
			//  assign the log level to the string that is given
			Object.keys(LOG_LEVELS).forEach(function(key) {
	  			LOG_LEVELS[key] = lvl;
	  		});
		}
		else if (lvl === "none")
		{
			return;
		}
		else
		{
			logger('log').warn('Invalid log level: ' + lvl);
		}
	}
}

// The Logger object is what is created and used by modules to log to the console.
var Logger = function(name) {
	this.name = name;
};

// Index of all the Logger objects that have been created.
var logs = {};

// Output the provided message with colorized output (if available) and the logger name
Logger.prototype.write = function(level, msg) {
	if(_suppress) {
		return;
	}

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
		log_buffer.push(buffer_msg);
		while(log_buffer.length > LOG_BUFFER_SIZE) {
			log_buffer.shift();
		}
	}
};

// These functions provide a shorthand alternative to specifying the log level every time
Logger.prototype.debug = function(msg) { this.write('debug', msg);};
Logger.prototype.stack = function(msg) {
	var stackTrace = new Error().stack;
	stackTrace = stackTrace.split('\n');
	stackTrace = stackTrace.slice(2).join('\n');
	this.write('debug', 'Stack Trace:\n' + stackTrace);
}

Logger.prototype.info = function(msg) { this.write('info', msg);};
Logger.prototype.warn = function(msg) { this.write('warn', msg);};
Logger.prototype.error = function(msg) {
	if(msg && msg.stack) {
		this.write('error', msg.stack);
	} else {
		this.write('error', msg);
	}
};


Logger.prototype.g2 = function(msg) {this.write('g2', msg);};
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

function exitHandler(options, err) {
    options = options || {};
    if (err) {
    	_log.uncaught(err);
    }
    var dir = require('./config').getDataDir('log')
    var fn = 'fabmo-' + Date.now() + '-log.txt'
    filename = path.join(dir, fn)
    if(options.savelog) {
    	_log.info("Saving log...")
    	try {
	    	saveLogBuffer(filename);
	    	_log.info("Log saved to " + filename);
	    	rotateLogs(PERSISTENT_LOG_COUNT, function() {
	    		if(options.exit) {
	    			process.exit();
	    		}
	    	});
	    	return;
    	} catch(e) {
	    	_log.error("Could not save log to " + filename);
	    	_log.error(e);
    	}
	    if (options.exit) {
	    	process.exit();
	    }
	}
}

process.on('exit', exitHandler.bind(null));
process.on('SIGINT', exitHandler.bind(null, {savelog:true, exit:true}));
process.on('uncaughtException', exitHandler.bind(null, {savelog:true, exit:false}));

var suppress = function(v) {_suppress = true;};
var unsuppress = function(v) {_suppress = false;};

var getLogBuffer = function() {
	return log_buffer.join('\n');
};

var clearLogBuffer = function() {
	log_buffer = [];
}

var saveLogBuffer = function(filename) {
	fs.writeFileSync(filename, getLogBuffer());
}

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

exports.suppress = suppress;
exports.logger = logger;
exports.setGlobalLevel = setGlobalLevel;
exports.getLogBuffer = getLogBuffer;
exports.clearLogBuffer = clearLogBuffer;
exports.rotateLogs = rotateLogs;
