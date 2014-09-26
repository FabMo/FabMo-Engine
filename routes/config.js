var machine = require('../machine').machine;
var information = require('../information');
var configuration = require('../configuration');

var get_status = function(req, res, next) {
	var s = machine.status;
    res.json({'status':s});
};

var get_info = function(req, res, next) {
    res.json(information);
};

var get_config = function(req, res, next) {
    res.json(configuration);
};

module.exports = function(server) {
	server.get('/status', get_status); //OK
	server.get('/config',get_config); //TODO 
	server.get('/info',get_info); //TODO 
}
