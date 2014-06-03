machine = require('./machine');


exports.stop = function(req, res, next) {
	machine.driver.stop()
	console.log(s);
    res.json({'err':0});
};
