var winston = require('winston');


LOG_LEVELS = {
	'g2' : 'debug',
	'gcode' : 'debug',
	'sbp' : 'debug',
	'machine' : 'debug',
	'manual' : 'debug',
	'api' : 'debug'
};

var create_logger = function(name) {
	log_level = LOG_LEVELS[name] || 'info';
	container = winston.loggers;
	l = container.add(name, {
	    console: {
	      level: log_level,
	      colorize: true,
          handleExceptions: false
	    },
  	});
    l.exitOnError = false;
    //return expandErrors(l);
    return l
}

var logger = function(name) {
	if(winston.loggers.has(name)) {
		return winston.loggers.get(name);
	} else {
		return create_logger(name);
	}
}

//throw "woah"
exports.logger = logger;
