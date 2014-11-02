/** 
 * log.js is a "Poor man's" logging module.  It provides basic colorized logging using named 
 * loggers with selectable log levelts.
 */
var process = require('process');
try { var colors = require('colors'); } catch(e) {var colors = false;}
var _suppress = false;

// String versions of the allowable log levels
LEVELS = {
	'debug' : 0,
	'info' : 1,
	'warn' : 2,
	'error' : 3,
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
		if(colors) {
			switch(level) {
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
	}
};

// These functions provide a shorthand alternative to specifying the log level every time
Logger.prototype.debug = function(msg) { this.write('debug', msg); };
Logger.prototype.info = function(msg) { this.write('info', msg); };
Logger.prototype.warn = function(msg) { this.write('warn', msg); };
Logger.prototype.error = function(msg) { this.write('error', msg);};

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

process.on('uncaughtException', function(err) {
	if(colors) {
		console.log(err.bgRed);
	}
	else {
		console.log(err);
	}

});

var suppress = function(v) {_suppress = true;}
var unsuppress = function(v) {_suppress = false;}

exports.suppress = suppress;
exports.logger = logger;
exports.setGlobalLevel = setGlobalLevel;
 
