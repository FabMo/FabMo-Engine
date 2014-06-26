/**
 * @author jimmy
 */
var restify = require('restify');
var process = require('process');
var detection_daemon = require('./detection_daemon');

process.argv.forEach(function (val, index, array) {
  console.log(index + ': ' + val);
});

var server = restify.createServer({name:"device_api"});
// allow JSON over Cross-origin resource sharing 
server.use(
  function crossOrigin(req,res,next){
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "X-Requested-With");
    return next();
  }
);
server.use(restify.bodyParser({'uploadDir':'/opt/shopbot/tmp'}));// for uploading files

var routes = require('./routes')(server);

server.listen(8080, function() {
  console.log('%s listening at %s', server.name, server.url);
});

detection_daemon.start(24862); // start on port 24862
