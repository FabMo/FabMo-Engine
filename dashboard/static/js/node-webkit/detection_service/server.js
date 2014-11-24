/**
 * @author jimmy
 */
var os = require('os');
var restify = require('restify'); 

var package_json = require('../package.json');
var server = restify.createServer({name:"local_api"});

// allow JSON over Cross-origin resource sharing 
server.use( function crossOrigin(req,res,next){
	res.header("Access-Control-Allow-Origin", "*");
	res.header("Access-Control-Allow-Headers", "X-Requested-With");
	return next();
});

var routes = require('./js/node-webkit/detection_service/routes')(server);

server.on('error',function (err) {
    if (err.code == 'EADDRINUSE')
    	console.log('Detection server is already running');
    return;
});

server.listen(package_json.detection_service_port || 8080, function() {
	console.log(server.name + ' listening at ' + server.url);
});

//module.exports = this;
