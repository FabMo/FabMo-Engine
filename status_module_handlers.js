machine = require('./machine');

exports.get_status = function(req, res, next) {
	var s = machine.driver.status
    res.json({'status':s});
};
