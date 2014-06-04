machine = require('./machine');

exports.get_status = function(req, res, next) {
	var s = machine.driver.status
    res.json({'status':s});
};

exports.get_config = function(req, res, next) {
    res.header('Location', req.headers['referer']);
    res.json({'error':'Not implemented yet.'});
};

