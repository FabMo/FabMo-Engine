var shopbotd = require('./shopbotd_library');

exports.get_status = function(req, res, next) {
    var s =  new shopbotd({'cmd':'status'})
    s.on('getmessage', function(data){
        console.log(' status :' + data);
        res.json({'status': data});
    });
};

