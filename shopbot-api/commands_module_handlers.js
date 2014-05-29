var shopbotd_lib = require('./shopbotd_library');

exports.stop = function(req, res, next) {
	var s = shopbotd_lib.shopbotd({'cmd':'stop'});
	console.log(s);
    res.json({'err':0});
};
