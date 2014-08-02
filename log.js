var winston = require("winston");

LOG_LEVELS = {
	'g2' : 'info',
	'gcode' : 'info',
	'sbp' : 'debug',
	'machine' : 'info',
	'manual' : 'info',
	'api' : 'info'
};

var create_logger = function(name) {
	log_level = LOG_LEVELS[name] || 'info';
	container = winston.loggers;
	return container.add(name, {
	    console: {
	      level: log_level,
	      colorize: 'true'
	    },
  	});
}

var logger = function(name) {
	if(winston.loggers.has(name)) {
		return winston.loggers.get(name);
	} else {
		return create_logger(name);
	}
}

exports.logger = logger;