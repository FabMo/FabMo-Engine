var process = require('process');
try { var colors = require('colors'); } catch(e) {var colors = false}

LEVELS = {
	'debug' : 0,
	'info' : 1,
	'warn' : 2,
	'error' : 3,
}

LOG_LEVELS = {
	'g2' : 'debug',
	'gcode' : 'debug',
	'sbp' : 'debug',
	'machine' : 'debug',
	'manual' : 'debug',
	'api' : 'debug'
};

var logs = {};

var Logger = function(name) {
	this.name = name;
}

Logger.prototype.write = function(level, msg) {
	my_level = LOG_LEVELS[this.name] || 'debug';
	if((LEVELS[level] || 0) >= (LEVELS[my_level] || 0)) {
		if(colors) {
			switch(level) {
				case 'debug':
					console.log((level + ': ').blue + msg)
					break;
				case 'info':
					console.log((level + ': ').green + msg)
					break;
				case 'warn':
					console.log((level + ': ').yellow + msg)
					break;
				case 'error':
					console.log((level + ': ').red + msg)
					break;
			}
		} else {
			console.log(level + ': ' + msg)
		}
	}
}

Logger.prototype.debug = function(msg) {
	this.write('debug', msg)
}

Logger.prototype.info = function(msg) {
	this.write('info', msg)
}

Logger.prototype.warn = function(msg) {
	this.write('warn', msg)
}

Logger.prototype.error = function(msg) {
	this.write('error', msg)
}

var logger = function(name) {
	if(name in logs) {
		return logs[name];
	} else {
		l = new Logger(name);
		logs[name] = l;
		return l;
	}
}

exports.logger = logger;
