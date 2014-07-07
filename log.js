var winston = require("winston");

var logger = new (winston.Logger)({
	transports: [
		new (winston.transports.Console)({ level: 'debug' }),
	]
});

module.exports = logger
