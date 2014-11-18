process = require('process');

kill = function(req, res, next) {
    res.json({'success':true});
    process.exit(1);
};

module.exports = function(server) {
   server.get('/restart', kill); 
}
