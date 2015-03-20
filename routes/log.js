var machine = require('../machine').machine;
var config = require('../config');
var log = require('../log');

var get_log = function(req, res, next) {
  body = log.getLogBuffer();
  res.setHeader('content-type', 'text/plain');
  res.send(body);
};

module.exports = function(server) {
  server.get('/log', get_log);
};
