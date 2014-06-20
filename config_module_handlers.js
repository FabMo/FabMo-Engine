var machine = require('./machine');
var information = require('./information');
var configuration = require('./configuration');

exports.get_status = function(req, res, next) {
	var s = machine.driver.status
    res.json({'status':s});
};

exports.get_info = function(req, res, next) {
    res.json(information);
};

exports.get_config = function(req, res, next) {
    res.json(configuration);
};
