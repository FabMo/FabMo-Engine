var machine = require('../machine').machine;
var config = require('../config');
var log = require('../log').logger('routes');

/**
 * @api {get} /status Engine status
 * @apiGroup Status
 * @apiSuccessExample {json} Success-Response: 
 *                    { "status":{"posx":0.0, "posy":0.0, "posz":0.0, "state":"idle"}}
 */
var get_status = function(req, res, next) {
	var s = machine.status;
    res.json({'status':s});
};

var get_info = function(req, res, next) {
    res.json(information);
};

/**
 * @api {get} /config Get Engine configuration
 * @apiGroup Config
 * @apiSuccess {Object} engine Key-value map of all engine settings
 * @apiSuccess {Object} driver Key-value map of all G2 driver settings
 * @apiSuccess {Object} opensbp Key-value map of all OpenSBP runtime settings 
 */
var get_config = function(req, res, next) {
	var retval = {};
	retval['engine'] = config.engine.getData();
	retval['driver'] = config.driver.getData();
	retval['opebsbp'] = config.driver.getData();
	res.json(retval);
};

/**
 * @api {post} /config Update engine configuration
 * @apiGroup Config
 */
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

	// TODO: Apply the driver/opensbp configurations here
}

module.exports = function(server) {
	server.get('/status', get_status);     //OK
	server.get('/config',get_config);      //OK
	server.post('/config', post_config);   //TODO
	server.get('/info',get_info);          //TODO 
}
