var engine = require('../server').engine;
var updater = require('../updater');

/**
 * @api {get} /version
 * @apiGroup Updater
 * @apiDescription Retrieve the version string for the FabMo engine.
 * @apiSuccess {String} status `success`
 * @apiSuccess {Object} data {version : 'software version string'}
 * @apiError {String} status `error`
 * @apiError {Object} message Error message
 */
var getVersion = function(req, res, next) {
  	var answer = {
		status:"success",
		data : {'version' : engine.version}
	};
	res.json(answer);
};

var doUpdate = function(req, res, next) {
	var answer = {
		status:"success",
		data : null
	}
	res.json(answer);
	updater.updateEngine(function() {

	});
};

module.exports = function(server) {
	server.get('/version',getVersion); //OK
	server.get('/update', doUpdate);
};