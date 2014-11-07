var machine = require('../machine').machine;
var config = require('../config');
var log = require('../log').logger('routes');

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
	retval['opebsbp'] = config.driver.getData();
	res.json(retval);
};

var post_config = function(req, res, next) {
	var new_config = {};
	try {
		new_config = req.body;
	} catch(e) {
		return res.send(400, e)
	}

	if(new_config.engine) {
		config.engine.update(new_config.engine, function(err, result) {
			if(err) {
				return res.send(400, e);
			}
			res.send(302, result);
		});
	}

	// TODO: Apply the engine/driver configurations here
}

module.exports = function(server) {
	server.get('/status', get_status);     //OK
	server.get('/config',get_config);      //OK
	server.post('/config', post_config);   //TODO
	server.get('/info',get_info);          //TODO 
}
