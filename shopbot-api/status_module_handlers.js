var shopbotd_lib = require('./shopbotd_library');

exports.get_status = function(req, res, next) {
	var s =  shopbotd_lib.shopbotd({'cmd':'status'});
    res.json({'status':s});
};
