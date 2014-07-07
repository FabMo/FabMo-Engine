/**
 * @author jimmy
 */
var restify = require('restify');
var process = require('process');
var detection_daemon = require('./detection_daemon');
var machine = require('./machine');

machine.machine = machine.connect(function(error, data) {
	if(error) {
		console.log("There was an error connecting to the tool: " + data)
	} else {
		// Successful connection made to G2: Setup the server.
		var server = restify.createServer({name:"FabMo Engine"});

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
	}
});

new detection_daemon(24862); // start on port 24862
