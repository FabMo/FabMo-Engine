var shopbotd = require('./shopbotd_library');

exports.stop = function(req, res, next) {
        var s = new shopbotd({'cmd':'stop'});
        s.on('getmessage', function(data){
                res.json({'err':0});
        });
};

