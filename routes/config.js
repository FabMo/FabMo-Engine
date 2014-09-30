var machine = require('../machine').machine;
var config = require('../config');

var get_status = function(req, res, next) {
	var s = machine.status;
    res.json({'status':s});
};

var get_info = function(req, res, next) {
    res.json(information);
};

var get_config = function(req, res, next) {
	var retval = {};
	retval['engine'] = config.engine.getData();
	retval['driver'] = config.driver.getData();
	res.json(retval);
};

var post_config = function(req, res, next) {
	// TODO 
	// Parse JSON out of request
	// Extract the engine/driver members
	// Call config.engine.update(obj) for the engine stuff
	// Call config.driver.update(obj) for the driver stuff
	// Maybe call config.engine.apply()
}

module.exports = function(server) {
	server.get('/status', get_status); //OK
	server.get('/config',get_config); //TODO 
	server.get('/info',get_info); //TODO 
}
