var settings = require('./settings');
var process = require('process');
try { var colors = require('colors'); } catch(e) {var colors = false;}



LEVELS = {
	'debug' : 0,
	'info' : 1,
	'warn' : 2,
	'error' : 3,
};

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
			logger('log').warn('wrong debug level for logging !');
		}
	}
}


var logs = {};

var Logger = function(name) {
	this.name = name;
};

Logger.prototype.write = function(level, msg) {
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

Logger.prototype.debug = function(msg) {
	this.write('debug', msg);
};

Logger.prototype.info = function(msg) {
	this.write('info', msg);
};

Logger.prototype.warn = function(msg) {
	this.write('warn', msg);
};

Logger.prototype.error = function(msg) {
	this.write('error', msg);
};

var logger = function(name) {
	if(name in logs) {
		return logs[name];
	} else {
		l = new Logger(name);
		logs[name] = l;
		return l;
	}
};
/*
process.on('uncaughtException', function(err) {
	if(colors) {
		console.log(err.red);
	}
	else {
		console.log(err);
	}

});*/

exports.logger = logger;
exports.setGlobalLevel = setGlobalLevel;
 
